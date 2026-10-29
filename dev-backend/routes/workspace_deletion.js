// 워크스페이스 삭제·복구 — docs/WORKSPACE_DELETION_DESIGN.md (Fable 설계 판정 반영, 2026-10-29)
//
//   삭제 = soft(deleted_at) + 30일 유예(purge_after). 그동안은 대표가 «내 프로필 → 삭제 예정 워크스페이스» 에서 되살린다.
//   지운 뒤 닫히는 문은 이미 있다(middleware/workspaceAlive · access_scope · 스위처 · 공개 링크 · notify).
//   자동 작업은 services/workspaceAlive 술어로 건너뛴다(가드 cronalive). 정리(파일·연결 삭제)는 services/workspacePurge.
//
//   ★ 두 라우터다. 삭제는 /api/businesses/:id 아래(workspaceAlive 가 :id 를 워크스페이스로 읽어 두 번째 삭제는 404).
//     복구는 /api/users/me 아래 — /api/businesses/:id 는 지운 순간 그 미들웨어가 404 로 닫으므로 거기 두면 자기 문에 막힌다.
//     복구 경로 인자 이름은 workspaceId — businessId 로 지으면 같은 미들웨어가 다시 404 로 닫는다.
const express = require('express');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Business, BusinessMember, Client, Invoice, Subscription } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const workspaceAliveGate = require('../middleware/workspaceAlive');
const { logAudit } = require('../services/auditService');

const GRACE_DAYS = 30;
const OAUTH_SENTINEL_PREFIX = '$2a$12$oauth_no_password_set';
const UNPAID_STATUSES = ['sent', 'partially_paid', 'overdue'];   // account_deletion.js 와 같은 정의

const displayNameOf = (biz) => String(biz.brand_name || biz.name || '');
const norm = (s) => String(s || '').normalize('NFC').trim();

// 잃는 것 요약 — 창의 경고 문구와 감사 기록이 같은 숫자를 쓴다.
async function deletionSummary(biz, ownerId) {
  const [members, clients, unpaidRows, sub] = await Promise.all([
    BusinessMember.count({ where: { business_id: biz.id, removed_at: null, role: { [Op.ne]: 'ai' }, user_id: { [Op.ne]: ownerId } } }),
    Client.count({ where: { business_id: biz.id, status: { [Op.ne]: 'archived' } } }),
    Invoice.findAll({ where: { business_id: biz.id, status: { [Op.in]: UNPAID_STATUSES } }, attributes: ['grand_total', 'paid_amount', 'currency'], raw: true }),
    Subscription.findOne({ where: { business_id: biz.id, status: 'active' }, order: [['current_period_end', 'DESC']], attributes: ['current_period_end'] }),
  ]);
  const unpaidByCurrency = {};
  for (const r of unpaidRows) {
    const cur = r.currency || 'KRW';
    unpaidByCurrency[cur] = (unpaidByCurrency[cur] || 0) + Math.max(0, Number(r.grand_total || 0) - Number(r.paid_amount || 0));
  }
  const end = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  const subscriptionDaysLeft = end && end > new Date() ? Math.ceil((end.getTime() - Date.now()) / 86400000) : 0;
  return { members, clients, unpaid_invoices: unpaidRows.length, unpaid_by_currency: unpaidByCurrency, subscription_days_left: subscriptionDaysLeft };
}

// 대표 본인인지 — transfer-ownership 과 같은 술어(businesses.owner_id). 사칭 중에는 막는다(switch-workspace C4 와 같은 이유).
async function loadOwnedBusiness(req, res) {
  if (req.user.impersonator) { errorResponse(res, 'impersonation_cannot_delete_workspace', 403); return null; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) { errorResponse(res, 'Workspace not found', 404); return null; }
  const biz = await Business.findOne({ where: { id, deleted_at: null } });
  if (!biz) { errorResponse(res, 'Workspace not found', 404); return null; }
  if (Number(biz.owner_id) !== Number(req.user.id)) { errorResponse(res, 'owner_only', 403); return null; }
  return biz;
}

const deleteRouter = express.Router();

