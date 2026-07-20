// 계정 삭제(회원 탈퇴) — preflight / request / 복구. ACCOUNT_DELETION_DESIGN v3.
//   App Store 5.1.1(v). soft delete(status='deleted') + 30일 유예 → 익명화 cron.
//   여기는 preflight(판정)만. request/복구/익명화는 후속 단계.
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Business, BusinessMember, Client, Invoice, ExternalConnection, EmailAccount, File, RefreshToken, ApiToken, PushSubscription } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const GRACE_DAYS = 30;
const OAUTH_SENTINEL_PREFIX = '$2a$12$oauth_no_password_set';

// 미수금으로 보는 invoice status (paid/draft/canceled 제외)
const UNPAID_STATUSES = ['sent', 'partially_paid', 'overdue'];
// "유료 활성 구독" — trialing 은 제외(신규 가입 기본값이라 포함 시 전원 탈퇴 불가, 🟠1)
const ACTIVE_PAID_SUB = ['active', 'past_due'];

// 한 워크스페이스가 "데이터 있음"인가 — 다른 human 멤버 / client / 미수금 / 유료구독
async function workspaceHasData(businessId, myUserId) {
  const [otherHumans, clients, unpaid, paidSub] = await Promise.all([
    BusinessMember.count({ where: { business_id: businessId, removed_at: null, role: { [Op.ne]: 'ai' }, user_id: { [Op.ne]: myUserId } } }),
    Client.count({ where: { business_id: businessId } }),
    Invoice.count({ where: { business_id: businessId, status: { [Op.in]: UNPAID_STATUSES } } }),
    // 유료 활성 구독 = business 의 subscription_status (SaaS) — Q Bill client_subscriptions 아님
    Business.count({ where: { id: businessId, subscription_status: { [Op.in]: ACTIVE_PAID_SUB } } }),
  ]);
  return {
    hasData: otherHumans > 0 || clients > 0 || unpaid > 0 || paidSub > 0,
    detail: { otherHumans, clients, unpaid, paidSub },
  };
}

// 탈퇴 판정 — preflight 와 request 공용. blockers / soloToDelete 반환.
async function evaluateDeletion(userId) {
  const me = await User.findByPk(userId, { attributes: ['id', 'is_ai', 'platform_role', 'status'] });
  if (!me) return { error: 'user_not_found' };
  if (me.is_ai) return { error: 'ai_account_cannot_delete' };

  const blockers = [];
  const warnings = [];
  const ownedBusinesses = await Business.findAll({
    where: { owner_id: userId, deleted_at: null },
    attributes: ['id', 'name', 'brand_name', 'cue_user_id'],
  });
  const transferRequired = [];
  const soloToDelete = [];
  for (const biz of ownedBusinesses) {
    const { hasData, detail } = await workspaceHasData(biz.id, userId);
    const label = biz.brand_name || biz.name;
    if (hasData) transferRequired.push({ id: biz.id, name: label, ...detail });
    else soloToDelete.push({ id: biz.id, name: label, cue_user_id: biz.cue_user_id });
  }
  if (transferRequired.length) blockers.push({ code: 'transfer_required', businesses: transferRequired });

  if (me.platform_role === 'platform_admin') {
    const otherAdmins = await User.count({
      where: { platform_role: 'platform_admin', status: 'active', is_ai: false, id: { [Op.ne]: userId } },
    });
    if (otherAdmins === 0) blockers.push({ code: 'last_platform_admin' });
  }

  const unpaidTotal = transferRequired.reduce((s, b) => s + (b.unpaid || 0), 0);
  if (unpaidTotal > 0) warnings.push({ code: 'has_unpaid_invoices', count: unpaidTotal });
  const paidSubTotal = transferRequired.reduce((s, b) => s + (b.paidSub || 0), 0);
  if (paidSubTotal > 0) warnings.push({ code: 'has_active_subscription', count: paidSubTotal });

  return { me, blockers, warnings, soloToDelete };
}

