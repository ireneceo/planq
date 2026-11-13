// Q talk — 메시지를 다른 대화방으로 «전달» 하는 한 곳 (docs/QTALK_FORWARD_DESIGN.md, Fable DESIGN-READY 2026-11-13).
//
// 정의 — 내가 읽을 수 있는 일반 메시지의 «내용만» 내 이름으로 다른 방에 새로 쓴다.
//   원본과의 연결(원래 방·원래 보낸 사람·답장·반응·고정·읽음·번역·Cue 칸)은 하나도 따라가지 않는다.
//   새 메시지에 남는 표시는 meta = { forwarded: true } 한 칸뿐. 원본 id 는 감사 로그에만.
//
// 순서 — 다 읽고 다 통과한 뒤에만 쓴다(부분 전달 없음).
//   1 멤버 이상 · 2 모양 · 3 원본 방(404) · 4 대상 방(404 · 안내방 403 · 보관 409)
//   5 메시지(404 message_not_found · 400 not_forwardable) · 6 첨부(400 attachment_restricted · 30개 초과 400)
//   7 한 트랜잭션으로 Message N개 + MessageAttachment 행 · 8 커밋 뒤 방송·알림(실패해도 저장은 그대로) · 감사는 라우트가 남긴다
//
// 멘션은 다시 울리지 않는다 — resolveMentions 를 부르지 않는다. 알림은 묶음당 1건(chatPost.notifyNewMessage).
const { Op } = require('sequelize');

const MAX_MESSAGES = 20;
const MAX_ATTACHMENTS = 30;

class ForwardError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const truthy = (v) => v === true || v === 1 || v === '1';

// 1절 — 전달할 수 있는 메시지: 일반 글 · 지우지 않음 · 내부 메모 아님 · 미승인 Cue 초안 아님.
function isForwardableMessage(m) {
  if (!m || m.kind !== 'text') return false;
  if (truthy(m.is_deleted)) return false;
  if (truthy(m.is_internal)) return false;
  if (truthy(m.is_ai) && m.ai_mode_used === 'draft' && !truthy(m.ai_draft_approved)) return false;
  return true;
}

function parseBody(body, sourceId) {
  const raw = Array.isArray(body?.message_ids) ? body.message_ids : null;
  const targetId = Number(body?.target_conversation_id);
  if (!raw || !Number.isInteger(targetId) || targetId <= 0) throw new ForwardError(400, 'invalid_request');
  const ids = [];
  for (const v of raw) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new ForwardError(400, 'invalid_request');
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length < 1 || ids.length > MAX_MESSAGES) throw new ForwardError(400, 'too_many_messages');
  if (targetId === Number(sourceId)) throw new ForwardError(400, 'same_conversation');
  return { ids, targetId };
}

