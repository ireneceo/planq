// routes/task_action_items.js — 업무 «결과물 액션» (2026-10-12, 설계 docs/TASK_ACTIONS_DESIGN.md §3.4)
//
//   /api/tasks/:id/actions…   — 목록·추가·고치기·삭제·연결·해제 (server.js 에서 routes/tasks.js **앞**에 마운트)
//   /api/task-actions/:aid/handoff — 대상 화면(문서·일정)이 ?from_action= 으로 열릴 때 읽는 것
//
// 판정·쓰기는 services/taskActionItems 한 곳이다. 여기는 파싱 + 응답뿐.
//   적기 = 작성자·담당자·owner·admin / 만들러 가기·연결·해제 = 담당자만(직급 예외 없음) / 고객에게는 목록을 내지 않는다.
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { TaskActionItem } = require('../models');
const svc = require('../services/taskActionItems');

const router = express.Router();
const handoffRouter = express.Router();

const actorOf = (req) => ({ userId: req.user.id, platformRole: req.user.platform_role, req });
const userOf = (req) => ({ id: req.user.id, platform_role: req.user.platform_role });
const send = (res, r, okHttp = 200) => (r.ok ? successResponse(res, r.data, undefined, okHttp) : errorResponse(res, r.code, r.http || 400));

function cleanLabel(v) { return typeof v === 'string' ? v.trim().slice(0, 200) : ''; }
function cleanNote(v) {
  if (v === null) return null;
  return typeof v === 'string' ? (v.trim().slice(0, 1000) || null) : undefined;
}
function cleanMeta(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const s = JSON.stringify(v);
  return s.length <= 2000 ? v : undefined;
}

async function loadEditable(req, res) {
  const lt = await svc.loadTaskFor(req.user.id, req.user.platform_role, req.params.id);
  if (lt.fail) { errorResponse(res, lt.fail.code, lt.fail.http); return null; }
  return lt;
}

// GET /api/tasks/:id/actions — 목록(+ 대상 요약, 보는 사람 기준)
router.get('/:id/actions', authenticateToken, async (req, res, next) => {
  try {
    const lt = await loadEditable(req, res);
    if (!lt) return;
    return successResponse(res, await svc.serializeList(lt.task, userOf(req), lt.scope));
  } catch (err) { next(err); }
});

// POST /api/tasks/:id/actions { kind, label, note?, meta? }
router.post('/:id/actions', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 서비스 services/taskActionItems(audit·fulfill·unlink)가 쓴다(task.action_*)
  try {
    const lt = await loadEditable(req, res);
    if (!lt) return;
    const { task, scope } = lt;
    if (!svc.canEditList(task, req.user.id, scope)) return errorResponse(res, 'forbidden', 403);
    const kind = String(req.body?.kind || '');
    if (!svc.KINDS[kind]) return errorResponse(res, 'invalid_kind', 400);
    if (!svc.KINDS[kind].enabled) return errorResponse(res, 'kind_disabled', 400);
    const label = cleanLabel(req.body?.label);
    if (!label) return errorResponse(res, 'label_required', 400);
    const count = await TaskActionItem.count({ where: { task_id: task.id } });
    if (count >= svc.MAX_PER_TASK) return errorResponse(res, 'too_many_actions', 400);
    const maxOrder = (await TaskActionItem.max('order_index', { where: { task_id: task.id } })) ?? -1;
    const item = await TaskActionItem.create({
      business_id: task.business_id, task_id: task.id, order_index: Number(maxOrder) + 1,
      kind, label, note: cleanNote(req.body?.note) ?? null, meta: cleanMeta(req.body?.meta) ?? null,
      status: 'pending', created_by: req.user.id,
    });
    svc.audit(actorOf(req), 'task.action_added', item);
    svc.broadcast(task, req.user.id);
    return successResponse(res, item, undefined, 201);
  } catch (err) { next(err); }
});

