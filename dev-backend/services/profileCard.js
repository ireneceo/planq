// services/profileCard.js — 채팅 «고객 정보·멤버 정보» 카드 (명함 아니어도). 설계 docs/CHAT_PROFILE_CARDS_DESIGN.md (Fable 2026-11-25 DESIGN-CHANGE 반영)
//
//   ★ 팀 방 전용 — 고객·게스트·PlanQ 안내방이 있는 방에는 보내지 않는다(roomAllowsProfileCard 한 함수).
//     고객 방에서 사람을 소개하는 것은 명함(공개 스위치 = 본인 동의 장치)으로 한다.
//   ★ 참조 카드 — 메시지(content·meta)에는 card_type 과 id 만. 이름·연락처를 남기지 않는다
//     (알림 본문·목록 미리보기·검색·Cue 재료·business 방 방송·답장 인용으로 먼저 나가기 때문 — 규칙 «제목을 복사해 두지 않는다»).
//   ★ 볼 때 보는 사람 권한으로 다시 읽는다 — 권한 검사를 존재 검사보다 먼저(권한 없는 사람에게 «삭제됨» 과 «권한 없음» 을 가르지 않는다).
//   ★ 고객·게스트에게는 자리도 없다 — utils/messageVisibility STAFF_ONLY_CARD_TYPES(목록·미리보기·안읽음·검색·Cue·방송·게스트 한 술어).
const { QueryTypes } = require('sequelize');

const CARD_TYPES = { client: 'client_profile', member: 'member_profile' };
const STAFF_ROLES = ['owner', 'admin', 'member'];
const ALLOWED_CHANNELS = ['internal', 'group'];   // 허용 목록 — platform(PlanQ 안내방)·customer 는 외부가 있는 방

