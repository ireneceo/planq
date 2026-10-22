// routes/activity.js — 워크스페이스 활동 타임라인 (owner/admin 전용, 읽기)
//   6개 원장(감사·업무·청구·프로젝트·bill·메시지)을 통합한 event_stream 을 노출한다.
//   읽기 전용 — 쓰기·부작용 0. 멤버/고객은 볼 수 없다(운영 뷰).
//   scope=admin(기본) = 감사 중 «관리 행위» 표(services/activityLabels)에 있는 것만 · scope=all = 종전 7소스 전부.
//   ★ 항목 이름은 싣지 않는다(«나만 보기» 제목이 감사 값에 있을 수 있다). 사람·부서·팀 대상만 target_label.
//   ★ 급여 행위는 보는 사람이 급여 담당(대표 + 지정)일 때만 — admin 은 자동 열람자가 아니다(services/payrollAccess).
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { getWorkspaceStream } = require('../services/event_stream');
const { adminActions, labelOf } = require('../services/activityLabels');

async function attachTargetLabels(businessId, events) {
  const { BusinessMember, User, Department, Team } = require('../models');
  const want = (type) => [...new Set(events.filter((e) => e.entity_type === type && e.entity_id).map((e) => e.entity_id))];
  const [bmIds, userIds, deptIds, teamIds] = [want('business_member'), want('user'), want('department'), want('team')];
  const map = new Map();
  if (bmIds.length) {
    const rows = await BusinessMember.unscoped().findAll({
      where: { id: bmIds, business_id: businessId },
      include: [{ model: User, as: 'user', attributes: ['name'], required: false }],
      attributes: ['id', 'name', 'invite_email'],
    });
    rows.forEach((r) => map.set(`business_member:${r.id}`, r.name || r.user?.name || r.invite_email || null));
  }
  if (userIds.length) {
    const rows = await BusinessMember.unscoped().findAll({
      where: { user_id: userIds, business_id: businessId },
      include: [{ model: User, as: 'user', attributes: ['name'], required: false }],
      attributes: ['user_id', 'name'],
    });
    rows.forEach((r) => map.set(`user:${r.user_id}`, r.name || r.user?.name || null));
  }
  if (deptIds.length && Department) {
    (await Department.findAll({ where: { id: deptIds, business_id: businessId }, attributes: ['id', 'name'], raw: true }))
      .forEach((r) => map.set(`department:${r.id}`, r.name));
  }
  if (teamIds.length && Team) {
    (await Team.findAll({ where: { id: teamIds, business_id: businessId }, attributes: ['id', 'name'], raw: true }))
      .forEach((r) => map.set(`team:${r.id}`, r.name));
  }
  return events.map((e) => ({
    ...e,
    label_key: e.source === 'audit' ? labelOf(e.kind) : null,
    target_label: map.get(`${e.entity_type}:${e.entity_id}`) || null,
  }));
}

// GET /api/activity/:businessId?scope=admin|all&since=&actor=&kinds=audit,task&limit=100
router.get('/:businessId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const isOwnerAdmin = req.businessRole === 'owner'
      || req.businessRole === 'admin'
      || req.user.platform_role === 'platform_admin';
    if (!isOwnerAdmin) return errorResponse(res, 'owner_only', 403);

    const businessId = parseInt(req.params.businessId, 10);
    const { since, actor, kinds, limit } = req.query;
    const scope = req.query.scope === 'all' ? 'all' : 'admin';
    const payroll = await require('../services/payrollAccess')
      .canManagePayroll(req.user.id, businessId, req.user.platform_role).catch(() => false);
    const opts = {
      since: since || null,
      actor: actor ? parseInt(actor, 10) : null,
      kinds: kinds ? String(kinds).split(',').map((s) => s.trim()).filter(Boolean) : null,
      limit: limit ? parseInt(limit, 10) : 100,
    };
    if (scope === 'admin') {
      opts.kinds = ['audit'];
      opts.actions = adminActions({ includePayroll: payroll });
    } else if (!payroll) {
      opts.excludeActionPrefix = 'payroll.';
    }
    const events = await getWorkspaceStream(businessId, opts);
    return successResponse(res, await attachTargetLabels(businessId, events));
  } catch (e) { next(e); }
});

void Op;
module.exports = router;
