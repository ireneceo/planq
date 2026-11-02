// routes/history_overrides.js — 자동 히스토리 한 줄의 «설명 줄» 고치기 / 원래대로 (2026-11-02)
//   Irene: *"자동기록 히스토리를 수동으로 수정하고 싶어 … 자동생성이 다시 또 되면서 엉망이 안되게 … 각 항목별 글자 수정"*
//   설계 docs/HISTORY_OVERRIDE_DESIGN.md (Fable 설계 판정). 판정·덧입힘은 services/historyOverrides 한 곳.
//
//   PUT    /api/history-overrides/:source_table/:source_id   { note, project_id? }  → 고친 글 저장(upsert)
//   DELETE /api/history-overrides/:source_table/:source_id                         → 원래대로(멱등)
//   ★ 원장은 안 고친다. business_id 는 원장 좌표에서 도출한다(요청 값·헤더를 믿지 않는다).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const svc = require('../services/historyOverrides');

function parseRef(req) {
  const t = String(req.params.source_table || '');
  const id = Number(req.params.source_id);
  if (!svc.isSourceTable(t) || !Number.isInteger(id) || id <= 0) return null;
  return { source_table: t, source_id: id };
}

// 열어 둔 화면에 신호만 보낸다(행을 싣지 않는다 — 받는 화면이 다시 읽는다).
//   업무 계열 → task:updated(공개 범위 반영 taskRoom 한 문) · 프로젝트 계열 → project:updated(수동 히스토리와 같은 줄).
function signal(req, ref, scope) {
  const io = req.app.get('io');
  if (!io) return;
  if (svc.TASK_TABLES.has(ref.source_table) && scope.task) {
    require('../services/taskRoom').emitTask(io, 'task:updated',
      { id: scope.task.id, business_id: scope.business_id, project_id: scope.project_id },
      { businessId: scope.business_id, projectId: scope.project_id }).catch((e) => console.warn('[emitTask]', e.message));
  }
  if (scope.project_id) io.to(`business:${scope.business_id}`).emit('project:updated', { id: scope.project_id });
}

function auditTarget(ref, scope) {
  if (svc.TASK_TABLES.has(ref.source_table) && scope.task) return { targetType: 'task', targetId: scope.task.id };
  return { targetType: 'project', targetId: scope.project_id };
}

router.put('/:source_table/:source_id', authenticateToken, async (req, res, next) => {
  try {
    const ref = parseRef(req);
    if (!ref) return errorResponse(res, 'not_found', 404);
    const input = svc.cleanInput(req.body);
    if (input.error) return errorResponse(res, input.error, 400, input.error);
    const auth = await svc.authorize(req.user.id, ref, { projectId: req.body?.project_id });
    if (!auth.ok) return errorResponse(res, auth.code, auth.http, auth.code);
    const { scope } = auth;
    const { HistoryOverride } = require('../models');
    const existing = await HistoryOverride.findOne({ where: { source_table: ref.source_table, source_id: ref.source_id } });
    if (existing && Number(existing.business_id) !== scope.business_id) return errorResponse(res, 'not_found', 404);
    const before = existing ? existing.note : null;
    let row;
    if (existing) {
      if (before !== input.note) await existing.update({ note: input.note, edited_by: req.user.id });
      row = existing;
    } else {
      row = await HistoryOverride.create({
        business_id: scope.business_id, source_table: ref.source_table, source_id: ref.source_id,
        note: input.note, edited_by: req.user.id,
      });
    }
    if (before !== input.note) {
      createAuditLog({
        userId: req.user.id, businessId: scope.business_id,
        action: 'history.override.set', ...auditTarget(ref, scope),
        oldValue: { ...ref, note: before }, newValue: { ...ref, note: input.note },
      });
      signal(req, ref, scope);
    }
    return successResponse(res, { ...ref, note: row.note, edited_at: row.updated_at });
  } catch (err) { next(err); }
});

router.delete('/:source_table/:source_id', authenticateToken, async (req, res, next) => {
  try {
    const ref = parseRef(req);
    if (!ref) return errorResponse(res, 'not_found', 404);
    const auth = await svc.authorize(req.user.id, ref, { projectId: req.query?.project_id || req.body?.project_id });
    if (!auth.ok) return errorResponse(res, auth.code, auth.http, auth.code);
    const { scope } = auth;
    const { HistoryOverride } = require('../models');
    const existing = await HistoryOverride.findOne({
      where: { source_table: ref.source_table, source_id: ref.source_id, business_id: scope.business_id },
    });
    if (existing) {
      const before = existing.note;
      await existing.destroy();
      createAuditLog({
        userId: req.user.id, businessId: scope.business_id,
        action: 'history.override.clear', ...auditTarget(ref, scope),
        oldValue: { ...ref, note: before }, newValue: { ...ref, note: null },
      });
      signal(req, ref, scope);
    }
    return successResponse(res, { ...ref, restored: true });
  } catch (err) { next(err); }
});

module.exports = router;
