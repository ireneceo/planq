// KNOWLEDGE_LOOP 축1 — Cue 워크스페이스 지식 카드 CRUD (docs/KNOWLEDGE_LOOP_DESIGN.md)
//   조회는 멤버, 변경(추가/수락/거절/수정/삭제)은 owner/admin.
const express = require('express');
const router = express.Router();
const { CueKnowledge } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');

function isAdmin(req) {
  return req.businessRole === 'owner'
    || req.businessRole === 'admin'
    || req.user?.platform_role === 'platform_admin';
}

const KINDS = ['work_pattern', 'client_trait', 'terminology', 'decision', 'custom'];

// GET — 목록 (status 필터). 멤버 이상.
router.get('/:businessId/cue-knowledge', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId };
    if (req.query.status && ['pending', 'active', 'rejected'].includes(req.query.status)) where.status = req.query.status;
    const rows = await CueKnowledge.findAll({
      where,
      order: [['status', 'ASC'], ['updated_at', 'DESC']],
      limit: 200,
    });
    return successResponse(res, rows);
  } catch (err) { next(err); }
});

// POST — 직접 추가 (admin). 사용자 등록은 즉시 active.
router.post('/:businessId/cue-knowledge', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const body = String(b.body || '').trim();
    if (!title || !body) return errorResponse(res, 'title_body_required', 400);
    const kind = KINDS.includes(b.kind) ? b.kind : 'custom';
    const row = await CueKnowledge.create({
      business_id: req.params.businessId,
      kind,
      title: title.slice(0, 200),
      body: body.slice(0, 2000),
      source: 'user',
      status: 'active',
      created_by: req.user.id,
    });
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'cue_knowledge.create', targetType: 'CueKnowledge', targetId: row.id,
      newValue: { kind, title: row.title },
    });
    return successResponse(res, row, 'created', 201);
  } catch (err) { next(err); }
});

// PUT — 수정 / 수락(status active) / 거절(rejected). admin.
router.put('/:businessId/cue-knowledge/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const row = await CueKnowledge.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const b = req.body || {};
    const patch = {};
    if (b.title !== undefined) patch.title = String(b.title).trim().slice(0, 200);
    if (b.body !== undefined) patch.body = String(b.body).trim().slice(0, 2000);
    if (b.kind !== undefined && KINDS.includes(b.kind)) patch.kind = b.kind;
    if (b.status !== undefined && ['pending', 'active', 'rejected'].includes(b.status)) {
      patch.status = b.status;
      patch.decided_by = req.user.id;
      patch.decided_at = new Date();
    }
    await row.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'cue_knowledge.update', targetType: 'CueKnowledge', targetId: row.id,
      newValue: { fields: Object.keys(patch), status: row.status },
    });
    return successResponse(res, row);
  } catch (err) { next(err); }
});

// DELETE — admin.
router.delete('/:businessId/cue-knowledge/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const row = await CueKnowledge.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    await row.destroy();
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'cue_knowledge.delete', targetType: 'CueKnowledge', targetId: Number(req.params.id),
    });
    return successResponse(res, null, 'deleted');
  } catch (err) { next(err); }
});

// POST /mine/run — 채굴 수동 트리거 (admin, 검증·즉시 갱신용)
router.post('/:businessId/cue-knowledge/mine/run', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const { mineWorkPatterns } = require('../services/cueKnowledge');
    const result = await mineWorkPatterns(Number(req.params.businessId));
    return successResponse(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
