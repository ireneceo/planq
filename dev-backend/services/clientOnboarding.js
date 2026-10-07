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

/**
 * 계정이 붙은 고객을 **이미 연결돼 있던 프로젝트**에 실제로 들인다 — 멱등.
 *   ①project_clients(client_id = 이 고객) 중 contact_user_id 가 빈 행에 이 계정을 넣는다
 *   ②그 프로젝트들의 고객 채널(channel_type customer)에 role 'client' 로 참여시킨다
 *     (이미 있는데 role 이 client 가 아니면 client 로 바로잡는다 — 워크스페이스 멤버면 건드리지 않는다)
 *
 * 왜(2026-10-06 운영 신고 «최정우 고객 화면에 채팅 리스트가 안 떠»):
 *   고객이 볼 프로젝트는 `contact_user_id = 나` 하나로 판정한다(프로젝트 목록·access_scope·참여자 추가 등 10곳).
 *   그런데 **워크스페이스 고객 초대 수락**은 clients.user_id 만 채우고 project_clients 는 두었다 — 프로젝트 초대
 *   수락(routes/invites.js project_client)만 채웠다. 그래서 연결된 프로젝트·그 채팅방이 고객 화면에서 통째로 사라졌다.
 *   프로젝트 상세는 표시용으로만 contact_user_id 를 메워 «참여 중» 으로 보여 줘서(routes/projects.js) 우리 쪽에선 안 보였다.
 */
async function linkClientToProjects(client, { transaction } = {}) {
  if (!client || !client.id || !client.user_id) return { linked: 0, joined: 0, fixedRole: 0 };
  const { ProjectClient } = require('../models');
  const userId = client.user_id;
  const [linked] = await ProjectClient.update(
    { contact_user_id: userId },
    { where: { client_id: client.id, contact_user_id: null }, transaction },
  );
  const rows = await ProjectClient.findAll({
    where: { client_id: client.id, contact_user_id: userId }, attributes: ['project_id'], transaction,
  });
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const r = await joinProjectCustomerChannels({ businessId: client.business_id, projectIds, userId, clientId: client.id, transaction });
  return { linked, ...r };
}

/**
 * 고객 계정을 그 프로젝트들의 **그 고객의** 채널에 role 'client' 로 들인다 — 멱등.
 *   이미 있는데 role 이 client 가 아니면 client 로 바로잡는다(워크스페이스 멤버면 건드리지 않는다).
 *
 * ★ 2026-10-07 — 고객을 프로젝트에 붙이는 문이 셋인데(초대 수락 · 워크스페이스 초대 수락 · **이미 계정 있는 고객을
 *   프로젝트에 추가**) 마지막 문만 참여를 빠뜨렸다. 들이는 일은 이 함수 하나로 한다.
 * ★ 2026-10-07 (Fable B 판정 7) — 채널의 축은 **프로젝트 × 고객**이다. 프로젝트의 고객 채널 «전부» 에 들이면
 *   고객사가 둘인 프로젝트에서 서로의 방(청구서·첨부)을 본다. `services/project_channel.ensureClientChannel` 이
 *   그 고객의 방을 찾거나(주인 없는 방은 가져오고) 만든다.
 */
async function joinProjectCustomerChannels({ businessId, projectIds, userId, clientId, actorUserId, transaction } = {}) {
  if (!businessId || !userId || !projectIds || !projectIds.length) return { joined: 0, fixedRole: 0 };
  const { BusinessMember, Project, Client } = require('../models');
  const { ensureClientChannel } = require('./project_channel');
  let joined = 0, fixedRole = 0;
  const isMember = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null }, attributes: ['id'], transaction,
  });
  // 어느 고객으로 들이는가 — 부르는 쪽이 모르면 이 워크스페이스에서 그 계정이 붙은 고객 행
  let cid = clientId || null;
  if (!cid) {
    const cl = await Client.findOne({ where: { business_id: businessId, user_id: userId }, attributes: ['id'], order: [['id', 'ASC']], transaction });
    cid = cl ? cl.id : null;
  }
  if (!cid) return { joined: 0, fixedRole: 0 };
  for (const pid of projectIds) {
    const project = await Project.findOne({ where: { id: pid, business_id: businessId }, transaction });
    if (!project) continue;
    // 고객 채팅을 쓰지 않는 프로젝트(고객 채널이 하나도 없다)에는 방을 새로 만들지 않는다 — 대화방은 사람이 연다.
    //   이미 쓰는 프로젝트면 이 고객의 방이 없을 때 새로 만든다(다른 고객의 방에 섞지 않는다).
    const usesCustomerChat = !!(await Conversation.findOne({
      where: { project_id: project.id, channel_type: 'customer' }, attributes: ['id'], transaction,
    }));
    if (!usesCustomerChat) continue;
    const { conversation: cv } = await ensureClientChannel(project, cid, actorUserId || null, { transaction });
    if (!cv) continue;
    const ex = await ConversationParticipant.findOne({ where: { conversation_id: cv.id, user_id: userId }, transaction });
    if (!ex) {
      await ConversationParticipant.create({ conversation_id: cv.id, user_id: userId, role: isMember ? 'member' : 'client' }, { transaction });
      joined += 1;
    } else if (!isMember && ex.role !== 'client') {
      await ex.update({ role: 'client' }, { transaction });
      fixedRole += 1;
    }
  }
  return { joined, fixedRole };
}

module.exports = { ensureWelcomeConversation, welcomeText, linkClientToProjects, joinProjectCustomerChannels };
