// PlanQ 안내방 — 워크스페이스마다 하나, Cue(PlanQ 사용법) + PlanQ 팀(플랫폼 관리자)이 함께 안내한다.
// 설계 정본: docs/PLANQ_GUIDE_ROOM_DESIGN.md (Fable DESIGN-FIX 2026-10-30) · 기획 docs/PLANQ_GUIDE_ROOM_PLAN.md.
//
// ★ 대화는 conversations(channel_type 'platform'), 운영 상태는 support_rooms. 이 두 표를 쓰는 곳은 이 파일 하나다.
// ★ 참여자는 워크스페이스 사람 멤버만 — 대표·관리자는 열 때 저절로, 멤버는 «들어가기». 고객·게스트는 없다.
//   플랫폼 관리자는 참여자 행을 만들지 않는다(읽음 분모·참여자 목록 밖) — 관리자 화면은 /api/admin/support/* 만 쓴다.
// ★ Cue 는 Q helper 두뇌(services/qhelperAnswer)로만 답한다 — 워크스페이스 업무·대화·문서를 읽지 않고 «사용 모양» 만 받는다.
//   비용은 플랫폼 몫(워크스페이스 Cue 사용량에서 빼지 않는다 — Irene 결정 2). 상한: 사람당 분 10 · 방당 하루 150.
// ★ 알림: PlanQ 팀(사람) 답은 푸시, Cue 답은 앱 안 배지만(Irene 결정 3). 관리자에게는 «사람 연결 요청» 과 Cue 실패만 알린다.
const { Op, UniqueConstraintError } = require('sequelize');
const { sequelize } = require('../config/database');
const { PLATFORM_CHANNEL, isPlatformConversation } = require('../middleware/access_scope');

const MANAGER_ROLES = ['owner', 'admin'];
const HUMAN_ROLES = ['owner', 'admin', 'member'];
const CUE_MUTE_MS = 4 * 60 * 60 * 1000;   // PlanQ 팀이 말한 뒤 Cue 가 끼어들지 않는 시간(설계 §2)
const CUE_PER_USER_PER_MIN = 10;
const CUE_PER_ROOM_PER_DAY = 150;
const HISTORY_TURNS = 3;

function M() { return require('../models'); }

/** 화면이 i18n 으로 그리는 안내 줄 — content 는 옛 화면·알림 미리보기용 한국어. */
//   저장되는 글이라 받는 사람 언어(users.language)로 한 번 고른다 — 화면은 meta.support_notice 로 i18n 을 다시 그릴 수 있다.
const NOTICE_TEXT = {
  ko: {
    welcome: 'PlanQ 안내방이에요. PlanQ 쓰다가 궁금한 것을 여기에 물어보세요. Cue 가 바로 답하고, PlanQ 팀도 함께 봅니다.',
    human_requested: 'PlanQ 팀에 알렸어요. 확인하는 대로 여기서 답드릴게요.',
    cue_failed: '지금은 Cue 가 답을 찾지 못했어요. PlanQ 팀에 넘겼어요.',
  },
  en: {
    welcome: 'This is your PlanQ help room. Ask anything about using PlanQ here — Cue answers right away and the PlanQ team reads along.',
    human_requested: "We've let the PlanQ team know. They'll reply here as soon as they can.",
    cue_failed: "Cue couldn't find an answer this time. We've passed it to the PlanQ team.",
  },
};
async function langOf(userId) {
  if (!userId) return 'ko';
  const u = await M().User.findByPk(userId, { attributes: ['language'] }).catch(() => null);
  return u && String(u.language || '').startsWith('en') ? 'en' : 'ko';
}

// ─── 방 ─────────────────────────────────────────────

