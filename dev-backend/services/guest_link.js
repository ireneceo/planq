// services/guest_link.js — 무로그인 게스트 링크의 **단일 착지점** (운영 #259)
//
// 토큰을 해석하는 곳은 **이 파일 하나뿐**이어야 한다. 라우트가 각자 조회하면
//   만료·회수·킬스위치 검사 중 하나를 빠뜨린 곳이 생기고, 그 순간 그 라우트만 열린다.
//
// 설계: docs/GUEST_LINK_DESIGN.md (2026-09-02 Fable 판정으로 개정)
const crypto = require('crypto');
const { Op } = require('sequelize');
const { GuestLink, Client, User, Conversation, ConversationParticipant, Business, PlatformSetting } = require('../models');

// 마지막 사용 후 90일 — **슬라이딩**. 쓰는 고객은 안 끊기고 떠난 고객의 링크는 죽는다.
//   고정 만료였다면 두 달 전 카톡 링크를 누른 고객이 "만료" 화면을 본다 = 영업 손상.
const SLIDING_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

/** 원문 토큰 생성 — 추측 불가능해야 한다. 이 값이 곧 자격이다. */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');   // 43자
}

/**
 * 게스트 토큰 → 컨텍스트. **fail-closed** — 조금이라도 미심쩍으면 null 이다.
 * @returns {Promise<null | { link, client, guestUser, conversation }>}
 */
async function resolveGuestToken(raw, { touch = false, ip = null } = {}) {
  try {
    if (!raw || typeof raw !== 'string' || raw.length < 20 || raw.length > 200) return null;
    const link = await GuestLink.findOne({ where: { token_hash: hashToken(raw) } });
    if (!link) return null;
    if (link.revoked_at) return null;                       // 회수됨
    if (new Date(link.expires_at).getTime() < Date.now()) return null;   // 만료

    // 킬스위치 2단 — 플랫폼 → 워크스페이스. 둘 중 하나만 꺼도 전부 닫힌다.
    const platform = await PlatformSetting.findOne({ attributes: ['guest_links_enabled'] });
    if (platform && platform.guest_links_enabled === false) return null;
    const business = await Business.findByPk(link.business_id, { attributes: ['id', 'guest_links_enabled', 'deleted_at'] });
    if (!business || business.deleted_at || business.guest_links_enabled === false) return null;

    const conversation = await Conversation.findByPk(link.conversation_id);
    // 대화방이 사라졌거나 다른 워크스페이스로 옮겨졌으면 닫는다(테넌트 이중 검증).
    if (!conversation || conversation.business_id !== link.business_id) return null;

    const client = await Client.findByPk(link.client_id);
    if (!client || client.business_id !== link.business_id) return null;

    // 그림자 User — 발급 시점에 만들어져 있어야 한다. 없으면 데이터가 어긋난 것이니 닫는다.
    const guestUser = client.guest_user_id ? await User.findByPk(client.guest_user_id) : null;
    if (!guestUser || !guestUser.is_guest) return null;

    if (touch) {
      // 슬라이딩 갱신 — 쓸 때마다 만료가 뒤로 밀린다.
      await link.update({
        last_used_at: new Date(),
        last_used_ip: ip ? String(ip).slice(0, 45) : link.last_used_ip,
        expires_at: new Date(Date.now() + SLIDING_TTL_MS),
      });
    }
    return { link, client, guestUser, conversation };
  } catch (e) {
    console.error('[guest_link] resolve 실패:', e.message);
    return null;   // ★ 절대 throw 하지 않는다 — 게스트 화면이 500 이 되면 안 된다
  }
}

/**
 * 그림자 User 확보 — **고객당 1개.** 이미 있으면 그대로 쓴다.
 *
 * ★ 링크당이 아니라 고객당인 이유: 회수하고 재발급해도 **같은 사람**이어야 한다.
 *   링크당으로 만들면 같은 고객이 두 사람으로 갈라져 상담 히스토리가 끊긴다(#381 을 막는 결정).
 * ★ 발급 **시점**에 만드는 이유: 이미지 보안 Stage 2 가 켜지면 이미지 접근 판정이
 *   `canAccessConversation(viewer, conv)` 가 된다. 게스트는 열람만 해도 신원이 있어야 한다.
 */