async function forwardMessages(req) {
  const { Conversation, Message, MessageAttachment, File: FileModel, User } = require('../models');
  const { sequelize } = require('../config/database');
  const { canAccessConversation, isPlatformConversation } = require('../middleware/access_scope');
  const businessId = Number(req.params.businessId);
  const sourceId = Number(req.params.id);
  const scope = req.scope;

  // 1. 멤버 이상 — 고객·게스트 403, 플랫폼 관리자 자격만으로는 안 된다.
  if (!(scope && (scope.isOwner || scope.isAdmin || scope.isMember))) throw new ForwardError(403, 'forbidden');

  // 2. 모양
  const { ids, targetId } = parseBody(req.body, sourceId);

  // 3. 원본 방 — 읽기와 같은 술어. 못 읽으면 있다는 것도 알리지 않는다.
  const source = await Conversation.findOne({ where: { id: sourceId, business_id: businessId } });
  if (!source || !(await canAccessConversation(req.user.id, source, scope))) throw new ForwardError(404, 'conversation_not_found');
  if (isPlatformConversation(source)) throw new ForwardError(403, 'platform_room');

  // 4. 대상 방 — 같은 워크스페이스 · 들어갈 수 있는 방 · 안내방 아님 · 보관 아님(직원 쓰기 규칙).
  const target = await Conversation.findOne({ where: { id: targetId, business_id: businessId } });
  if (!target || !(await canAccessConversation(req.user.id, target, scope))) throw new ForwardError(404, 'conversation_not_found');
  if (isPlatformConversation(target)) throw new ForwardError(403, 'platform_room');
  if (await require('./supportRoom').staffWriteBlocked(target, req.user.id)) throw new ForwardError(403, 'use_admin_support');
  {
    const { decideArchivedWrite } = require('./conversationLifecycle');
    const d = decideArchivedWrite(target, { isClient: false });
    if (d.action !== 'proceed') throw new ForwardError(409, 'conversation_archived');
  }

  // 5. 메시지 — 원본 방 안의 것만. 개수가 다르면 다른 방 id 가 끼었거나 없는 것이다.
  const msgs = await Message.findAll({
    where: { id: { [Op.in]: ids }, conversation_id: source.id },
    include: [{ model: MessageAttachment, as: 'attachments', required: false }],
    order: [['created_at', 'ASC'], ['id', 'ASC']],
  });
  if (msgs.length !== ids.length) throw new ForwardError(404, 'message_not_found');
  if (msgs.some((m) => !isForwardableMessage(m))) throw new ForwardError(400, 'not_forwardable');

  // 6. 첨부 — 파일 연결 첨부는 ① 내가 볼 수 있는 파일 ② 보안등급 general 만. 하나라도 걸리면 전체를 안 보낸다.
  const allAtts = msgs.flatMap((m) => m.attachments || []);
  if (allAtts.length > MAX_ATTACHMENTS) throw new ForwardError(400, 'too_many_attachments');
  const fileIds = [...new Set(allAtts.map((a) => a.file_id).filter(Boolean))];
  if (fileIds.length) {
    const files = await FileModel.findAll({ where: { id: { [Op.in]: fileIds } } });
    const byId = new Map(files.map((f) => [f.id, f]));
    const { canUserSeeFile } = require('../middleware/imageViewer');
    for (const fid of fileIds) {
      const f = byId.get(fid);
      if (!f || Number(f.business_id) !== businessId || f.deleted_at) throw new ForwardError(400, 'attachment_restricted');
      if (!(await canUserSeeFile(req.user.id, req.user.platform_role, f))) throw new ForwardError(400, 'attachment_restricted');
      if ((f.security_level || 'general') !== 'general') throw new ForwardError(400, 'attachment_restricted');
    }
  }

  // 7. 한 트랜잭션 — 원본 순서대로 차례로 만든다(같은 초에 생기므로 읽는 쪽은 id 로 순서를 잇는다).
  const created = [];
  const t = await sequelize.transaction();
  try {
    for (const m of msgs) {
      const nm = await Message.create({
        conversation_id: target.id,
        sender_id: req.user.id,
        content: m.content || '',
        kind: 'text',
        meta: { forwarded: true },
        is_ai: false,
        is_internal: false,
      }, { transaction: t });
      for (const a of (m.attachments || [])) {
        await MessageAttachment.create({
          message_id: nm.id,
          file_name: a.file_name,
          file_path: a.file_path,
          file_size: a.file_size,
          mime_type: a.mime_type,
          storage_provider: a.storage_provider || 'planq',
          external_id: a.external_id || null,
          external_url: a.external_url || null,
          file_id: a.file_id || null,
        }, { transaction: t });
      }
      created.push(nm.id);
    }
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  // 8. 커밋 뒤 — 실패해도 저장은 되돌리지 않는다.
  const io = req.app.get('io');
  try { await target.update({ last_message_at: new Date() }); } catch (e) { console.warn('[forward last_message_at]', e.message); }
  try { await require('./convParticipants').promoteSpeaker(target.id, req.user.id, { io }); } catch (e) { console.warn('[forward promote]', e.message); }

  const payloads = await buildPayloads(created, target, req.user.id, { Message, MessageAttachment, User });
  const { broadcastNewMessage, notifyNewMessage } = require('./chatPost');
  for (const p of payloads) broadcastNewMessage(io, target, p);

  const first = msgs[0];
  const firstText = String(first.content || '').trim();
  const firstAtt = (first.attachments || []).length;
  const body = firstText
    ? firstText.slice(0, 140)
    : (firstAtt ? (firstAtt === 1 ? '[첨부 1개]' : `[첨부 ${firstAtt}개]`) : '');
  await notifyNewMessage({ conv: target, senderId: req.user.id, body });

  // 감사는 라우트가 남긴다(routes/conversation_forward.js — 원본 id 는 감사에만).
  const audit = {
    action: 'message.forward', targetType: 'conversation', targetId: target.id, businessId,
    newValue: { source_conversation_id: source.id, source_message_ids: msgs.map((m) => m.id), new_message_ids: created, attachment_count: allAtts.length },
  };
  return { data: { target_conversation_id: target.id, messages: payloads }, audit };
}

// 일반 메시지와 같은 모양 — 표시명·첨부 직렬화·읽음 분모.
async function buildPayloads(ids, conv, senderId, { Message, MessageAttachment, User }) {
  const { serializeMessageAttachments } = require('./filePreview');
  const { applyMemberDisplayName, applyGuestDisplayName } = require('./displayName');
  const { countOthers } = require('./convParticipants');
  const rows = await Message.findAll({
    where: { id: { [Op.in]: ids } },
    include: [
      { model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest'] },
      { model: MessageAttachment, as: 'attachments', required: false },
    ],
    order: [['id', 'ASC']],
  });
  let out = rows.map((r) => r.toJSON());
  try { out = await applyMemberDisplayName(out, Number(conv.business_id), ['sender']); } catch { /* best-effort */ }
  applyGuestDisplayName(out);
  serializeMessageAttachments(out);
  const others = await countOthers(conv.id, senderId).catch(() => 0);
  for (const m of out) { m.other_count = others; m.read_by_count = 0; }
  return out;
}

module.exports = { forwardMessages, isForwardableMessage, ForwardError, MAX_MESSAGES };