/** 워크스페이스의 안내방을 돌려준다(없으면 만든다). 지운 워크스페이스면 null. */
async function ensureRoom(businessId) {
  const { SupportRoom, Conversation, Business } = M();
  const bizId = Number(businessId);
  if (!bizId) return null;
  const found = await SupportRoom.findOne({ where: { business_id: bizId } });
  if (found) {
    const conv = await Conversation.findByPk(found.conversation_id);
    if (conv) return { room: found, conv, created: false };
  }
  const biz = await Business.findOne({ where: { id: bizId, deleted_at: null }, attributes: ['id', 'cue_user_id'] });
  if (!biz) return null;

  let room; let conv;
  try {
    await sequelize.transaction(async (transaction) => {
      conv = await Conversation.create({
        business_id: bizId, channel_type: PLATFORM_CHANNEL, title: 'PlanQ',
        // 워크스페이스 Cue 자동답변(고객 채널 전용)·대화 업무 추출이 이 방을 건드리지 않게 꺼 둔다. Cue 는 아래 afterMessage 가 부른다.
        cue_enabled: false, auto_extract_enabled: false, last_message_at: new Date(),
      }, { transaction });
      room = found
        ? await found.update({ conversation_id: conv.id }, { transaction })
        : await SupportRoom.create({ business_id: bizId, conversation_id: conv.id }, { transaction });
    });
  } catch (e) {
    if (!(e instanceof UniqueConstraintError)) throw e;
    // 동시에 두 창이 처음 열었다 — 먼저 만든 쪽을 쓴다(트랜잭션이 이쪽 대화방을 되돌렸다).
    const again = await SupportRoom.findOne({ where: { business_id: bizId } });
    if (!again) throw e;
    return { room: again, conv: await Conversation.findByPk(again.conversation_id), created: false };
  }
  await joinManagers(conv.id, bizId);
  if (biz.cue_user_id) {
    const ownerRow = await M().Business.findByPk(bizId, { attributes: ['owner_id'] });
    await postNotice(conv, biz.cue_user_id, 'welcome', null, await langOf(ownerRow && ownerRow.owner_id));
  }
  return { room, conv, created: true };
}

/** 대표·관리자를 참여자로(멱등) — 승격된 관리자도 다음에 열 때 들어온다. */
async function joinManagers(convId, bizId) {
  const { BusinessMember, User } = M();
  const rows = await BusinessMember.findAll({
    where: { business_id: bizId, removed_at: null, role: MANAGER_ROLES },
    attributes: ['user_id'],
    include: [{ model: User, as: 'user', attributes: ['id'], where: { is_ai: false }, required: true }],
  });
  const { joinParticipant } = require('./convParticipants');
  const added = [];
  for (const r of rows) {
    const j = await joinParticipant(convId, r.user_id, 'member');
    if (j.created || j.promoted) added.push(r.user_id);
  }
  return added;
}

/** 새로 들어온 사람의 Q talk 목록이 다시 읽게(QTalkPage 가 이 신호로 목록을 다시 받는다). */
function signalJoined(io, convId, userIds) {
  if (!io) return;
  for (const id of userIds) io.to(`user:${id}`).emit('conversation:participants', { conversation_id: convId });
}

/** 이 사람이 안내방에 들어올 수 있는가 — 워크스페이스 사람 멤버. */
async function memberRole(bizId, userId) {
  const { BusinessMember, User } = M();
  const bm = await BusinessMember.findOne({
    where: { business_id: bizId, user_id: userId, removed_at: null, role: HUMAN_ROLES },
    attributes: ['role'],
    include: [{ model: User, as: 'user', attributes: ['id'], where: { is_ai: false }, required: true }],
  });
  return bm ? bm.role : null;
}

/** 워크스페이스 쪽 «내 안내방» — 화면이 Q talk 맨 위 칸을 그린다. 멤버가 아니면 null. */
async function roomForMember(bizId, userId, io) {
  const role = await memberRole(bizId, userId);
  if (!role) return null;
  const r = await ensureRoom(bizId);
  if (!r) return null;
  if (MANAGER_ROLES.includes(role)) signalJoined(io, r.conv.id, await joinManagers(r.conv.id, bizId));
  else if (r.created) signalJoined(io, r.conv.id, await joinManagers(r.conv.id, bizId));
  const { ConversationParticipant } = M();
  const joined = !!(await ConversationParticipant.findOne({ where: { conversation_id: r.conv.id, user_id: userId }, attributes: ['id'] }));
  return { conversation_id: r.conv.id, joined, can_join: !joined, human_requested: !!r.room.human_requested_at };
}

async function join(bizId, userId, io) {
  const role = await memberRole(bizId, userId);
  if (!role) return null;
  const r = await ensureRoom(bizId);
  if (!r) return null;
  const j = await require('./convParticipants').joinParticipant(r.conv.id, userId, 'member');
  if (j.created || j.promoted) signalJoined(io, r.conv.id, [userId]);
  return { conversation_id: r.conv.id, joined: true };
}

// ─── 메시지 ───────────────────────────────────────────

