// 업무 «산출물» — 사전 CRUD + 업무별 산출물 지정 (docs/TASK_DELIVERABLES_DESIGN.md §3.3)
//
// Irene 2026-11-19: «업무설명에 필요한 산출물 선택하게 하는 거 어때? 기본 산출물들 자동 검색되게 미리 넣어두고
//   없는 건 입력되게 해서 저장되게.»
//
// ★ mount 는 `/api/tasks` 체인에서 task_tags 바로 다음(tasks.js 의 `GET /:id` 보다 앞).
//   파일 안 순서: 리터럴(`/output-kinds/presets`) → `/output-kinds/:kindId` → `/:id/output-kinds`.
// ★ 고객은 전부 403 — 사전에는 다른 고객 일에 쓴 이름이 섞여 있다. 고객은 업무 상세(`/:id/detail`)로 그 업무 것만 읽는다.
// 서버 오류는 코드로 준다 — 화면이 i18n 키로 옮긴다(서버 한글 문장을 그대로 띄우지 않는다).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requestScope, staleResponse } = require('../middleware/workspaceContext');
const { assertMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { Task, TaskOutputKind, TaskOutputKindLink } = require('../models');
const { sequelize } = require('../config/database');
const { logAudit } = require('../services/auditService');
const outputs = require('../services/taskOutputKinds');

async function requireMember(req, res) {
  const wsScope = requestScope(req, req.body?.business_id || req.query?.business_id);
  if (wsScope.stale) { staleResponse(res, wsScope); return null; }
  const businessId = Number(wsScope.businessId);
  if (!businessId) { errorResponse(res, 'business_id required', 400); return null; }
  if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  return businessId;
}

// 사전 변경 broadcast — 바뀔 때만(find 로 끝난 POST 는 울리지 않는다).
function broadcastDict(req, businessId) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`business:${businessId}`).emit('task_output_kind:updated', { business_id: businessId, actor_user_id: req.user.id });
}

