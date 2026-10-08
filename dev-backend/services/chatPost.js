// 채팅에 카드(문서 공유·서명 요청·공유 링크)를 «쓰는» 한 문 — 2026-10-08 0-H.
//
// 왜 있는가 — 문서 share-to-chat · 서명 카드 · /api/share 카드가 `Message.create` 만 하고 끝났다.
//   `message:new` 방송도 `notify` 도 없어서 상대는 새로고침 전까지 카드를 못 봤고 OS 푸시는 0 이었다
//   (CLAUDE.md 운영 안정성 13·16번 위반). 일반 메시지 라우트(routes/projects.js POST …/messages)는 둘 다 한다.
//   카드를 쓰는 곳마다 그 두 단계를 베끼면 다시 한쪽이 빠진다 → 이 함수 하나를 부른다.
//
// 계약 (일반 메시지와 같다)
//   ① Message.create + conv.last_message_at
//   ② 방송 — conv 방 + business 방에 같은 payload(sender 포함). 받는 화면이 id 로 중복을 걸러
//      먼저 온 것을 쓰므로 두 방의 payload 가 다르면 카드 내용이 빠진 채 그려진다(QTalkPage message:new).
//   ③ 알림 — 보낸 사람 제외 참여자, 내부 채널이면 고객 제외. eventKind 'message', 메일은 즉시 보내지 않는다
//      (Irene ⑤ — 5분 안 읽으면 unreadEscalationCron 이 묶어 1통).
//   방송·알림 실패는 메시지 저장을 되돌리지 않는다(best-effort, 경고 로그).

const { Op } = require('sequelize');

async function postCardMessage({ conv, senderId, content, meta, io }) {
  const { Message, User, Business, ConversationParticipant } = require('../models');
  const msg = await Message.create({
    conversation_id: conv.id,
    sender_id: senderId,
    content,
    kind: 'card',
    meta,
    is_ai: false,
    is_internal: false,
  });
  await conv.update({ last_message_at: new Date() });

  try {
    if (io) {
      const full = await Message.findByPk(msg.id, {
        include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized', 'is_guest'] }],
      });
      const fullJson = full.toJSON();
      try {
        const { applyMemberDisplayNameOne } = require('./displayName');
        await applyMemberDisplayNameOne(fullJson, conv.business_id, ['sender']);
      } catch { /* best-effort */ }
      io.to(`conv:${conv.id}`).emit('message:new', fullJson);
      // business 방 = 이 대화에 없는 멤버까지 듣는다 — 카드 meta 의 열쇠(공유 토큰·서명 링크)는 참여자 방에만.
      //   목록·토스터는 미리보기 본문만 쓴다(Fable 2026-10-08 관찰).
      //   덜어낸 사본엔 meta_partial 을 붙인다 — 화면은 이 사본을 대화 본문 캐시에 넣지 않고 다음에 열 때 서버에서 다시 읽는다.
      const SECRET_META = ['share_token', 'share_url', 'token', 'sign_url', 'url'];
      const meta0 = fullJson.meta && typeof fullJson.meta === 'object' ? fullJson.meta : null;
      const hasSecret = !!meta0 && Object.keys(meta0).some((k) => SECRET_META.includes(k));
      const bizJson = hasSecret
        ? { ...fullJson, meta: Object.fromEntries(Object.entries(meta0).filter(([k]) => !SECRET_META.includes(k))), meta_partial: true }
        : fullJson;
      io.to(`business:${conv.business_id}`).emit('message:new', bizJson);
    }
  } catch (e) { console.warn('[chatPost broadcast]', e.message); }

  try {
    const participants = await ConversationParticipant.findAll({
      where: { conversation_id: conv.id, user_id: { [Op.ne]: senderId } },
      attributes: ['user_id', 'role'],
    });
    let recipientIds = participants.map((p) => p.user_id).filter(Boolean);
    if (conv.channel_type !== 'customer') {
      const clientIds = new Set(participants.filter((p) => p.role === 'client').map((p) => p.user_id));
      recipientIds = recipientIds.filter((id) => !clientIds.has(id));
    }
    if (recipientIds.length) {
      const { notifyMany } = require('../routes/notifications');
      const { getMemberDisplayName } = require('./displayName');
      const biz = await Business.findByPk(conv.business_id, { attributes: ['name', 'brand_name'] }).catch(() => null);
      const sender = await User.findByPk(senderId, { attributes: ['name'] }).catch(() => null);
      const disp = await getMemberDisplayName(conv.business_id, senderId, sender?.name).catch(() => ({}));
      const convTitle = conv.title || conv.display_name || '';
      await notifyMany({
        userIds: recipientIds,
        businessId: conv.business_id,
        eventKind: 'message',
        titleSpec: { feature: 'chat', action: 'chat_message', subject: [disp?.name, convTitle].filter(Boolean).join(' · ') },
        body: String(content || '').slice(0, 140),
        link: `/talk?conv=${conv.id}`,
        workspaceName: biz?.brand_name || biz?.name || null,
        previewPolicy: 'excerpt',
        tag: `conv:${conv.id}`,
        entityType: 'conversation', entityId: conv.id,
        actorUserId: senderId,
        skipChannels: ['email'],
      });
    }
  } catch (e) { console.warn('[chatPost notify]', e.message); }

  return msg;
}

module.exports = { postCardMessage };