// GET preflight — 탈퇴 가능 여부 + 차단 사유 + 경고 + 삭제될 데이터 요약
router.get('/me/deletion-preflight', authenticateToken, async (req, res, next) => {
  try {
    const ev = await evaluateDeletion(req.user.id);
    if (ev.error) return errorResponse(res, ev.error, ev.error === 'user_not_found' ? 404 : 400);

    const [privateFiles, extConns, emailAccts] = await Promise.all([
      File.count({ where: { uploader_id: req.user.id, visibility: 'L1' } }).catch(() => 0),
      ExternalConnection.count({ where: { user_id: req.user.id } }).catch(() => 0),
      EmailAccount.count({ where: { user_id: req.user.id } }).catch(() => 0),
    ]);

    return successResponse(res, {
      can_delete: ev.blockers.length === 0,
      blockers: ev.blockers,
      warnings: ev.warnings,
      solo_workspaces_to_delete: ev.soloToDelete.map((w) => ({ id: w.id, name: w.name })),
      data_summary: { private_files: privateFiles, external_connections: extConns, email_accounts: emailAccts },
      grace_days: GRACE_DAYS,
    });
  } catch (err) { next(err); }
});

// POST request — 탈퇴 요청 (status='deleted' + 30일 예약 + 즉시 차단 묶음).
//   비밀번호 재확인(OAuth 는 별도 OTP — 아래 oauth_otp_required). 유예 중 복구 가능.
router.post('/me/deletion-request', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const me = await User.findByPk(userId);
    if (!me) return errorResponse(res, 'user_not_found', 404);
    if (me.is_ai) return errorResponse(res, 'ai_account_cannot_delete', 400);
    if (me.status === 'deleted') return errorResponse(res, 'already_pending_deletion', 400);

    // 본인 확인 — 비밀번호 계정은 비번, OAuth 전용 계정은 OTP(후속 D9)
    const isOauthOnly = me.password_hash && me.password_hash.startsWith(OAUTH_SENTINEL_PREFIX);
    if (isOauthOnly) {
      return errorResponse(res, 'oauth_otp_required — OAuth 계정은 이메일 OTP 확인이 필요합니다', 400);
    }
    const password = req.body?.password;
    if (!password) return errorResponse(res, 'password_required', 400);
    const ok = await bcrypt.compare(String(password), me.password_hash);
    if (!ok) return errorResponse(res, 'invalid_password', 403);

    // 차단 사유 재확인 (preflight 우회 방지 — 서버가 진실 원천)
    const ev = await evaluateDeletion(userId);
    if (ev.error) return errorResponse(res, ev.error, 400);
    if (ev.blockers.length > 0) {
      return res.status(409).json({ success: false, message: 'deletion_blocked', code: 'deletion_blocked', blockers: ev.blockers });
    }

    const now = new Date();
    const scheduled = new Date(now.getTime() + GRACE_DAYS * 86400000);

    const t = await sequelize.transaction();
    try {
      // 1) status='deleted' + 예약
      await me.update({
        status: 'deleted', deletion_requested_at: now, deletion_scheduled_at: scheduled,
        refresh_token: null, reset_token: null,
      }, { transaction: t });

      // 2) 토큰 purge — 즉시 세션 무효
      await RefreshToken.destroy({ where: { user_id: userId }, transaction: t }).catch(() => {});
      await ApiToken.destroy({ where: { user_id: userId }, transaction: t }).catch(() => {});
      await PushSubscription.destroy({ where: { user_id: userId }, transaction: t }).catch(() => {});

      // 3) membership 마크 — 유예 중 멤버 목록/배정 후보에서 제외. 복구 시 이 마커로만 원복(🔴B).
      await BusinessMember.update(
        { removed_at: now, removed_by: userId, removed_reason: 'account_deletion' },
        { where: { user_id: userId, removed_at: null }, transaction: t });

      // 4) 솔로 워크스페이스 동반 soft-delete + 그 Cue 계정도 deleted 마크(좀비 방지, 🔴A)
      for (const w of ev.soloToDelete) {
        await Business.update({ deleted_at: now }, { where: { id: w.id }, transaction: t });
        if (w.cue_user_id) {
          await User.update({ status: 'deleted' }, { where: { id: w.cue_user_id, is_ai: true }, transaction: t });
        }
      }
      await t.commit();
    } catch (e) { await t.rollback().catch(() => {}); throw e; }

    // 5) socket 강제 disconnect (모든 디바이스)
    try {
      const io = req.app.get('io');
      if (io) io.to(`user:${userId}`).emit('account:deleted', { grace_until: scheduled });
    } catch { /* best-effort */ }

    require('../services/auditService').logAudit(req, {
      action: 'user.deletion_request', targetType: 'user', targetId: userId,
      newValue: { scheduled_at: scheduled, solo_workspaces: ev.soloToDelete.map((w) => w.id) },
    });

    return successResponse(res, { status: 'deleted', grace_until: scheduled, recoverable: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.evaluateDeletion = evaluateDeletion;
module.exports.GRACE_DAYS = GRACE_DAYS;
