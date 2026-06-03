// 고객 온보딩 — 워크스페이스 고객이 초대를 수락하면 첫 응대 준비를 자동 박제 (사이클 N+83).
//   (1) 담당자(assigned_member) 명의의 customer 대화방 자동 생성 (없을 때만 — 멱등)
//   (2) 담당자 명의의 환영 메시지 1건 자동 게시 → 고객이 첫 접속 시 빈 화면 대신 안내를 봄
//   외부 의존 0. 실패해도 초대 수락 자체는 성공해야 하므로 호출부에서 catch (best-effort).
const { Conversation, ConversationParticipant, Message, Business, User } = require('../models');

// 워크스페이스 default_language 기준 환영 메시지 (ko/en). 회사 표시명 + 고객명 보간.
function welcomeText(lang, { workspaceName, clientName }) {
  const ws = workspaceName || 'PlanQ';
  if (lang === 'en') {
    return `Hi ${clientName || 'there'}, welcome to ${ws}! 👋\n\n`
      + `This is your private space to talk with our team. Share files, ask questions, and track requests — all in one place. `
      + `Feel free to send your first message anytime, and we'll get back to you here.`;
  }
  return `${clientName || '고객'}님, ${ws}에 오신 것을 환영합니다! 👋\n\n`
    + `이곳은 저희 팀과 직접 소통하는 전용 공간이에요. 파일 공유·문의·요청을 한 곳에서 주고받을 수 있습니다. `
    + `편하게 첫 메시지를 남겨 주시면 여기서 바로 답변드리겠습니다.`;
}

// 고객용 customer 대화방이 이미 있으면 그걸 반환, 없으면 생성 + 참여자 구성. 멱등.
//   client: 활성화된 Client 인스턴스 (user_id 필수). assignedUserId: 담당 멤버 (없으면 invited_by).
async function ensureWelcomeConversation(client, { io, transaction } = {}) {
  if (!client || !client.user_id) return null;
  const businessId = client.business_id;

  // 멱등 — 이 고객용 customer 대화방(프로젝트 무관)이 이미 있으면 재생성 안 함
  const existing = await Conversation.findOne({
    where: { business_id: businessId, client_id: client.id, channel_type: 'customer', project_id: null },
    transaction,
  });
  if (existing) return existing;

  const biz = await Business.findByPk(businessId, {
    attributes: ['id', 'name', 'brand_name', 'default_language', 'cue_user_id'],
    transaction,
  });
  const lang = biz?.default_language === 'en' ? 'en' : 'ko';
  const workspaceName = biz?.brand_name || biz?.name || 'PlanQ';

  // 담당 멤버 — assigned_member_id 우선, 없으면 초대자(invited_by)
  const assignedUserId = client.assigned_member_id || client.invited_by || null;

  const conversation = await Conversation.create({
    business_id: businessId,
    project_id: null,
    title: client.display_name || workspaceName,
    client_id: client.id,
    channel_type: 'customer',
    cue_enabled: true,
    auto_extract_enabled: true,
  }, { transaction });

  // 참여자: 고객(client) + 담당 멤버(owner) + Cue(member). user 중복 방지 (한 user = 한 participant).
  const seen = new Set();
  await ConversationParticipant.create(
    { conversation_id: conversation.id, user_id: client.user_id, role: 'client' },
    { transaction }
  );
  seen.add(client.user_id);
  if (assignedUserId && !seen.has(assignedUserId)) {
    await ConversationParticipant.create(
      { conversation_id: conversation.id, user_id: assignedUserId, role: 'owner' },
      { transaction }
    );
    seen.add(assignedUserId);
  }
  if (biz?.cue_user_id && !seen.has(biz.cue_user_id)) {
    await ConversationParticipant.create(
      { conversation_id: conversation.id, user_id: biz.cue_user_id, role: 'member' },
      { transaction }
    );
  }

  // 환영 메시지 — 담당 멤버 명의 (없으면 Cue, 그것도 없으면 system)
  const senderId = assignedUserId || biz?.cue_user_id || null;
  const content = welcomeText(lang, { workspaceName, clientName: client.display_name });
  const welcome = await Message.create({
    conversation_id: conversation.id,
    business_id: businessId,
    sender_id: senderId,
    content,
    message_type: senderId ? 'text' : 'system',
    is_read: false,
  }, { transaction });

  // 대화방 last_message 갱신 (목록 미리보기)
  await conversation.update(
    { last_message_at: welcome.created_at || new Date() },
    { transaction }
  );

  // 온라인 참여자에게 신호 (best-effort — transaction 커밋 후 호출 권장)
  if (io) {
    try {
      io.to(`business:${businessId}`).emit('message:new', {
        id: welcome.id,
        conversation_id: conversation.id,
        sender_id: senderId,
        content,
        message_type: welcome.message_type,
        created_at: welcome.created_at,
      });
    } catch { /* ignore */ }
  }

  return conversation;
}

module.exports = { ensureWelcomeConversation, welcomeText };
