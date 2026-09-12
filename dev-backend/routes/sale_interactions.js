// routes/sale_interactions.js — Q sale 상담 원장(전화·미팅·방문·메모). docs/Q_SALE_DESIGN.md §3.3
//   /api/sale 아래 같은 접두어로 마운트된다. 권한 체인·직렬화는 services/saleCommon 한 벌을 쓴다.
const express = require('express');
const router = express.Router();
const { ClientInteraction } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const {
  writeChain, broadcast, findClient, touchClient,
} = require('../services/saleCommon');
// 검증·생성은 **한 문**이다 — 문의 추가 모달의 첫 기록도 같은 함수를 쓴다
const { interactionPatchFrom, createInteraction } = require('../services/saleInteraction');

router.post('/:businessId/clients/:clientId/interactions', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const client = await findClient(businessId, req.params.clientId);
    if (!client) return errorResponse(res, 'Client not found', 404);
    const out = await createInteraction({ businessId, client, body: req.body || {}, userId: req.user.id, req });
    if (out.error) return errorResponse(res, out.error, 400);
    return successResponse(res, out.row, 'created', 201);
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