async function loadForEmit(msgId, bizId) {
  const { Message, User } = M();
  const full = await Message.findByPk(msgId, {
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest', 'is_ai'] }],
  });
  const json = full.toJSON();
  // PlanQ 팀 글은 displayName 이 meta.platform_staff 를 보고 «PlanQ 팀 · 계정 이름» 으로 덮는다(워크스페이스 표시명 규칙의 예외).
  try { await require('./displayName').applyMemberDisplayNameOne(json, bizId, ['sender']); } catch { /* best-effort */ }
  return json;
}

async function broadcast(io, conv, payload) {
  if (!io) return;
  io.to(`conv:${conv.id}`).emit('message:new', payload);
  // 안내방은 사적 방과 같은 줄 — 참여자 user 방에만(목록 배지·토스터).
  await require('./convBroadcast').emitConvWide(io, conv, 'message:new', payload).catch(() => {});
}

/** 플랫폼 관리자 화면(받은편지함) 다시 읽기 신호 — 내용 없이 번호만. */
let adminCache = { at: 0, ids: [] };
async function signalAdmins(io, conv) {
  if (!io) return;
  try {
    if (Date.now() - adminCache.at > 60_000) {
      const rows = await M().User.findAll({ where: { platform_role: 'platform_admin', status: 'active' }, attributes: ['id'], raw: true });
      adminCache = { at: Date.now(), ids: rows.map((r) => r.id) };
    }
    for (const id of adminCache.ids) io.to(`user:${id}`).emit('support:updated', { business_id: conv.business_id, conversation_id: conv.id });
  } catch (e) { console.warn('[supportRoom signal]', e.message); }
}

async function postNotice(conv, cueUserId, notice, io, lang = 'ko', extraMeta = {}) {
  const { Message } = M();
  const msg = await Message.create({
    conversation_id: conv.id, sender_id: cueUserId, content: (NOTICE_TEXT[lang] || NOTICE_TEXT.ko)[notice] || notice,
    kind: 'text', is_ai: true, is_internal: false,
    meta: { support_room: true, support_notice: notice, ai_mode_used: 'qhelper', ...extraMeta },
  });
  await conv.update({ last_message_at: new Date() });
  if (io) await broadcast(io, conv, await loadForEmit(msg.id, conv.business_id));
  return msg;
}

/** 지금 이 사람의 «사용 모양» 한 덩어리 — 단계·안 끝난 줄·안 한 설정(키만, 제목·본문 없음). */
async function usageContextFor(bizId, userId) {
  try {
    const role = await memberRole(bizId, userId);
    if (!role) return '';
    const [stages, setup] = await Promise.all([
      require('./adoptionStages').getAdoptionStages({ businessId: bizId, userId, role }),
      require('./onboarding').personalSetup(userId, bizId),
    ]);
    const open = stages.steps.filter((s) => s.core && s.done === false).map((s) => `${s.stage}단계 ${s.key}`);
    const todo = setup.filter((s) => !s.done).map((s) => s.key);
    return [
      `역할: ${role}`,
      `지금 적응 단계: ${stages.current == null ? '모든 단계 완료' : `${stages.current} / ${stages.stage_count}`}`,
      open.length ? `아직 안 한 핵심 줄: ${open.join(', ')}` : '',
      todo.length ? `아직 안 한 개인 설정: ${todo.join(', ')}` : '',
    ].filter(Boolean).join('\n');
  } catch (e) { console.warn('[supportRoom usage ctx]', e.message); return ''; }
}

/** 앞선 대화(사람 질문 → Cue 답) 최근 몇 턴. */
async function recentHistory(convId, beforeId) {
  const { Message } = M();
  const rows = await Message.findAll({
    where: { conversation_id: convId, id: { [Op.lt]: beforeId }, is_deleted: false, kind: 'text' },
    attributes: ['id', 'content', 'is_ai', 'meta'], order: [['id', 'DESC']], limit: HISTORY_TURNS * 4,
  });
  const asc = rows.reverse();
  const out = [];
  for (let i = 0; i < asc.length - 1; i += 1) {
    const a = asc[i]; const b = asc[i + 1];
    if (!a.is_ai && !(a.meta && a.meta.platform_staff) && b.is_ai && !(b.meta && b.meta.support_notice)) {
      out.push({ q: String(a.content || '').slice(0, 1000), a: String(b.content || '').slice(0, 2000) });
    }
  }
  return out.slice(-HISTORY_TURNS);
}

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/**
 * 메시지 라우트 두 곳(routes/projects.js · routes/conversations.js)이 저장·방송 뒤에 부른다 — 안내방이 아니면 아무 일 없다.
 * 워크스페이스 사람이 쓴 글에 Cue 가 답한다(멈춤·상한·PlanQ 팀 대화 중이면 건너뜀).
 */
