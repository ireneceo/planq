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
    // ★ **fail-closed.** 행이 없으면 닫는다.
    //   처음엔 `platform && ...=== false` 였는데, 그러면 `platform_settings` 행이 0개일 때
    //   **열린다**(Fable 실증: 행을 지우니 200). 나는 바로 옆 모델에 "기본값은 닫힘,
    //   켜는 것이 의식적 결정" 이라고 적어 놓고 조건식은 반대로 썼다.
    //   설정을 못 읽었으면 "허용" 이 아니라 "모름" 이고, 모르면 닫는 쪽이다.
    const platform = await PlatformSetting.findOne({ attributes: ['guest_links_enabled'] });
    if (!platform || platform.guest_links_enabled !== true) return null;
    const business = await Business.findByPk(link.business_id, { attributes: ['id', 'guest_links_enabled', 'deleted_at'] });
    if (!business || business.deleted_at || business.guest_links_enabled === false) return null;

    const conversation = await Conversation.findByPk(link.conversation_id);
    // 대화방이 사라졌거나 다른 워크스페이스로 옮겨졌으면 닫는다(테넌트 이중 검증).
    if (!conversation || conversation.business_id !== link.business_id) return null;

    // 고객은 **선택**이다. 붙어 있으면 테넌트 이중 검증까지 하고, 없으면 그냥 지나간다.
    let client = null;
    if (link.client_id) {
      client = await Client.findByPk(link.client_id);
      if (!client || client.business_id !== link.business_id) return null;
    }

    // 그림자 User — 링크가 자기 것을 가진다. 없으면 데이터가 어긋난 것이니 닫는다.
    const guestUser = link.guest_user_id ? await User.findByPk(link.guest_user_id) : null;
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
 * 그림자 User 확보 — **링크당 1개.** (2026-09-02 변경, 옛 주석은 "고객당 1개" 였다)
 *
 * ★ 왜 바뀌었나: 링크가 **고객 정보 없이** 발급되게 됐다(Irene: "왜 고객정보를 넣어야 해?
 *   고객이 그냥 가볍게 들어와서 확인 및 소통"). 부모였던 Client 가 없어졌으므로
 *   고객당으로 둘 수가 없다. 링크당이면 회수·§8 승격이 링크 생명주기와 1:1 로 맞는다.
 * ★ "같은 고객이 두 사람으로 갈라진다" 는 옛 우려는 **표시명을 메시지에 박제**하는 것으로
 *   해소한다 — 신원(누가 썼나)은 링크, 라벨(뭐라고 보이나)은 메시지. 둘을 한 곳에 두면
 *   이름을 바꿀 때 과거가 소급해서 바뀐다.
 * ★ 발급 **시점**에 만드는 이유: 이미지 보안 Stage 2 가 켜지면 이미지 접근 판정이
 *   `canAccessConversation(viewer, conv)` 가 된다. 게스트는 열람만 해도 신원이 있어야 한다.
 */
async function ensureShadowUser({ transaction } = {}) {
  // ★ 그림자 User 는 **링크당 1개**다 (2026-09-02 재설계).
  //   전에는 Client 당 1개였는데, 링크가 고객 정보 없이도 발급되게 바뀌면서 부모가 사라졌다.
  //   링크당이면 회수·승격(§8)이 링크 생명주기와 1:1 로 맞는다 — 방당 1개면
  //   "승격 후 그림자 소멸" 을 할 수 없다(다른 링크가 아직 그 그림자를 쓴다).
  //   이름은 **"게스트" 로 고정**한다. 화면에 뜨는 이름은 메시지마다 박제된
  //   `messages.meta.guest.name` 이 원천이다 — 여기에 이름을 두면 나중에 들어온 사람이
  //   이름을 바꾸는 순간 **이미 보낸 과거 메시지의 이름까지 소급해서 바뀐다.**
  const bcrypt = require('bcryptjs');
  const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
  const user = await User.create({
    // 합성 주소 — 실제로 메일이 가면 안 된다. 링크마다 달라야 하므로 난수를 섞는다.
    email: `guest+l${crypto.randomBytes(6).toString('hex')}@guest.planq.kr`,
    password_hash: randomHash,   // 로그인 불가. is_guest 가 인증 경로에서 막는 것이 정본이고 이건 이중 방어
    name: '게스트',
    is_guest: true,
    platform_role: 'user',
    status: 'active',
  }, { transaction });
  return user;
}

/**
 * 게스트 링크 발급. **서비스 함수로 둔다** — 나중에 "공개 상담 문"(#259 3단계)이
 *   사람 손 없이 이걸 부른다. UI 전용 로직으로 만들면 그때 다시 짜야 한다.
 * @returns {Promise<{ link, token, guestUser }>} token 은 **이때만** 원문으로 나간다.
 */
async function issueGuestLink({ businessId, conversationId, projectId = null, client = null, createdBy, canWrite = true, guestName = null }) {
  // client 는 **선택**이다. 대화방에 고객이 붙어 있으면 기록해 두고(타임라인 연속성),
  //   없으면 NULL. 멤버에게 묻지 않는다 — 발급은 클릭 한 번이어야 한다.
  const guestUser = await ensureShadowUser();
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
    client_id: client ? client.id : null,
    guest_user_id: guestUser.id,
    token_hash: hashToken(token),
    token_hint: token.slice(0, 6),
    // 멤버가 붙이는 메모용 이름. 화면 표시명이 아니다(그건 messages.meta.guest.name).
    guest_name: guestName ? String(guestName).slice(0, 100) : null,
    can_write: !!canWrite,
    expires_at: new Date(Date.now() + SLIDING_TTL_MS),
    created_by: createdBy,
  });
  return { link, token, guestUser };
}

module.exports = {
  SLIDING_TTL_MS, hashToken, generateToken,
  resolveGuestToken, ensureShadowUser, issueGuestLink,
};