// PATCH /api/tasks/:id/actions/:aid { label?, note?, meta?, order_index?, status?: 'skipped'|'pending' }
router.patch('/:id/actions/:aid', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 서비스 services/taskActionItems(audit·fulfill·unlink)가 쓴다(task.action_*)
  try {
    const lt = await loadEditable(req, res);
    if (!lt) return;
    const { task, scope } = lt;
    const item = await TaskActionItem.findOne({ where: { id: Number(req.params.aid), task_id: task.id, business_id: task.business_id } });
    if (!item) return errorResponse(res, 'action_not_found', 404);
    if (!svc.canEditList(task, req.user.id, scope)) return errorResponse(res, 'forbidden', 403);
    const b = req.body || {};
    const patch = {};
    if (b.label !== undefined) {
      const l = cleanLabel(b.label);
      if (!l) return errorResponse(res, 'label_required', 400);
      patch.label = l;
    }
    if (b.note !== undefined) { const n = cleanNote(b.note); if (n !== undefined) patch.note = n; }
    if (b.meta !== undefined) { const m = cleanMeta(b.meta); if (m !== undefined) patch.meta = m; }
    if (b.order_index !== undefined) {
      const o = Number(b.order_index);
      if (!Number.isInteger(o) || o < 0 || o > 10000) return errorResponse(res, 'invalid_order', 400);
      patch.order_index = o;
    }
    let audited = 'task.action_updated';
    if (b.status !== undefined) {
      // 완료는 «만들어진 것» 으로만 된다 — 손으로 completed/active 를 쓰지 않는다. 건너뜀은 연결이 없을 때만.
      if (b.status === 'skipped') {
        if (item.linked_entity_id) return errorResponse(res, 'action_linked_unlink_first', 409);
        patch.status = 'skipped'; audited = 'task.action_skipped';
      } else if (b.status === 'pending') {
        if (item.status !== 'skipped') return errorResponse(res, 'invalid_status', 400);
        patch.status = 'pending'; audited = 'task.action_unskipped';
      } else return errorResponse(res, 'invalid_status', 400);
    }
    if (!Object.keys(patch).length) return successResponse(res, item);
    const before = { label: item.label, note: item.note, status: item.status, order_index: item.order_index };
    await item.update(patch);
    svc.audit(actorOf(req), audited, item, { before });
    svc.broadcast(task, req.user.id);
    return successResponse(res, item);
  } catch (err) { next(err); }
});

// DELETE /api/tasks/:id/actions/:aid — 완료·작성 중인 것은 먼저 해제(결과물에 들어간 첨부가 조용히 빠지지 않게)
router.delete('/:id/actions/:aid', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 서비스 services/taskActionItems(audit·fulfill·unlink)가 쓴다(task.action_*)
  try {
    const lt = await loadEditable(req, res);
    if (!lt) return;
    const { task, scope } = lt;
    const item = await TaskActionItem.findOne({ where: { id: Number(req.params.aid), task_id: task.id, business_id: task.business_id } });
    if (!item) return errorResponse(res, 'action_not_found', 404);
    if (!svc.canEditList(task, req.user.id, scope)) return errorResponse(res, 'forbidden', 403);
    if (item.linked_entity_id) return errorResponse(res, 'action_linked_unlink_first', 409);
    await item.destroy();
    svc.audit(actorOf(req), 'task.action_removed', item);
    svc.broadcast(task, req.user.id);
    return successResponse(res, { id: item.id, deleted: true });
  } catch (err) { next(err); }
});

// POST /api/tasks/:id/actions/:aid/link { entity_type, entity_id } — «기존 것 연결» (담당자만)
router.post('/:id/actions/:aid/link', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 서비스 services/taskActionItems(audit·fulfill·unlink)가 쓴다(task.action_*)
  try {
    const lt = await loadEditable(req, res);
    if (!lt) return;
    const { task } = lt;
    const r = await svc.fulfill(actorOf(req), {
      actionId: req.params.aid, businessId: task.business_id, taskId: task.id,
      entityType: String(req.body?.entity_type || ''), entityId: req.body?.entity_id, source: 'manual',
    });
    return send(res, r.ok ? { ok: true, data: { id: r.data.item.id, status: r.data.item.status, linked_entity_type: r.data.item.linked_entity_type, linked_entity_id: r.data.item.linked_entity_id } } : r);
  } catch (err) { next(err); }
});

// DELETE /api/tasks/:id/actions/:aid/link — 해제 (담당자만)
router.delete('/:id/actions/:aid/link', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 서비스 services/taskActionItems(audit·fulfill·unlink)가 쓴다(task.action_*)
  try {
    const r = await svc.unlink(actorOf(req), { actionId: req.params.aid, taskId: req.params.id });
    return send(res, r.ok ? { ok: true, data: { id: r.data.item.id, status: r.data.item.status } } : r);
  } catch (err) { next(err); }
});

// GET /api/task-actions/:aid/handoff
handoffRouter.get('/:aid/handoff', authenticateToken, async (req, res, next) => {
  try {
    return send(res, await svc.handoff(userOf(req), req.params.aid));
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.handoffRouter = handoffRouter;