async function afterMessage({ conv, message, io }) {
  if (!isPlatformConversation(conv)) return { skipped: 'not_platform' };
  if (!message || message.is_ai) return { skipped: 'ai' };
  if (message.is_internal) return { skipped: 'internal' };   // 워크스페이스 내부 메모 — Cue 도 PlanQ 팀도 끼지 않는다
  await signalAdmins(io, conv);
  const meta = message.meta || {};
  if (meta.platform_staff) return { skipped: 'staff' };
  if ((message.kind || 'text') !== 'text' || !String(message.content || '').trim()) return { skipped: 'empty' };

  const { SupportRoom, Business, Message, HelpQuestionLog } = M();
  const room = await SupportRoom.findOne({ where: { business_id: conv.business_id } });
  if (!room) return { skipped: 'no_room' };
  if (room.cue_muted_until && new Date(room.cue_muted_until) > new Date()) return { skipped: 'muted' };
  const biz = await Business.findByPk(conv.business_id, { attributes: ['id', 'cue_user_id'] });
  if (!biz || !biz.cue_user_id) return { skipped: 'no_cue' };

  const [perMin, perDay] = await Promise.all([
    Message.count({ where: { conversation_id: conv.id, sender_id: message.sender_id, created_at: { [Op.gte]: new Date(Date.now() - 60_000) } } }),
    Message.count({ where: { conversation_id: conv.id, is_ai: true, created_at: { [Op.gte]: startOfToday() } } }),
  ]);
  if (perMin > CUE_PER_USER_PER_MIN || perDay >= CUE_PER_ROOM_PER_DAY) return { skipped: 'rate' };

  const [history, usageContext] = await Promise.all([
    recentHistory(conv.id, message.id),
    usageContextFor(conv.business_id, message.sender_id),
  ]);
  let r;
  try { r = await require('./qhelperAnswer').answerQhelper({ question: message.content, history, usageContext }); }
  catch (e) { console.warn('[supportRoom cue]', e.message); r = { ok: false }; }

  // 질문 기록 — 위키 보완 흐름(못 답한 질문 묶음)이 같이 본다(설계 §6 단계 6).
  HelpQuestionLog.create({
    user_id: message.sender_id, business_id: conv.business_id, mode: 'support_room',
    question: String(message.content).slice(0, 1000), lang: null,
    answered: !!(r && r.answered), top_article_id: (r && r.topArticleId) || null,
  }).catch((e) => console.warn('[supportRoom log]', e.message));

  if (!r || !r.ok) {
    await markHuman(room, conv, biz, io, 'cue_failed', message.sender_id);
    return { skipped: 'cue_failed' };
  }
  const msg = await Message.create({
    conversation_id: conv.id, sender_id: biz.cue_user_id, content: r.answer,
    kind: 'text', is_ai: true, is_internal: false,
    meta: { support_room: true, ai_mode_used: 'qhelper', reply_to_message_id: message.id },
  });
  await conv.update({ last_message_at: new Date() });
  // Cue 답은 앱 안 배지만 — notify 를 부르지 않는다(Irene 결정 3).
  await broadcast(io, conv, await loadForEmit(msg.id, conv.business_id));
  await signalAdmins(io, conv);
  return { replied: msg.id };
}

/** 메시지 라우트 두 곳이 응답 전에 부른다 — 기다리지 않는다(Cue 답은 뒤에서). */
function afterMessageSoon(conv, message, io) {
  if (!isPlatformConversation(conv)) return;
  setImmediate(() => afterMessage({ conv, message, io }).catch((e) => console.warn('[support room]', e.message)));
}

/** 워크스페이스 메시지 라우트로 안내방에 쓰려는 사람이 그 워크스페이스 멤버가 아니면(= PlanQ 팀) 막는다 —
 *  그 길로 쓰면 참여자 행이 생기고 «PlanQ 팀» 표시가 빠진다. 관리자는 /api/admin/support 로만 쓴다. */
async function staffWriteBlocked(conv, userId) {
  if (!isPlatformConversation(conv)) return false;
  const bm = await M().BusinessMember.findOne({ where: { business_id: conv.business_id, user_id: userId, removed_at: null }, attributes: ['id'] });
  return !bm;
}