async function ensureShadowUser(client, { transaction } = {}) {
  if (client.guest_user_id) {
    const existing = await User.findByPk(client.guest_user_id, { transaction });
    if (existing) return existing;
  }
  const label = client.display_name || client.company_name || `고객${client.id}`;
  // Cue 시스템 계정과 **같은 규약**을 쓴다 (routes/auth.js:365 — 합성 주소 + 난수 해시 + 플래그).
  //   규약을 새로 만들면 계정 계열이 갈라진다.
  const bcrypt = require('bcryptjs');
  const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
  const user = await User.create({
    // 합성 주소 — 실제로 메일이 가면 안 된다. 알림은 Client.invite_email 로 나간다.
    email: `guest+c${client.id}@guest.planq.kr`,
    password_hash: randomHash,   // 로그인 불가. is_guest 가 인증 경로에서 막는 것이 정본이고 이건 이중 방어
    name: String(label).slice(0, 100),
    is_guest: true,
    platform_role: 'user',
    status: 'active',
  }, { transaction });
  await client.update({ guest_user_id: user.id }, { transaction });
  return user;
}

/**
 * 게스트 링크 발급. **서비스 함수로 둔다** — 나중에 "공개 상담 문"(#259 3단계)이
 *   사람 손 없이 이걸 부른다. UI 전용 로직으로 만들면 그때 다시 짜야 한다.
 * @returns {Promise<{ link, token, guestUser }>} token 은 **이때만** 원문으로 나간다.
 */
async function issueGuestLink({ businessId, conversationId, projectId = null, client, createdBy, canWrite = true, guestName = null }) {
  const guestUser = await ensureShadowUser(client);
  // 대화방 참여자로 등록 — 없으면 메시지 목록·unread 집계가 이 사람을 모른다.
  const [participant] = await ConversationParticipant.findOrCreate({
    where: { conversation_id: conversationId, user_id: guestUser.id },
    defaults: { conversation_id: conversationId, user_id: guestUser.id, role: 'client' },
  });
  void participant;

  const token = generateToken();
  const link = await GuestLink.create({
    business_id: businessId,
    conversation_id: conversationId,
    project_id: projectId,
    client_id: client.id,
    token_hash: hashToken(token),
    token_hint: token.slice(0, 6),
    guest_name: String(guestName || client.display_name || client.company_name || '고객').slice(0, 100),
    can_write: !!canWrite,
    expires_at: new Date(Date.now() + SLIDING_TTL_MS),
    created_by: createdBy,
  });
  return { link, token, guestUser };
}

/**
 * 이 대화방·고객에 **유효한** 링크를 찾거나 새로 발급한다.
 * 알림 메일이 부른다 — 만료된 링크를 실어 보내면 고객이 죽은 링크를 받는다.
 * ★ 원문 토큰은 새로 발급할 때만 나온다(해시만 저장하므로 기존 토큰은 복원 불가).
 *   그래서 **만료가 임박하면 미리 재발급**한다 — 메일에 실을 원문이 필요하기 때문이다.
 */
async function getOrIssueForNotify({ businessId, conversationId, projectId, client, createdBy }) {
  const alive = await GuestLink.findOne({
    where: {
      business_id: businessId, conversation_id: conversationId, client_id: client.id,
      revoked_at: null, expires_at: { [Op.gt]: new Date() },
    },
    order: [['id', 'DESC']],
  });
  // 기존 링크가 살아 있어도 **원문을 복원할 수 없다.** 메일에 링크를 실으려면 새로 발급해야 한다.
  //   옛 링크는 그대로 살려 둔다 — 고객이 이미 카톡에 갖고 있는 링크를 죽이면 안 된다.
  void alive;
  return issueGuestLink({ businessId, conversationId, projectId, client, createdBy });
}

module.exports = {
  SLIDING_TTL_MS, hashToken, generateToken,
  resolveGuestToken, ensureShadowUser, issueGuestLink, getOrIssueForNotify,
};
