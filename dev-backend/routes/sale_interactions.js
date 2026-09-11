// routes/sale_interactions.js — Q sale 상담 원장(전화·미팅·방문·메모). docs/Q_SALE_DESIGN.md §3.3
//   /api/sale 아래 같은 접두어로 마운트된다. 권한 체인·직렬화는 services/saleCommon 한 벌을 쓴다.
const express = require('express');
const router = express.Router();
const { ClientInteraction, Project } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const {
  writeChain, broadcast, trimOrNull, findClient, touchClient, INTERACTION_KINDS,
} = require('../services/saleCommon');

function interactionPatchFrom(body, { creating }) {
  const out = {};
  if (creating || body.kind !== undefined) {
    if (!INTERACTION_KINDS.includes(body.kind)) return { error: 'invalid_kind' };
    out.kind = body.kind;
  }
  if (body.direction !== undefined) {
    if (body.direction !== null && !['inbound', 'outbound'].includes(body.direction)) return { error: 'invalid_direction' };
    out.direction = body.direction || null;
  }
  if (creating || body.occurred_at !== undefined) {
    const d = body.occurred_at ? new Date(body.occurred_at) : new Date();
    if (Number.isNaN(d.getTime())) return { error: 'invalid_occurred_at' };
    // 미래 접점은 기록이 아니라 일정이다 — 시계 오차만 허용
    if (d.getTime() > Date.now() + 5 * 60 * 1000) return { error: 'occurred_in_future' };
    out.occurred_at = d;
  }
  if (body.duration_seconds !== undefined) {
    if (body.duration_seconds === null || body.duration_seconds === '') out.duration_seconds = null;
    else {
      const n = Math.round(Number(body.duration_seconds));
      if (!Number.isFinite(n) || n < 0 || n > 24 * 3600) return { error: 'invalid_duration' };
      out.duration_seconds = n;
    }
  }
  if (body.title !== undefined) out.title = trimOrNull(body.title, 200);
  if (body.body !== undefined) {
    const s = body.body === null ? null : String(body.body);
    if (s && s.length > 20000) return { error: 'body_too_long' };
    out.body = s && s.trim() ? s : null;
  }
  return { patch: out };
}

router.post('/:businessId/clients/:clientId/interactions', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await findClient(businessId, req.params.clientId);
    if (!client) return errorResponse(res, 'Client not found', 404);
    const body = req.body || {};
    const { patch, error } = interactionPatchFrom(body, { creating: true });
    if (error) return errorResponse(res, error, 400);
    if (!patch.title && !patch.body) return errorResponse(res, 'content_required', 400);

    let projectId = null;
    if (body.project_id) {
      const p = await Project.findOne({ where: { id: Number(body.project_id), business_id: businessId }, attributes: ['id'] });
      if (!p) return errorResponse(res, 'invalid_project', 400);
      projectId = p.id;
    }
    const row = await ClientInteraction.create({
      ...patch,
      business_id: businessId, client_id: client.id, project_id: projectId,
      origin: 'manual', source_kind: 'manual', created_by: req.user.id,
    });
    await touchClient(client, row.occurred_at);
    createAuditLog({
      userId: req.user.id, businessId, action: 'client.interaction.create', targetType: 'client_interaction', targetId: row.id,
      newValue: { client_id: client.id, kind: row.kind, occurred_at: row.occurred_at },
    });
    broadcast(req, businessId, 'interaction:new', { id: row.id, client_id: client.id });
    broadcast(req, businessId, 'client:updated', { id: client.id, business_id: businessId });
    return successResponse(res, row, 'created', 201);
  } catch (err) { next(err); }
});

/** 편집·삭제는 **작성자 본인 또는 owner·admin** (§8). 자동 기록도 같은 규칙(업로더가 작성자다). */
async function loadInteractionForEdit(req, res) {
  const businessId = Number(req.params.businessId);
  const row = await ClientInteraction.findOne({
    where: { id: Number(req.params.id), business_id: businessId, client_id: Number(req.params.clientId), deleted_at: null },
  });
  if (!row) { errorResponse(res, 'Interaction not found', 404); return null; }
  const isManager = req.businessRole === 'owner' || req.businessRole === 'admin' || req.user.platform_role === 'platform_admin';
  if (!isManager && Number(row.created_by) !== Number(req.user.id)) { errorResponse(res, 'forbidden', 403); return null; }
  return row;
}

router.patch('/:businessId/clients/:clientId/interactions/:id', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const row = await loadInteractionForEdit(req, res);
    if (!row) return undefined;
    const { patch, error } = interactionPatchFrom(req.body || {}, { creating: false });
    if (error) return errorResponse(res, error, 400);
    const nextTitle = patch.title !== undefined ? patch.title : row.title;
    const nextBody = patch.body !== undefined ? patch.body : row.body;
    if (!nextTitle && !nextBody) return errorResponse(res, 'content_required', 400);
    const before = {};
    for (const k of Object.keys(patch)) before[k] = row[k];
    await row.update(patch);
    if (patch.occurred_at) {
      const client = await findClient(businessId, row.client_id);
      await touchClient(client, row.occurred_at);
    }
    createAuditLog({
      userId: req.user.id, businessId, action: 'client.interaction.update', targetType: 'client_interaction', targetId: row.id,
      oldValue: before, newValue: patch,
    });
    broadcast(req, businessId, 'interaction:updated', { id: row.id, client_id: row.client_id });
    return successResponse(res, row);
  } catch (err) { next(err); }
});

router.delete('/:businessId/clients/:clientId/interactions/:id', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const row = await loadInteractionForEdit(req, res);
    if (!row) return undefined;
    await row.update({ deleted_at: new Date(), deleted_by: req.user.id });
    createAuditLog({
      userId: req.user.id, businessId, action: 'client.interaction.delete', targetType: 'client_interaction', targetId: row.id,
      oldValue: { client_id: row.client_id, kind: row.kind, title: row.title, occurred_at: row.occurred_at },
    });
    broadcast(req, businessId, 'interaction:deleted', { id: row.id, client_id: row.client_id });
    return successResponse(res, { id: row.id });
  } catch (err) { next(err); }
});

// 자동 기록 "확인함" — 사람이 쓴 기록은 애초에 확인할 것이 없다
router.post('/:businessId/clients/:clientId/interactions/:id/review', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const row = await ClientInteraction.findOne({
      where: { id: Number(req.params.id), business_id: businessId, client_id: Number(req.params.clientId), deleted_at: null },
    });
    if (!row) return errorResponse(res, 'Interaction not found', 404);
    if (row.origin !== 'auto') return errorResponse(res, 'not_auto_record', 400);
    if (!row.reviewed_at) await row.update({ reviewed_at: new Date(), reviewed_by: req.user.id });
    broadcast(req, businessId, 'interaction:updated', { id: row.id, client_id: row.client_id });
    return successResponse(res, { id: row.id, reviewed_at: row.reviewed_at });
  } catch (err) { next(err); }
});

module.exports = router;