/** 사람에게 넘김 — 방에 한 줄 + 관리자 알림(«확인 필요»). 이미 요청 중이면 다시 알리지 않는다. */
async function markHuman(room, conv, biz, io, notice, userId) {
  const already = !!room.human_requested_at;
  if (!already) await room.update({ human_requested_at: new Date() });
  if (biz.cue_user_id) await postNotice(conv, biz.cue_user_id, notice, io, await langOf(userId));
  await signalAdmins(io, conv);
  if (already) return;
  try {
    const b = await M().Business.findByPk(conv.business_id, { attributes: ['name', 'brand_name'] });
    const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
    await notifyPlatformAdmins({
      eventKind: 'inquiry',
      title: `PlanQ 안내방 — ${b?.brand_name || b?.name || `#${conv.business_id}`} 사람 답 필요`,
      body: notice === 'cue_failed' ? 'Cue 가 답을 찾지 못한 질문이 있습니다.' : '고객이 PlanQ 팀 연결을 요청했습니다.',
      link: `${APP_URL}/admin/support?business=${conv.business_id}`,
      ctaLabel: '안내방 열기',
      relatedEntityId: conv.id,
    });
  } catch (e) { console.warn('[supportRoom notify admins]', e.message); }
}

/** 워크스페이스 사람이 [PlanQ 팀에게 묻기] — 참여자만. */
async function requestHuman(bizId, userId, io) {
  const role = await memberRole(bizId, userId);
  if (!role) return null;
  const r = await ensureRoom(bizId);
  if (!r) return null;
  const { ConversationParticipant, Business } = M();
  const joined = await ConversationParticipant.findOne({ where: { conversation_id: r.conv.id, user_id: userId }, attributes: ['id'] });
  if (!joined) return null;
  const biz = await Business.findByPk(bizId, { attributes: ['id', 'cue_user_id'] });
  await markHuman(r.room, r.conv, biz, io, 'human_requested', userId);
  return { conversation_id: r.conv.id, human_requested: true };
}

/** PlanQ 팀(플랫폼 관리자)이 쓴다 — 관리자 라우트만 부른다. 사람 답이라 푸시가 간다. */
async function postStaffMessage({ businessId, adminUser, content, io, ruleKey = null }) {
  const text = String(content || '').trim().slice(0, 5000);
  if (!text) return { error: 'content_required' };
  const r = await ensureRoom(businessId);
  if (!r) return { error: 'business_not_found' };
  const { Message, ConversationParticipant } = M();
  const msg = await Message.create({
    conversation_id: r.conv.id, sender_id: adminUser.id, content: text,
    kind: 'text', is_ai: false, is_internal: false,
    // 서버가 찍는다 — 요청 본문의 meta 는 받지 않는다. followup_rule = 팔로업 규칙 초안으로 쓴 글(라우트가 키를 검사).
    meta: { support_room: true, platform_staff: true, ...(ruleKey ? { followup_rule: ruleKey } : {}) },
  });
  const now = new Date();
  await r.conv.update({ last_message_at: now });
  await r.room.update({ cue_muted_until: new Date(now.getTime() + CUE_MUTE_MS), human_requested_at: null, admin_last_read_at: now });
  const payload = await loadForEmit(msg.id, r.conv.business_id);
  await broadcast(io, r.conv, payload);
  await signalAdmins(io, r.conv);

  await require('./auditService').writeAudit({
    userId: adminUser.id, businessId: r.conv.business_id, action: 'support.admin_send',
    targetType: 'message', targetId: msg.id, newValue: { conversation_id: r.conv.id, ...(ruleKey ? { rule_key: ruleKey } : {}) },
  }).catch((e) => console.warn('[supportRoom audit]', e.message));

  try {
    const parts = await ConversationParticipant.findAll({ where: { conversation_id: r.conv.id }, attributes: ['user_id'], raw: true });
    const userIds = parts.map((p) => p.user_id).filter((id) => id && id !== adminUser.id);
    if (userIds.length) {
      const { notifyMany } = require('../routes/notifications');
      await notifyMany({
        userIds, businessId: r.conv.business_id, eventKind: 'message',
        titleSpec: { feature: 'chat', action: 'chat_message', subject: 'PlanQ' },
        body: text.slice(0, 140), link: `/talk?conv=${r.conv.id}`,
        previewPolicy: 'excerpt', tag: `conv:${r.conv.id}`,
        entityType: 'conversation', entityId: r.conv.id, actorUserId: adminUser.id,
        skipChannels: ['email'],
      });
    }
  } catch (e) { console.warn('[supportRoom notify]', e.message); }
  return { message: payload, conversation_id: r.conv.id };
}

