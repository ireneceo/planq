// 열람 요청 · 잠금 줄 · 워크스페이스 설정 · 항목 «검색에서 숨김» (2026-11-25, Irene «권고대로» · 설계 docs/FILE_SEARCH_DISCOVERY_DESIGN.md §2·§3)
//
//   GET  /api/access-requests/:businessId/locked?q=&types=file,post   잠금 줄(Q file 검색 · 통합 검색은 /api/search 가 같은 함수)
//   POST /api/access-requests/:businessId            { entity_type, entity_id, message? }   요청(잠금 술어 통과한 것만, 아니면 같은 404)
//   GET  /api/access-requests/:businessId/inbox                        내가 결정할 요청(대기) + 내가 승인한 것(회수용)
//   POST /api/access-requests/:businessId/:id/approve|deny|revoke|cancel
//   GET/PUT /api/access-requests/:businessId/settings { restricted_discoverable }   대표·관리자(읽기는 멤버)
//   PUT  /api/access-requests/:businessId/hide/:type/:id { hide }      올린 사람·작성자·대표·관리자(그리고 지금 읽을 수 있는 사람)
//
// ★ 고객은 들어오지 못한다(checkBusinessAccess = 멤버 이상). 판정은 services/lockedDiscovery · accessRequests · accessGrants.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { isWorkspaceAdmin, canAccessFileByLevel, canAccessPostByLevel, canShareFile, postLevelAllows } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const { AccessRequest, Business, File, Post } = require('../models');
const LD = require('../services/lockedDiscovery');
const AR = require('../services/accessRequests');
const { logAudit } = require('../services/auditService');

const TYPES = ['file', 'post'];
const bizOf = (req) => Number(req.params.businessId);

// ─── 설정 ───
router.get('/:businessId/settings', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    return successResponse(res, { restricted_discoverable: await LD.isEnabled(bizOf(req)), can_edit: isWorkspaceAdmin(req.scope) });
  } catch (e) { next(e); }
});

router.put('/:businessId/settings', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isWorkspaceAdmin(req.scope)) return errorResponse(res, 'forbidden', 403);
    const on = req.body?.restricted_discoverable;
    if (typeof on !== 'boolean') return errorResponse(res, 'restricted_discoverable must be boolean', 400);
    const biz = await Business.findByPk(bizOf(req), { attributes: ['id', 'permissions'] });
    if (!biz) return errorResponse(res, 'not_found', 404);
    const base = biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
    const before = base.restricted_discoverable === true;
    await biz.update({ permissions: { ...base, restricted_discoverable: on } });
    logAudit(req, { action: 'workspace.restricted_discoverable', targetType: 'business', targetId: biz.id, businessId: biz.id, oldValue: { restricted_discoverable: before }, newValue: { restricted_discoverable: on } });
    return successResponse(res, { restricted_discoverable: on });
  } catch (e) { next(e); }
});

// ─── 잠금 줄 ───
router.get('/:businessId/locked', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').normalize('NFC').trim();
    const types = await LD.allowedTypes(bizOf(req), req.user, String(req.query.types || 'file,post').split(',').filter((t) => TYPES.includes(t)));
    const enabled = await LD.viewerEligible(req.scope, bizOf(req));
    if (!q || !enabled || !types.length) return successResponse(res, { enabled, files: [], posts: [] });
    const M = require('../services/searchScope').makeMatcher(q);
    const out = await LD.searchLocked(req.scope, bizOf(req), M, { types, limit: Math.min(20, Math.max(1, Number(req.query.limit) || 8)) });
    return successResponse(res, { enabled, ...out });
  } catch (e) { next(e); }
});

