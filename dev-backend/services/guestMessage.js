// 게스트(로그인 없는 링크)가 대화방에 글을 남기는 **한 함수** — 텍스트(POST /:token/messages)와
// 사진·PDF 보내기(POST /:token/messages/upload)가 같이 부른다 (docs/GUEST_UPLOAD_DESIGN.md §2).
// 베끼면 이름 정화·예약어·meta.guest·알림 정책이 갈라진다. 옛 routes/guest.js 본문을 그대로 옮겼다.
//
// ★ 무인증 입력이다 — 태그를 걷어내고(프론트 정화기를 믿지 않는다), 게스트는 내부 메모를 만들 수 없다.
// ★ 표시명은 메시지 행에 박제한다(한 링크를 여럿이 나눠 갖는다 — 링크·그림자 User 에 두면 과거 이름이 소급 변경).
// ★ 알림 본문은 우리 울타리 밖(메일·푸시)으로 내보내지 않는다(internal_only, #407). 파일명도 싣지 않는다.
const { Message, User, MessageAttachment, ConversationParticipant } = require('../models');
const { sequelize } = require('../config/database');

const RESERVED = ['planq', 'cue', '관리자', 'admin', '운영자', '담당자'];

/** 본문 정화 — 태그 제거 · 4000자. 빈 문자열이면 '' */
function cleanGuestContent(raw) {
  return String(raw || '').trim().replace(/<[^>]*>/g, '').slice(0, 4000);
}

/** 표시명 정화 — { name } | { error:'name_reserved' } */
function cleanGuestName(rawName) {
  if (rawName == null) return { name: null };
  const n = String(rawName)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  if (!n) return { name: null };
  // 사칭 차단 — 우리 쪽 사람으로 보이는 이름은 거절한다.
  if (RESERVED.some((w) => n.toLowerCase().includes(w))) return { error: 'name_reserved' };
  return { name: n };
}

/**
 * @param {object} p
 * @param {object} p.guest   req.guest ({ link, conversation, guestUser })
 * @param {string} p.content 정화된 본문('' 허용 — 첨부가 있을 때)
 * @param {string|null} p.guestName 정화된 표시명
 * @param {Array<{file_name,file_path,file_size,mime_type}>} [p.files] 이미 디스크에 쓴 첨부(planq 저장)
 * @param {object} p.app     express app (소켓·알림)
 * @returns {Promise<{ msg, attachments }>}
 */
async function createGuestMessage({ guest, content, guestName, files = [], app }) {
  const { link, conversation, guestUser } = guest;
  const { msg, attachments } = await sequelize.transaction(async (t) => {
    const m = await Message.create({
      conversation_id: conversation.id,
      sender_id: guestUser.id,   // 그림자 User — sender_id 는 NOT NULL 이다
      content,
      kind: 'text',
      is_ai: false,
      is_internal: false,        // ★ 게스트는 내부 메모를 만들 수 없다. 하드코딩이다
      // 이름이 없으면 키 자체를 넣지 않는다 — JSON null 이 문자열 'null' 로 새어 나간 적이 있다.
      meta: { guest: guestName ? { link_id: link.id, name: guestName } : { link_id: link.id } },
    }, { transaction: t });
    const atts = [];
    for (const f of files) {
      atts.push(await MessageAttachment.create({
        message_id: m.id,
        file_name: f.file_name,
        file_path: f.file_path,
        file_size: f.file_size,
        mime_type: f.mime_type,
        storage_provider: 'planq',
      }, { transaction: t }));
    }
    return { msg: m, attachments: atts };
  });
  await conversation.update({ last_message_at: new Date() });
  await link.increment('message_count');

  // 실시간 반영 — 멤버 Q Talk 이 즉시 본다. 첨부까지 만든 뒤 한 번만(message:attachment 따로 안 쏜다).
  const full = await Message.findByPk(msg.id, {
    include: [
      { model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest'] },
      { model: MessageAttachment, as: 'attachments', attributes: ['id', 'file_name', 'file_size', 'mime_type', 'file_id', 'file_path', 'storage_provider', 'external_id'], required: false },
    ],
  });
  const io = app && app.get('io');
  if (io && full) {
    const payload = full.toJSON();
    require('./displayName').applyGuestDisplayName(payload);
    require('./filePreview').serializeMessageAttachments(payload);   // 직원 화면은 기존 첨부 모양 그대로
    payload.via_guest_link = true;
    io.to(`conv:${conversation.id}`).emit('message:new', payload);
    require('./convBroadcast').emitConvWide(io, conversation, 'message:new', payload).catch(() => {});
  }

  // 응대 상태 — 게스트 글은 항상 고객 쪽(services/convCare · docs/QTALK_CARE_DESIGN.md). best-effort.
  await require('./convCare').onCustomerMessage(conversation, { io, isClient: true });

  // 멤버에게 알림 — 게스트가 글을 썼는데 아무도 모르면 이 기능은 무용지물이다.
  try {
    const { notifyMany } = require('../routes/notifications');
    const parts = await ConversationParticipant.findAll({
      where: { conversation_id: conversation.id },
      attributes: ['user_id', 'role'],
    });
    const memberIds = parts.filter((p) => p.role !== 'client' && p.user_id !== guestUser.id).map((p) => p.user_id);
    if (memberIds.length) {
      const { attachmentBody } = require('./outsidePreview');
      const kind = files.length && files.every((f) => String(f.mime_type || '').startsWith('image/')) ? 'image' : 'file';
      const body = content
        ? (content.length > 140 ? content.slice(0, 140) + '…' : content)
        : (lang) => attachmentBody(kind, files.length || 1, lang);   // 파일명은 싣지 않는다
      await notifyMany({
        userIds: memberIds,
        businessId: conversation.business_id,
        eventKind: 'message',
        titleSpec: { feature: 'chat', action: 'chat_guest_message', subject: guestName || link.guest_name || '' },
        body,
        previewPolicy: 'internal_only',
        link: `/talk?conv=${conversation.id}`,
        entityType: 'Conversation',
        entityId: conversation.id,
        ioApp: app,
      });
    }
  } catch (e) { console.warn('[guest] notify 실패:', e.message); }

  return { msg, attachments };
}

module.exports = { createGuestMessage, cleanGuestContent, cleanGuestName };