// GET 잃는 것 요약 — 삭제 창이 연다.
deleteRouter.get('/:id/deletion-preflight', authenticateToken, async (req, res, next) => {
  try {
    const biz = await loadOwnedBusiness(req, res);
    if (!biz) return;
    const me = await User.findByPk(req.user.id, { attributes: ['password_hash'] });
    return successResponse(res, {
      name: displayNameOf(biz),
      grace_days: GRACE_DAYS,
      oauth_only: !!(me?.password_hash && me.password_hash.startsWith(OAUTH_SENTINEL_PREFIX)),
      summary: await deletionSummary(biz, req.user.id),
    });
  } catch (err) { next(err); }
});

// POST 삭제 — 대표만 · 비밀번호 · 표시명 그대로 입력. 서버가 다시 본다(화면을 믿지 않는다).
deleteRouter.post('/:id/delete', authenticateToken, async (req, res, next) => {
  try {
    const biz = await loadOwnedBusiness(req, res);
    if (!biz) return;
    const me = await User.findByPk(req.user.id, { attributes: ['id', 'password_hash'] });
    if (!me) return errorResponse(res, 'user_not_found', 404);
    // OAuth 전용 계정은 비밀번호가 없다 — 이메일 확인 코드는 다음 단계(설계 ⑤-1). 지금은 이유를 알려 막는다.
    if (me.password_hash && me.password_hash.startsWith(OAUTH_SENTINEL_PREFIX)) {
      return res.status(400).json({ success: false, message: 'oauth_otp_required', code: 'oauth_otp_required' });
    }
    const password = req.body?.password;
    if (!password) return errorResponse(res, 'password_required', 400);
    if (!(await bcrypt.compare(String(password), me.password_hash || ''))) return errorResponse(res, 'invalid_password', 403);
    if (norm(req.body?.confirm_name) !== norm(displayNameOf(biz))) {
      return res.status(400).json({ success: false, message: 'name_mismatch', code: 'name_mismatch' });
    }

    const summary = await deletionSummary(biz, me.id);
    const now = new Date();
    const purgeAfter = new Date(now.getTime() + GRACE_DAYS * 86400000);
    let landedUserIds = [];
    const t = await sequelize.transaction();
    try {
      const locked = await Business.findOne({ where: { id: biz.id, deleted_at: null }, transaction: t, lock: t.LOCK.UPDATE });
      if (!locked) { await t.rollback(); return errorResponse(res, 'Workspace not found', 404); }
      await locked.update({ deleted_at: now, deletion_reason: 'owner_request', deleted_by: me.id, purge_after: purgeAfter }, { transaction: t });
      if (locked.cue_user_id) {
        await User.update({ status: 'deleted' }, { where: { id: locked.cue_user_id, is_ai: true }, transaction: t });
      }
      // 정본을 먼저 비운다 — 안 비우면 창이 실어 보내는 X-Workspace-Id 가 정본과 같아 requestScope 가 통과시킨다(설계 ④).
      //   다음 /me 가 pickActiveBusinessId 로 남은 워크스페이스(없으면 null)를 고른다.
      landedUserIds = (await User.findAll({ where: { active_business_id: biz.id }, attributes: ['id'], transaction: t, raw: true })).map((u) => u.id);
      if (landedUserIds.length) {
        await User.update({ active_business_id: null }, { where: { id: { [Op.in]: landedUserIds } }, transaction: t });
      }
      await t.commit();
    } catch (e) { await t.rollback().catch(() => {}); throw e; }

    workspaceAliveGate.invalidate();   // 30초 캐시가 지운 워크스페이스를 열어 두지 않게(설계 지적 1)

    // 열린 창을 옮긴다 — 외부 발송(메일·푸시)은 없다(설계 ③-1). 멤버는 business 방, 이 워크스페이스를 보던 고객은 user 방으로.
    try {
      const io = req.app.get('io');
      if (io) {
        const payload = { business_id: biz.id };
        io.to(`business:${biz.id}`).emit('workspace:deleted', payload);
        for (const uid of landedUserIds) io.to(`user:${uid}`).emit('workspace:deleted', payload);
        io.in(`business:${biz.id}`).socketsLeave(`business:${biz.id}`);
      }
    } catch (e) { console.warn('[workspace delete] socket', e.message); }

    // ★ 플랫폼 행으로 남긴다(businessId null · 대상 = 그 워크스페이스) — 지운 뒤에는 워크스페이스 플랜으로 보관기간을
    //   못 읽어 retain_until 이 NULL(영구)이 된다(retentionPolicy: 삭제본은 «삭제 흐름이 소유»). 삭제 기록은 플랫폼 보관기간을 따른다.
    logAudit(req, {
      action: 'business.delete', targetType: 'business', targetId: biz.id, businessId: null,
      oldValue: { name: displayNameOf(biz), ...summary },
      newValue: { deleted_at: now, purge_after: purgeAfter, reason: 'owner_request' },
    });
    return successResponse(res, { deleted: true, purge_after: purgeAfter });
  } catch (err) { next(err); }
});