// ─── 요청 ───
router.post('/:businessId', authenticateToken, checkBusinessAccess,
  perUserLimiter('access-request', { windowMs: 60 * 1000, max: 20 }),
  async (req, res, next) => {
    try {
      const type = String(req.body?.entity_type || '');
      const id = Number(req.body?.entity_id);
      // 하루 한도는 잠금 판정 **앞** — 뒤에 두면 한도에 걸린 뒤 429/404 차이로 id 존재가 샌다(Fable 비차단 3)
      if (await AR.overDailyLimit(bizOf(req), req.user.id)) return errorResponse(res, 'daily_limit', 429);
      // 없는 id · L1 · 숨김 · 남의 워크스페이스 · 설정 꺼짐 · 이미 볼 수 있음 · 메뉴 숨김 — 모두 같은 404
      const okType = TYPES.includes(type) && (await LD.allowedTypes(bizOf(req), req.user, [type])).length === 1;
      const row = okType ? await LD.lockedRow(req.scope, bizOf(req), type, id) : null;
      if (!row) return errorResponse(res, 'not_found', 404);
      const r = await AR.createRequest({ businessId: bizOf(req), user: req.user, type, row, message: typeof req.body?.message === 'string' ? req.body.message.trim() : null });
      if (r.error) return errorResponse(res, r.error, 429);
      if (!r.already) {
        logAudit(req, { action: 'access_request.create', targetType: `access_request_${type}`, targetId: r.request.id, businessId: bizOf(req), newValue: { entity_type: type, entity_id: row.id } });
        const nm = (await AR.peopleOf(bizOf(req), [req.user.id]).catch(() => new Map())).get(Number(req.user.id));
        await AR.notifyNew(req.app.get('io'), bizOf(req), r.request, nm?.name || null);
      }
      return successResponse(res, { id: r.request.id, status: r.request.status, already: r.already });
    } catch (e) { next(e); }
  });

// ─── 받은 요청 ───
router.get('/:businessId/inbox', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const biz = bizOf(req);
    await AR.expireStale(biz);
    const admin = isWorkspaceAdmin(req.scope);
    // 내가 결정할 것: 받은 사람(approver_id) = 나 · 대표·관리자는 워크스페이스 전부(받은 사람이 비활성이면 approver_id NULL 로 와서 관리자가 본다).
    const mine = { business_id: biz, requester_id: { [Op.ne]: req.user.id } };
    const rows = await AccessRequest.findAll({
      where: { ...mine, status: { [Op.in]: ['pending', 'approved'] }, ...(admin ? {} : { approver_id: req.user.id }) },
      order: [['created_at', 'DESC']], limit: 200,
    });
    const names = await AR.peopleOf(biz, rows.map((r) => r.requester_id)).catch(() => new Map());
    const out = { pending: [], approved: [] };
    for (const r of rows) {
      const ent = await AR.loadEntity(biz, r.entity_type, r.entity_id);
      // 이름은 **내가 지금 읽을 수 있을 때만** — 그 사이 «나만 보기» 로 바뀐 남의 항목은 이름을 싣지 않는다.
      let readable = false;
      if (ent) readable = r.entity_type === 'file' ? await canAccessFileByLevel(req.user.id, ent, req.scope) : await canAccessPostByLevel(req.user.id, ent, req.scope);
      const item = {
        id: r.id, status: r.status, entity_type: r.entity_type, entity_id: r.entity_id,
        name: readable ? (r.entity_type === 'file' ? ent.file_name : ent.title) : null,
        missing: !ent,
        requester: { id: r.requester_id, name: names.get(Number(r.requester_id))?.name || null },
        message: r.message, created_at: r.createdAt || r.get('created_at'), decided_at: r.decided_at,
      };
      (r.status === 'pending' ? out.pending : out.approved).push(item);
    }
    out.approved = out.approved.slice(0, 50);
    return successResponse(res, out);
  } catch (e) { next(e); }
});