/** 이 방에 사람 정보 카드를 보낼 수 있나. @returns {Promise<string|null>} 거절 이유(null = 됨) */
async function roomRejectReason(conv) {
  if (!conv) return 'invalid_conversation_id';
  if (conv.archived_at) return 'conversation_archived';
  // channel_type NULL 은 옛 팀 방(access_scope.isPrivateConversation 과 같은 해석) — 고객 방이면 client_id 가 아래에서 거른다
  if (!ALLOWED_CHANNELS.includes(conv.channel_type || 'internal')) return 'room_has_external';
  if (conv.client_id) return 'room_has_external';   // 고객은 참여자 행 없이도 client_id 로 방을 읽는다
  const { sequelize } = require('../config/database');
  // 열어 보기만 한 행(is_viewer 1)까지 **일부러** 센다(Fable 조건 1) — 모델 defaultScope 를 거치지 않는 원시 조회.
  //   가드 convparticipants 가 viewer 판정을 줄에 적게 한다 → 둘 다 센다고 그대로 적었다.
  const [row] = await sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = :id AND role = 'client' AND (is_viewer = 0 OR is_viewer = 1)) AS clients,
       (SELECT COUNT(*) FROM guest_links WHERE conversation_id = :id AND revoked_at IS NULL AND expires_at > NOW()) AS links`,
    { replacements: { id: conv.id }, type: QueryTypes.SELECT },
  );
  if (Number(row.clients) > 0 || Number(row.links) > 0) return 'room_has_external';
  return null;
}

async function staffRole(businessId, userId) {
  const { BusinessMember } = require('../models');
  const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: userId, removed_at: null }, attributes: ['role'] });
  return m && STAFF_ROLES.includes(m.role) ? m.role : null;
}

/** 고객 카드를 읽을/보낼 수 있나 = Q sale 읽기(saleCommon.readChain 과 같은 판정: 직원 역할 + qsale read) */
async function canReadClientCards(businessId, user) {
  if (!user) return false;
  if (user.platform_role !== 'platform_admin' && !(await staffRole(businessId, user.id))) return false;
  return require('../middleware/menu_permission').menuAllows(businessId, user, 'qsale', 'read');
}

/** 보낼 수 있는 대상인가(존재·상태). 고객 = 같은 워크스페이스 · 보관/멤버 전환 아님 / 멤버 = 활성 직원(수락 전 초대·Cue 제외) */
async function targetRejectReason(businessId, type, id) {
  const { Client, BusinessMember, Business, User } = require('../models');
  const tid = Number(id) || 0;
  if (!tid) return 'not_found';
  if (type === 'client') {
    const c = await Client.findOne({ where: { id: tid, business_id: businessId }, attributes: ['id', 'status', 'member_converted_at'] });
    if (!c) return 'not_found';
    if (c.status === 'archived' || c.member_converted_at) return 'client_archived';
    return null;
  }
  const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: tid, removed_at: null, role: STAFF_ROLES }, attributes: ['id'] });
  if (!m) return 'not_found';
  const biz = await Business.findByPk(businessId, { attributes: ['cue_user_id'] });
  if (biz && biz.cue_user_id === tid) return 'not_found';
  const u = await User.findByPk(tid, { attributes: ['id', 'is_ai'] });
  if (!u || u.is_ai) return 'not_found';
  return null;
}

// ── 보는 사람 기준 요약(화이트리스트) ──────────────────────────────
async function clientView(businessId, id) {
  const { Client, User } = require('../models');
  const c = await Client.findOne({
    where: { id: Number(id) || 0, business_id: businessId },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
  });
  if (!c || c.status === 'archived' || c.member_converted_at) return null;
  let assigned = null;
  if (c.assigned_member_id) {
    const { getMemberDisplayNameByUser } = require('./displayName');
    const d = await getMemberDisplayNameByUser(businessId, c.assigned_member_id).catch(() => null);
    const name = (d && (d.name || d.display_name)) || null;
    if (name) assigned = { user_id: c.assigned_member_id, name };
  }
  return {
    id: c.id,
    name: c.display_name || c.user?.name || null,
    company: c.company_name || null,
    job_title: c.job_title || null,
    department: c.department || null,
    phone: c.phone || null,
    // saleCommon.serializeClients 와 같은 대표 이메일
    email: c.invite_email || c.user?.email || c.billing_contact_email || null,
    assigned_member: assigned,
  };
}

async function memberView(businessId, userId) {
  const { BusinessMember, User, Department, Team } = require('../models');
  const m = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: Number(userId) || 0, removed_at: null, role: STAFF_ROLES },
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'email', 'phone', 'job_title', 'organization', 'avatar_url', 'is_ai'] },
      { model: Department, as: 'department', attributes: ['id', 'name', 'name_en'], required: false },
      { model: Team, as: 'team', attributes: ['id', 'name', 'name_en'], required: false },
    ],
  });
  if (!m || !m.user || m.user.is_ai) return null;
  // /members 가 직원에게 주는 칸과 같은 폭(표시명·직함·소속·이메일·전화) — 그보다 넓지 않게
  return {
    user_id: m.user_id,
    name: m.name || m.user.name || null,
    job_title: m.job_title || m.user.job_title || null,
    department: m.department ? { name: m.department.name, name_en: m.department.name_en || null } : null,
    team: m.team ? { name: m.team.name, name_en: m.team.name_en || null } : null,
    organization: m.organization || m.user.organization || null,
    email: m.user.email || null,
    phone: m.user.phone || null,
    avatar_url: m.user.avatar_url || null,
  };
}

/**
 * 보는 사람 기준 카드 해석. 권한 먼저 → 존재.
 * @returns {Promise<{ state: 'ok'|'no_permission'|'not_available', view: object|null }>}
 */
async function resolveForViewer(businessId, user, type, id) {
  if (type === 'client') {
    if (!(await canReadClientCards(businessId, user))) return { state: 'no_permission', view: null };
    const view = await clientView(businessId, id);
    return view ? { state: 'ok', view } : { state: 'not_available', view: null };
  }
  if (type === 'member') {
    if (user.platform_role !== 'platform_admin' && !(await staffRole(businessId, user.id))) return { state: 'no_permission', view: null };
    const view = await memberView(businessId, id);
    return view ? { state: 'ok', view } : { state: 'not_available', view: null };
  }
  return { state: 'not_available', view: null };
}

module.exports = { CARD_TYPES, roomRejectReason, canReadClientCards, staffRole, targetRejectReason, resolveForViewer };