// ─── GET /api/tasks/output-kinds — 이 워크스페이스 사전 + 사용 수 ───
router.get('/output-kinds', authenticateToken, async (req, res, next) => {
  try {
    const businessId = await requireMember(req, res);
    if (!businessId) return;
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await TaskOutputKind.findAndCountAll({
      where: { business_id: businessId }, order: [['name', 'ASC']], limit, offset,
    });
    const [counts] = await sequelize.query(
      `SELECT l.output_kind_id AS kid, COUNT(*) AS c
         FROM task_output_kind_links l
         JOIN task_output_kinds k ON k.id = l.output_kind_id
        WHERE k.business_id = :biz
        GROUP BY l.output_kind_id`,
      { replacements: { biz: businessId } }
    );
    const usage = new Map(counts.map((r) => [Number(r.kid), Number(r.c)]));
    const data = rows.map((r) => ({ ...outputs.serialize(r), usage_count: usage.get(r.id) || 0 })).sort(outputs.compare);
    return paginatedResponse(res, data, count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /api/tasks/output-kinds/presets — 기본 목록(코드 정본) ───
router.get('/output-kinds/presets', authenticateToken, async (req, res, next) => {
  try {
    const businessId = await requireMember(req, res);
    if (!businessId) return;
    return successResponse(res, outputs.presets());
  } catch (err) { next(err); }
});

// ─── POST /api/tasks/output-kinds — find-or-create ({preset_key} | {name}) ───
router.post('/output-kinds', authenticateToken, async (req, res, next) => {
  try {
    const businessId = await requireMember(req, res);
    if (!businessId) return;
    let r;
    if (req.body.preset_key !== undefined && req.body.preset_key !== null) {
      const key = String(req.body.preset_key);
      if (!outputs.isPresetKey(key)) return errorResponse(res, 'unknown_preset', 400);
      const e = await outputs.ensurePresetRow(businessId, key, req.user.id);
      r = { ok: true, row: e.row, created: e.created };
    } else {
      r = await outputs.createCustom(businessId, req.body.name, req.user.id);
      if (!r.ok) return errorResponse(res, r.code, 400);
    }
    if (r.created) {
      logAudit(req, {
        action: 'task_output_kind.create', targetType: 'task_output_kind', targetId: r.row.id, businessId,
        newValue: { name: r.row.name, preset_key: r.row.preset_key || null },
      });
      broadcastDict(req, businessId);
    }
    return successResponse(res, outputs.serialize(r.row), r.created ? 'Output kind created' : undefined, r.created ? 201 : 200);
  } catch (err) { next(err); }
});

// 사전 행 하나 — 그 행의 business_id 로 멤버 판정(남의 워크스페이스 id 는 403)
async function loadOwnRow(req, res) {
  const row = await TaskOutputKind.findByPk(Number(req.params.kindId));
  if (!row) { errorResponse(res, 'output_kind_not_found', 404); return null; }
  if (!(await assertMemberOrAbove(req.user.id, row.business_id, req.user.platform_role))) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  return row;
}

// ─── PUT /api/tasks/output-kinds/:kindId — 이름 바꾸기(직접 입력 행만) ───
router.put('/output-kinds/:kindId', authenticateToken, async (req, res, next) => {
  try {
    const row = await loadOwnRow(req, res);
    if (!row) return;
    if (row.preset_key) return errorResponse(res, 'preset_not_renamable', 400);
    const name = outputs.normalizeName(req.body.name);
    if (!name) return errorResponse(res, 'name_required', 400);
    if (name.length > outputs.MAX_NAME) return errorResponse(res, 'name_too_long', 400);
    if (outputs.presetKeyOfName(name)) return errorResponse(res, 'matches_preset', 409);
    if (name === row.name) return successResponse(res, outputs.serialize(row));
    const dup = await TaskOutputKind.findOne({ where: { business_id: row.business_id, name } });
    if (dup && dup.id !== row.id) return errorResponse(res, 'duplicate_name', 409);
    const old = row.name;
    await row.update({ name });
    logAudit(req, {
      action: 'task_output_kind.update', targetType: 'task_output_kind', targetId: row.id, businessId: row.business_id,
      oldValue: { name: old }, newValue: { name },
    });
    broadcastDict(req, row.business_id);
    return successResponse(res, outputs.serialize(row), 'Output kind updated');
  } catch (err) { next(err); }
});

// ─── DELETE /api/tasks/output-kinds/:kindId — 삭제(직접 입력 행만 · 연결 CASCADE) ───
router.delete('/output-kinds/:kindId', authenticateToken, async (req, res, next) => {
  try {
    const row = await loadOwnRow(req, res);
    if (!row) return;
    if (row.preset_key) return errorResponse(res, 'preset_not_deletable', 400);
    const businessId = row.business_id;
    const usage = await TaskOutputKindLink.count({ where: { output_kind_id: row.id } });
    const snapshot = { name: row.name, usage_count: usage };
    const id = row.id;
    await row.destroy();
    logAudit(req, { action: 'task_output_kind.delete', targetType: 'task_output_kind', targetId: id, businessId, oldValue: snapshot });
    broadcastDict(req, businessId);
    return successResponse(res, { id, deleted: true, removed_links: usage });
  } catch (err) { next(err); }
});

// ─── PUT /api/tasks/:id/output-kinds — 업무의 산출물 지정 ───
// body: { output_kind_ids: number[], series_scope? }
// audit-exempt: 감사는 행동 계층이 남긴다(이 라우트는 위임만 한다)
router.put('/:id/output-kinds', authenticateToken, async (req, res, next) => {
  try {
    const task = await Task.findByPk(Number(req.params.id));
    if (!task) return errorResponse(res, 'task_not_found', 404);
    const raw = Array.isArray(req.body.output_kind_ids) ? req.body.output_kind_ids : [];
    const { setOutputKinds } = require('../services/actions/task_output_actions');
    const r = await setOutputKinds(task, { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req },
      { kindIds: raw, seriesScope: req.body.series_scope });
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);
    return successResponse(res, { id: task.id, output_kinds: r.data.output_kinds });
  } catch (err) { next(err); }
});

module.exports = router;
