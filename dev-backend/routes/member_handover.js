// 퇴사 인수인계 — 남은 것 세기 · 넘기기 · «나간 멤버 — 남은 것» 목록. 설계 docs/ORG_STAGE0_DESIGN.md 9절.
//   ★ 이미 해제된 멤버도 찾는다 — BusinessMember 는 defaultScope(removed_at NULL)라 기본 조회로는 404 가 된다(Fable 차단 1).
//   일의 판정·실행은 services/memberHandover 한 곳. 여기는 HTTP 와 권한만.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { BusinessMember, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const H = require('../services/memberHandover');

async function loadTarget(req, res) {
  const businessId = Number(req.params.businessId);
  if (!Number.isInteger(businessId)) { errorResponse(res, 'invalid_business', 400); return null; }
  if (!(await H.canManageMembership(req, businessId))) { errorResponse(res, 'forbidden', 403); return null; }
  const member = await BusinessMember.unscoped().findOne({
    where: { id: Number(req.params.memberId), business_id: businessId },
  });
  if (!member || !member.user_id) { errorResponse(res, 'member_not_found', 404); return null; }
  if (member.role === 'ai') { errorResponse(res, 'ai_role_locked', 400); return null; }
  return { businessId, member };
}

// GET /api/businesses/:businessId/members/:memberId/handover — 남은 것 수
router.get('/:businessId/members/:memberId/handover', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadTarget(req, res);
    if (!ctx) return;
    const sum = await H.summarize(ctx.businessId, ctx.member.user_id);
    return successResponse(res, { member_id: ctx.member.id, user_id: ctx.member.user_id, removed: !!ctx.member.removed_at, ...sum });
  } catch (e) { next(e); }
});

// POST /api/businesses/:businessId/members/:memberId/handover { to_user_id }
// audit-exempt: services/memberHandover.apply 가 business_member.handover·task.handover·project.handover·client.updated 를 남긴다
router.post('/:businessId/members/:memberId/handover', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadTarget(req, res);
    if (!ctx) return;
    const toUserId = Number(req.body?.to_user_id);
    if (!(await H.assertRecipient(ctx.businessId, ctx.member.user_id, toUserId))) {
      return errorResponse(res, 'invalid_recipient', 400);
    }
    const actor = { kind: 'user', userId: req.user.id, req };
    const out = await H.apply({ businessId: ctx.businessId, fromUserId: ctx.member.user_id, toUserId, actor, io: req.app.get('io') });
    const after = await H.summarize(ctx.businessId, ctx.member.user_id);
    return successResponse(res, { ...out, remaining: after });
  } catch (e) { next(e); }
});

// GET /api/businesses/:businessId/members-departed — 나간 멤버 중 남은 것이 있는 사람만
router.get('/:businessId/members-departed', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await H.canManageMembership(req, businessId))) return errorResponse(res, 'forbidden', 403);
    const rows = await BusinessMember.unscoped().findAll({
      where: { business_id: businessId, removed_at: { [Op.ne]: null }, user_id: { [Op.ne]: null }, role: { [Op.ne]: 'ai' } },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'], required: false }],
      order: [['removed_at', 'DESC']],
      limit: 200,
    });
    // 같은 사람이 다시 들어와 활성 멤버면 빼고, 같은 사람의 해제 행이 여럿이면 최근 것 하나만
    const active = new Set((await BusinessMember.findAll({ where: { business_id: businessId, user_id: rows.map((r) => r.user_id) }, attributes: ['user_id'], raw: true })).map((r) => r.user_id));
    const seen = new Set(); const out = [];
    for (const r of rows) {
      if (active.has(r.user_id) || seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      const sum = await H.summarize(businessId, r.user_id);
      if (sum.total + sum.counts.mail_assigned + sum.counts.booking_open === 0) continue;
      out.push({
        member_id: r.id, user_id: r.user_id, removed_at: r.removed_at,
        name: r.name || r.user?.name || null, email: r.user?.email || null,
        total: sum.total, private_total: sum.private_total, counts: sum.counts,
      });
    }
    return successResponse(res, out);
  } catch (e) { next(e); }
});

module.exports = router;