const restoreRouter = express.Router();

// 대표가 지운(owner_request) 것만 · 정리 전 · 유예 안. 계정 탈퇴로 지운 것은 계정 복구가 되살린다(설계 ⑥).
const restorableWhere = (userId) => ({
  owner_id: userId,
  deleted_at: { [Op.ne]: null },
  deletion_reason: 'owner_request',
  purged_at: null,
  purge_after: { [Op.gt]: new Date() },
});

restoreRouter.get('/me/deleted-workspaces', authenticateToken, async (req, res, next) => {
  try {
    const rows = await Business.findAll({
      where: restorableWhere(req.user.id),
      attributes: ['id', 'name', 'brand_name', 'deleted_at', 'purge_after'],
      order: [['deleted_at', 'DESC']],
    });
    return successResponse(res, rows.map((b) => ({ id: b.id, name: displayNameOf(b), deleted_at: b.deleted_at, purge_after: b.purge_after })));
  } catch (err) { next(err); }
});

// 되돌리는 쪽이라 비밀번호를 다시 묻지 않는다(설계 ⑤-3). 사칭 중에는 막는다.
restoreRouter.post('/me/deleted-workspaces/:workspaceId/restore', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.impersonator) return errorResponse(res, 'impersonation_cannot_restore_workspace', 403);
    const id = Number(req.params.workspaceId);
    const t = await sequelize.transaction();
    let biz;
    let prevDeletedAt = null;
    try {
      biz = await Business.findOne({ where: { id, ...restorableWhere(req.user.id) }, transaction: t, lock: t.LOCK.UPDATE });
      if (!biz) { await t.rollback(); return errorResponse(res, 'Workspace not found', 404); }
      prevDeletedAt = biz.deleted_at;
      await biz.update({ deleted_at: null, deletion_reason: null, deleted_by: null, purge_after: null }, { transaction: t });
      if (biz.cue_user_id) {
        await User.update({ status: 'active' }, { where: { id: biz.cue_user_id, is_ai: true }, transaction: t });
      }
      await t.commit();
    } catch (e) { await t.rollback().catch(() => {}); throw e; }

    workspaceAliveGate.invalidate();

    // 열린 멤버 창을 다시 그 방에 붙인다 — 삭제 때 socketsLeave 로 뗐다.
    try {
      const io = req.app.get('io');
      if (io) {
        const mems = await BusinessMember.findAll({ where: { business_id: id, removed_at: null }, attributes: ['user_id'], raw: true });
        for (const m of mems) if (m.user_id) io.in(`user:${m.user_id}`).socketsJoin(`business:${id}`);
        io.to(`business:${id}`).emit('workspace:restored', { business_id: id });
      }
    } catch (e) { console.warn('[workspace restore] socket', e.message); }

    logAudit(req, {
      action: 'business.restore', targetType: 'business', targetId: id, businessId: id,
      oldValue: { deleted_at: prevDeletedAt },
      newValue: { restored: true },
    });
    return successResponse(res, { restored: true, id, name: displayNameOf(biz) });
  } catch (err) { next(err); }
});

module.exports = { deleteRouter, restoreRouter, GRACE_DAYS };