// ─── 관리자 받은편지함 ─────────────────────────────────

/** 안내방 목록 — 사람 연결 요청 → 안 읽은 것 → 최근 순. 내용은 마지막 한 줄 미리보기만(관리자가 그 방을 볼 권한이 있다). */
async function listRoomsForAdmin({ limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const notStaff = "(m.meta IS NULL OR JSON_EXTRACT(m.meta, '$.platform_staff') IS NULL)";
  const rows = await sequelize.query(`
    SELECT sr.business_id, sr.conversation_id, sr.human_requested_at, sr.admin_last_read_at,
           b.name AS business_name, b.brand_name, c.last_message_at,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = sr.conversation_id AND m.is_ai = 0 AND m.is_deleted = 0 AND m.is_internal = 0
              AND ${notStaff} AND (sr.admin_last_read_at IS NULL OR m.created_at > sr.admin_last_read_at)) AS unread,
           (SELECT m.content FROM messages m WHERE m.conversation_id = sr.conversation_id AND m.is_deleted = 0 AND m.is_internal = 0 ORDER BY m.id DESC LIMIT 1) AS last_content
      FROM support_rooms sr
      JOIN businesses b ON b.id = sr.business_id AND b.deleted_at IS NULL
      JOIN conversations c ON c.id = sr.conversation_id
     ORDER BY (sr.human_requested_at IS NULL), unread = 0, c.last_message_at DESC
     LIMIT :lim OFFSET :off`, { replacements: { lim, off }, type: sequelize.QueryTypes.SELECT });
  const [[{ total }]] = await sequelize.query(
    'SELECT COUNT(*) total FROM support_rooms sr JOIN businesses b ON b.id = sr.business_id AND b.deleted_at IS NULL');
  return {
    rows: rows.map((r) => ({
      business_id: r.business_id, conversation_id: r.conversation_id,
      business_name: r.brand_name || r.business_name,
      human_requested: !!r.human_requested_at, unread: Number(r.unread) || 0,
      last_message_at: r.last_message_at, last_preview: r.last_content ? String(r.last_content).slice(0, 120) : '',
    })),
    total: Number(total) || 0, limit: lim, offset: off,
  };
}

/** 관리자가 한 워크스페이스의 안내방을 연다(없으면 만든다) — 최근 메시지 + 읽음 처리 + 감사. */
async function openForAdmin(businessId, adminUser) {
  const r = await ensureRoom(businessId);
  if (!r) return null;
  const { Message, User, Business } = M();
  const rows = await Message.findAll({
    // 워크스페이스의 내부 메모(is_internal)는 PlanQ 팀에게 보이지 않는다.
    where: { conversation_id: r.conv.id, is_internal: false },
    include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'name_localized', 'is_guest', 'is_ai'] }],
    order: [['id', 'DESC']], limit: 200,
  });
  let list = rows.reverse().map((m) => m.toJSON());
  try { await require('./displayName').applyMemberDisplayName(list, r.conv.business_id, ['sender']); } catch { /* best-effort */ }
  list = require('../utils/deletedMessage').maskDeletedMessages(list);
  await r.room.update({ admin_last_read_at: new Date() });
  await require('./auditService').writeAudit({
    userId: adminUser.id, businessId: r.conv.business_id, action: 'support.admin_read',
    targetType: 'conversation', targetId: r.conv.id,
  }).catch((e) => console.warn('[supportRoom audit]', e.message));
  const biz = await Business.findByPk(r.conv.business_id, { attributes: ['id', 'name', 'brand_name'] });
  // 보내면 알림이 가는 사람 수(참여자 — «열어 봄» 행은 모델 기본 범위에서 빠진다) · 입력칸 위 설명줄용
  const participants = await M().ConversationParticipant.count({ where: { conversation_id: r.conv.id } });
  return {
    participants,
    business_id: r.conv.business_id, business_name: biz?.brand_name || biz?.name || null,
    conversation_id: r.conv.id, human_requested: !!r.room.human_requested_at,
    cue_muted_until: r.room.cue_muted_until, messages: list,
  };
}

module.exports = {
  ensureRoom, roomForMember, join, requestHuman, afterMessage, afterMessageSoon, staffWriteBlocked,
  postStaffMessage, listRoomsForAdmin, openForAdmin, NOTICE_TEXT,
};