// ─── 결정·회수·취소 ───
const NEXT = { approve: ['pending', 'approved'], deny: ['pending', 'denied'], revoke: ['approved', 'revoked'], cancel: ['pending', 'canceled'] };
router.post('/:businessId/:id/:action', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const action = req.params.action;
    if (!NEXT[action]) return errorResponse(res, 'not_found', 404);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return errorResponse(res, 'not_found', 404);
    const biz = bizOf(req);
    await AR.expireStale(biz);
    const r = await AccessRequest.findOne({ where: { id, business_id: biz } });
    if (!r) return errorResponse(res, 'not_found', 404);
    if (action === 'cancel') {
      if (Number(r.requester_id) !== Number(req.user.id)) return errorResponse(res, 'not_found', 404);
    } else if (!(await AR.canDecide(req.user, r))) return errorResponse(res, 'forbidden', 403);
    const [from, to] = NEXT[action];
    if (r.status !== from) return errorResponse(res, 'invalid_state', 409, r.status);
    if (action === 'approve') {
      // 결정하는 사람이 지금 그 항목을 **원래 권한으로** 읽을 수 있어야 승인한다(승인으로만 읽는 사람이 남에게 열어 주지 않는다).
      const ent = await AR.loadEntity(biz, r.entity_type, r.entity_id);
      const can = ent && (r.entity_type === 'file' ? await canShareFile(req.scope, req.user.id, ent) : await postLevelAllows(req.user.id, ent, req.scope));
      if (!can) return errorResponse(res, 'forbidden', 403);
      // 승인할 때도 조건을 다시 본다 — 항목이 지금 L2 이고 요청자가 지금 멤버여야 한다(아니면 승인 행이 잠복했다 되살아난다 · Fable 비차단 1).
      if (require('../services/accessGrants').levelOf(r.entity_type, ent) !== 'L2') return errorResponse(res, 'not_restricted', 409);
      const rs = await require('../middleware/access_scope').getUserScope(r.requester_id, biz);
      if (!require('../services/accessGrants').isGrantableScope(rs)) return errorResponse(res, 'requester_not_member', 409);
    }
    const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : null;
    await r.update({ status: to, decided_by: action === 'cancel' ? r.decided_by : req.user.id, decided_at: new Date(), ...(action === 'deny' ? { decision_note: note || null } : {}) });
    logAudit(req, { action: `access_request.${action}`, targetType: `access_request_${r.entity_type}`, targetId: r.id, businessId: biz, oldValue: { status: from }, newValue: { status: to, entity_id: r.entity_id, requester_id: r.requester_id } });
    if (action === 'approve' || action === 'deny') await AR.notifyDecision(req.app.get('io'), biz, r);
    else AR.emitSignal(req.app.get('io'), biz, [Number(r.requester_id), ...(await AR.recipientsOf(biz, r.approver_id))]);
    return successResponse(res, { id: r.id, status: r.status });
  } catch (e) { next(e); }
});

// ─── 항목 «검색에서 숨김» ───
router.put('/:businessId/hide/:type/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { type } = req.params;
    const id = Number(req.params.id);
    const hide = req.body?.hide;
    if (!TYPES.includes(type) || !Number.isInteger(id) || id <= 0) return errorResponse(res, 'not_found', 404);
    if (typeof hide !== 'boolean') return errorResponse(res, 'hide must be boolean', 400);
    const biz = bizOf(req);
    const row = type === 'file' ? await File.findOne({ where: { id, business_id: biz, deleted_at: null } }) : await Post.findOne({ where: { id, business_id: biz } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const readable = type === 'file' ? await canAccessFileByLevel(req.user.id, row, req.scope) : await canAccessPostByLevel(req.user.id, row, req.scope);
    if (!readable) return errorResponse(res, 'not_found', 404);
    const owner = Number(type === 'file' ? row.uploader_id : row.author_id) === Number(req.user.id);
    if (!owner && !isWorkspaceAdmin(req.scope)) return errorResponse(res, 'forbidden', 403);
    const before = !!row.hide_existence;
    if (before !== hide) {
      await row.update({ hide_existence: hide });
      logAudit(req, { action: `${type}.hide_existence`, targetType: type, targetId: id, businessId: biz, oldValue: { hide_existence: before }, newValue: { hide_existence: hide } });
    }
    return successResponse(res, { id, hide_existence: hide });
  } catch (e) { next(e); }
});

module.exports = router;
