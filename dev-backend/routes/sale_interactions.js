// routes/sale_interactions.js — Q sale 상담 원장(전화·미팅·방문·메모). docs/Q_SALE_DESIGN.md §3.3
//   /api/sale 아래 같은 접두어로 마운트된다. 권한 체인·직렬화는 services/saleCommon 한 벌을 쓴다.
const express = require('express');
const router = express.Router();
const { ClientInteraction } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const {
  readChain, writeChain, broadcast, findClient, touchClient,
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

// ─── 상담 메모 = **댓글** (project_notes, 공개범위 그대로) ──────────────────────
//
// Irene 2026-09-14: *"메모 기능이 이상해. 이 메모를 고객응대 내역이랑 섞은 거야? 그냥 담당자 메모야.
//   … 리스트에 댓글이 달리는 것처럼 붙여달라는 거고 그걸 열였다 접었다 할 수 잇게 해줘.
//   … 그 댓글들이 저장되게 해서 우측 패널에 댓글로 저장되지만 어떤 문의를 기준으로 저장된건지 남기게 하고.
//   … 채팅방 보면 메모를 공개범위 선택해서 할 수 잇잖아. 그거 그대로 하자."*
//
// ★ 새 표를 만들지 않는다. `project_notes` 가 이미 **공개범위(personal/internal/shared)** ·
//   작성자 · 대상(프로젝트·대화·메일 스레드)을 들고 있고, 화면도 공용 `NoteThread` 가 있다.
//   여기서 더한 것은 **고객 기준**(client_id) 하나다. 그 세 칸이 곧 "어떤 문의를 기준으로" 다.
// ★ 응대 내역(ClientInteraction)과 **다른 것**이다 — 응대 내역은 고객과 무엇을 했는지의 원장이고,
//   이 메모는 담당자끼리의 댓글이다. 섞어서 [메모] 가 원장 전체를 펼치던 것이 이번 신고다.
const NOTE_KINDS = { email_thread: 'email_thread_id', conversation: 'conversation_id', client: 'client_id' };

/** 상담 기준을 `project_notes` 의 어느 칸에 넣을지 + 그 대상이 이 워크스페이스 것인지. */
async function resolveConsultTarget(businessId, kind, id) {
  const col = NOTE_KINDS[kind];
  if (!col || !id) return null;
  const { EmailThread, Conversation, Client } = require('../models');
  if (kind === 'email_thread') {
    const t = await EmailThread.findOne({ where: { id, business_id: businessId }, attributes: ['id', 'project_id'] });
    return t ? { col, id: t.id, projectId: t.project_id || null } : null;
  }
  if (kind === 'conversation') {
    const c = await Conversation.findOne({ where: { id, business_id: businessId }, attributes: ['id', 'project_id'] });
    return c ? { col, id: c.id, projectId: c.project_id || null } : null;
  }
  const c = await Client.findOne({ where: { id, business_id: businessId }, attributes: ['id'] });
  return c ? { col, id: c.id, projectId: null } : null;
}

router.get('/:businessId/consults/:kind/:id/notes', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const tgt = await resolveConsultTarget(businessId, String(req.params.kind), Number(req.params.id));
    if (!tgt) return errorResponse(res, 'consult_not_found', 404);
    const { ProjectNote } = require('../models');
    const { Op } = require('sequelize');
    // personal 은 본인 것만. internal/shared 는 멤버 모두 — 메일 노트와 **같은 술어**.
    const rows = await ProjectNote.findAll({
      where: {
        [tgt.col]: tgt.id,
        [Op.or]: [{ visibility: { [Op.ne]: 'personal' } }, { author_user_id: req.user.id }],
      },
      order: [['id', 'ASC']],
      limit: 200,
    });
    const names = await noteAuthorNames(businessId, rows.map((r) => r.author_user_id));
    return successResponse(res, rows.map((r) => ({ ...r.toJSON(), author_name: names[r.author_user_id] || null })));
  } catch (err) { next(err); }
});

router.post('/:businessId/consults/:kind/:id/notes', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const tgt = await resolveConsultTarget(businessId, String(req.params.kind), Number(req.params.id));
    if (!tgt) return errorResponse(res, 'consult_not_found', 404);
    const body = String(req.body?.body || '').trim();
    if (!body) return errorResponse(res, 'body_required', 400);
    const visibility = ['personal', 'internal', 'shared'].includes(req.body?.visibility)
      ? req.body.visibility : 'internal';
    const { ProjectNote } = require('../models');
    const note = await ProjectNote.create({
      project_id: tgt.projectId,
      conversation_id: null, email_thread_id: null, client_id: null,
      [tgt.col]: tgt.id,
      author_user_id: req.user.id, visibility, body: body.slice(0, 5000),
    });
    createAuditLog({
      userId: req.user.id, businessId, action: 'sale.note_create',
      targetType: 'project_note', targetId: note.id,
      newValue: { kind: req.params.kind, ref_id: tgt.id, visibility },
    });
    // 목록이 열려 있는 다른 창도 같이 갱신된다(CLAUDE.md 운영 16 (b))
    if (visibility !== 'personal') broadcast(req, businessId, 'inbox:refresh', { business_id: businessId });
    const names = await noteAuthorNames(businessId, [req.user.id]);
    return successResponse(res, { ...note.toJSON(), author_name: names[req.user.id] || null }, 'created', 201);
  } catch (err) { next(err); }
});

router.delete('/:businessId/consults/:kind/:id/notes/:noteId', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const tgt = await resolveConsultTarget(businessId, String(req.params.kind), Number(req.params.id));
    if (!tgt) return errorResponse(res, 'consult_not_found', 404);
    const { ProjectNote } = require('../models');
    const note = await ProjectNote.findOne({ where: { id: Number(req.params.noteId), [tgt.col]: tgt.id } });
    if (!note) return errorResponse(res, 'note_not_found', 404);
    // 남의 메모는 지우지 않는다 — 원장이 아니라 사람의 말이다.
    if (note.author_user_id !== req.user.id) return errorResponse(res, 'only_author', 403);
    await note.destroy();
    createAuditLog({
      userId: req.user.id, businessId, action: 'sale.note_delete',
      targetType: 'project_note', targetId: Number(req.params.noteId),
      oldValue: { kind: req.params.kind, ref_id: tgt.id },
    });
    broadcast(req, businessId, 'inbox:refresh', { business_id: businessId });
    return successResponse(res, { id: Number(req.params.noteId) }, 'deleted');
  } catch (err) { next(err); }
});

/** 작성자 표시명 — 워크스페이스 표시명 우선(메일 노트와 같은 규칙). */
async function noteAuthorNames(businessId, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const { User, BusinessMember } = require('../models');
  const { Op } = require('sequelize');
  const [users, members] = await Promise.all([
    User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'] }),
    BusinessMember.findAll({ where: { business_id: businessId, user_id: { [Op.in]: ids } }, attributes: ['user_id', 'name'] }),
  ]);
  const out = {};
  for (const u of users) out[u.id] = u.name || null;
  for (const m of members) if (m.name) out[m.user_id] = m.name;
  return out;
}
