// 계정 삭제(회원 탈퇴) — preflight / request / 복구. ACCOUNT_DELETION_DESIGN v3.
//   App Store 5.1.1(v). soft delete(status='deleted') + 30일 유예 → 익명화 cron.
//   여기는 preflight(판정)만. request/복구/익명화는 후속 단계.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, Business, BusinessMember, Client, Invoice, ClientSubscription, ExternalConnection, EmailAccount, File } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

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

// GET preflight — 탈퇴 가능 여부 + 차단 사유 + 경고 + 삭제될 데이터 요약
router.get('/me/deletion-preflight', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const me = await User.findByPk(userId, { attributes: ['id', 'is_ai', 'platform_role', 'status'] });
    if (!me) return errorResponse(res, 'user_not_found', 404);
    if (me.is_ai) return errorResponse(res, 'ai_account_cannot_delete', 400);

    const blockers = [];
    const warnings = [];

    // 내가 owner 인 워크스페이스들
    const ownedBusinesses = await Business.findAll({
      where: { owner_id: userId, deleted_at: null },
      attributes: ['id', 'name', 'brand_name'],
    });

    const transferRequired = [];   // 데이터 있어 이전 필요
    const soloToDelete = [];       // 데이터 없어 동반 삭제될 워크스페이스
    for (const biz of ownedBusinesses) {
      const { hasData, detail } = await workspaceHasData(biz.id, userId);
      const label = biz.brand_name || biz.name;
      if (hasData) transferRequired.push({ id: biz.id, name: label, ...detail });
      else soloToDelete.push({ id: biz.id, name: label });
    }
    if (transferRequired.length) {
      blockers.push({ code: 'transfer_required', businesses: transferRequired });
    }

    // 유일한 활성 platform_admin 인가
    if (me.platform_role === 'platform_admin') {
      const otherAdmins = await User.count({
        where: { platform_role: 'platform_admin', status: 'active', is_ai: false, id: { [Op.ne]: userId } },
      });
      if (otherAdmins === 0) blockers.push({ code: 'last_platform_admin' });
    }

    // 경고(차단 아님) — 미수금·유료구독이 걸린 워크스페이스(이전 대상엔 이미 반영됐지만 명시)
    const unpaidTotal = transferRequired.reduce((s, b) => s + (b.unpaid || 0), 0);
    if (unpaidTotal > 0) warnings.push({ code: 'has_unpaid_invoices', count: unpaidTotal });
    const paidSubTotal = transferRequired.reduce((s, b) => s + (b.paidSub || 0), 0);
    if (paidSubTotal > 0) warnings.push({ code: 'has_active_subscription', count: paidSubTotal });

    // 삭제될 개인 데이터 요약 (참고용)
    const [privateFiles, extConns, emailAccts] = await Promise.all([
      File.count({ where: { uploader_id: userId, visibility: 'L1' } }).catch(() => 0),
      ExternalConnection.count({ where: { user_id: userId } }).catch(() => 0),
      EmailAccount.count({ where: { user_id: userId } }).catch(() => 0),
    ]);

    return successResponse(res, {
      can_delete: blockers.length === 0,
      blockers,
      warnings,
      solo_workspaces_to_delete: soloToDelete,
      data_summary: {
        private_files: privateFiles,
        external_connections: extConns,
        email_accounts: emailAccts,
        // Q Note 는 별도 FastAPI — request 시점에 purge 안내
      },
      grace_days: 30,
    });
  } catch (err) { next(err); }
});

module.exports = router;
