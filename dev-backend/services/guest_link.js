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

/**
 * 고객·게스트에게 **보여도 되는 메시지인가** — 정본은 `utils/messageVisibility.js` 다.
 *
 * ★ 여기 있던 것은 정본의 **사본**이었고 이미 갈라져 있었다: 사본은 `ai_draft_approved !== true`
 *   로 비교하는데 MySQL TINYINT 은 경로에 따라 `1` 로 온다 — 그러면 **승인된 초안을 숨긴다.**
 *   정본은 그 함정을 겪고 `truthy()` 로 환산한다(messageVisibility.js 주석). 그래서 **부른다.**
 *   "같은 규칙" 이라고 주석에 쓰는 것은 검증되지 않는다 — 실제로 갈라져 있었다.
 * ★ 이름을 남겨 두는 이유: 게스트 경로의 호출부(목록·카드 열기·답글 알림)가 무엇을 묻는지
 *   읽히게 하기 위함이다. 판단은 전부 정본이 한다.
 */
const { isVisibleToClient } = require('../utils/messageVisibility');
const visibleToGuest = isVisibleToClient;

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

    // ★ 개인 링크(#259 A안)는 **부모(shared)가 닫히면 같이 닫힌다.**
    //   멤버는 카톡에 퍼진 링크 하나를 회수하고 "닫았다" 고 믿는다. 자식이 살아 있으면
    //   그 믿음이 거짓이 된다 — 회수 수단이 갈라지는 순간 회수는 없는 기능이다.
    //   부모도 이 함수를 통과할 자격이어야 하므로 같은 검사(회수·만료)를 태운다.
    let parent = null;
    if (link.parent_link_id) {
      parent = await GuestLink.findByPk(link.parent_link_id);
      if (!parent) return null;
      if (parent.revoked_at) return null;
      if (new Date(parent.expires_at).getTime() < Date.now()) return null;
      // 부모가 다른 워크스페이스·다른 대화면 데이터가 어긋난 것이다. 닫는다.
      if (parent.business_id !== link.business_id) return null;
      if (parent.conversation_id !== link.conversation_id) return null;
    }

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

    // ★ 권한은 **부모를 넘지 않는다.** 자식 행에 복사해 두면, 나중에 부모를 열람 전용으로
    //   바꿔도 자식은 계속 쓴다 — 복사한 값은 그 순간부터 거짓말이 된다.
    //   저장된 can_write 는 참고이고 **판정은 여기서** 한다(둘 다 참일 때만 쓴다).
    //   ★ `set()` 은 **메모리에만** 남는다 — 바로 아래 touch 의 `update({세 필드})` 는 그 세 개만
    //     쓰므로 DB 로 새지 않는다(실측). 여기서 `link.save()` 를 부르면 그때부터 자식 행에
    //     false 가 박제되고, 나중에 부모를 다시 쓰기 허용으로 바꿔도 자식은 영영 못 쓴다.
    if (parent && parent.can_write !== true) link.set('can_write', false);

    if (touch) {
      // 슬라이딩 갱신 — 쓸 때마다 만료가 뒤로 밀린다.
      const until = new Date(Date.now() + SLIDING_TTL_MS);
      await link.update({
        last_used_at: new Date(),
        last_used_ip: ip ? String(ip).slice(0, 45) : link.last_used_ip,
        expires_at: until,
      });
      // ★ 자식을 쓰면 **부모도 산다.** 부모는 카톡방에 뿌린 뒤 아무도 안 누를 수 있는데,
      //   부모가 90일 유휴로 죽으면 위 전파 규칙이 **활발히 쓰던 개인 링크까지 죽인다.**
      //   전파는 회수·차단만 부모→자식이고, 생명(사용)은 자식→부모다.
      if (parent) {
        await parent.update({ last_used_at: new Date(), expires_at: until }).catch(() => null);
      }
    }
    return { link, parent, client, guestUser, conversation };
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
/**
 * 관리 화면용 직렬화 — **원문 토큰은 절대 담지 않는다**(저장하지도 않는다. token_hint 로만 식별).
 *   ★ 한 곳에 둔다: 대화방 발급(guest_admin)과 프로젝트 발급(projects)이 각자 만들면
 *     한쪽에만 필드가 붙어 화면이 갈라진다.
 */
function serializeGuestLink(l) {
  return {
    id: l.id,
    scope: l.scope || 'conversation',
    client_id: l.client_id,
    guest_name: l.guest_name,
    token_hint: l.token_hint,
    can_write: !!l.can_write,
    expires_at: l.expires_at,
    last_used_at: l.last_used_at,
    message_count: l.message_count,
    revoked_at: l.revoked_at,
    created_at: l.created_at,
  };
}

async function issueGuestLink({ businessId, conversationId, projectId = null, client = null, createdBy, canWrite = true, guestName = null, scope = 'conversation' }) {
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
    // ★ 기본은 대화방이다 — 부르는 쪽이 명시하지 않으면 넓어지지 않는다(fail-closed).
    scope: scope === 'project' ? 'project' : 'conversation',
    expires_at: new Date(Date.now() + SLIDING_TTL_MS),
    created_by: createdBy,
  });
  return { link, token, guestUser };
}

// ── 답글 알림 개인 링크 (#259 A안, 2026-09-03) ──────────────────────────────
// 설계: docs/GUEST_LINK_DESIGN.md §13
const OTP_TTL_MS = 10 * 60 * 1000;        // 코드 유효 10분
const OTP_MAX_ATTEMPTS = 5;               // 틀리면 5회까지
const OTP_LOCK_MS = 30 * 60 * 1000;       // 그 뒤 30분 잠금
const NOTIFY_COOLDOWN_MS = 15 * 60 * 1000; // 알림 메일 쿨다운

/** 6자리 확인 코드. ★ Math.random() 금지 — 전자서명 OTP 에서 한 번 났다. */
function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** 이메일 정규화 — 저장·비교·유니크 인덱스가 모두 이 형태를 전제한다. */
function normalizeEmail(raw) {
  const v = String(raw || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

/**
 * 개인 링크 확보 — **부모 링크 × 이메일 = 1개.** 있으면 그 행을 재사용한다.
 *
 * ★ 그림자 User 는 **자기 것을 새로 만든다**(부모 것을 재사용하지 않는다).
 *   부모의 그림자는 그 링크로 들어온 **모두**가 함께 쓰는 익명 신원이다. 그것을 물려받으면
 *   확인을 마친 사람도 여전히 익명 무리의 일부라, ①§8 승격(게스트→고객)이 그 사람 하나가
 *   아니라 무리 전체를 올려 버리고 ②`is_mine` 이 남이 쓴 글까지 자기 글로 보여 준다.
 *   ★ 대신 **등록 직전에 익명으로 쓴 자기 글은 남의 글처럼 보이게 된다** — 신원이 그때
 *   갈리기 때문이다. 과거를 소급해 고치지 않는 쪽을 택했다(기록은 쓴 시점의 것이다).
 * ★ 이 함수는 **원문 토큰을 내주지 않는다.** 행을 만들 때 아무도 갖지 않은 난수 해시를
 *   채워 두고(컬럼이 NOT NULL·UNIQUE 다), 실제로 쓸 토큰은 **확인에 성공한 뒤**
 *   `mintPersonalToken` 이 만든다. 확인 전에 발급하면 남의 주소를 적은 사람이
 *   코드도 없이 링크를 손에 쥔다.
 */
async function ensurePersonalLink({ parentLink, email, name = null, locale = null }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const existing = await GuestLink.findOne({
    where: { parent_link_id: parentLink.id, contact_email: normalized },
  });
  if (existing) {
    // 회수됐던 자식을 되살리지 않는다 — 회수는 사람 손으로 한 결정이다.
    if (existing.revoked_at) return { link: existing, token: null, revoked: true };
    return { link: existing, token: null, revoked: false };
  }

  // ★ 신원은 **확인을 마친 뒤** 만든다(`promotePersonalIdentity`). 여기서 만들면
  //   ①확인도 안 한 사람 몫의 User 행이 신청 수만큼 쌓이고, ②그림자 User 생성이 bcrypt 라
  //   **신규 주소만 400ms 가 더 걸려** 응답 시간으로 "이 주소가 여기 등록돼 있나" 를 읽을 수
  //   있다(Fable 실측: 회수 주소 14~44ms vs 신규 ~400ms). 본문을 똑같이 맞춰 놓고
  //   시간으로 새면 열거를 막은 것이 아니다. 그때까지는 부모의 익명 신원을 그대로 쓴다.
  // 아무도 갖지 않는 값 — 이 해시에 대응하는 원문은 이 함수 밖으로 나가지 않는다.
  const placeholder = generateToken();
  const link = await GuestLink.create({
    business_id: parentLink.business_id,
    conversation_id: parentLink.conversation_id,
    project_id: parentLink.project_id,
    client_id: parentLink.client_id,
    guest_user_id: parentLink.guest_user_id,   // 확인 전까지는 부모의 익명 신원
    email_verified_at: null,
    token_hash: hashToken(placeholder),
    token_hint: '------',                      // 확인 전에는 보여줄 힌트가 없다
    can_write: parentLink.can_write,           // 권한은 부모를 넘지 않는다(판정은 resolve 에서)
    expires_at: new Date(Date.now() + SLIDING_TTL_MS),
    created_by: parentLink.created_by,
    kind: 'personal',
    parent_link_id: parentLink.id,
    contact_email: normalized,
    contact_name: name ? String(name).trim().slice(0, 30) : null,
    locale: locale ? String(locale).slice(0, 5) : null,
  });
  return { link, revoked: false };
}

/**
 * 확인을 마친 사람에게 **자기 신원**을 준다 — 그림자 User + 대화 참여자 행.
 *
 * ★ 부모의 그림자는 그 링크로 들어온 **모두**가 함께 쓰는 익명 신원이다. 그것을 계속 쓰면
 *   ①§8 승격(게스트→고객)이 그 사람 하나가 아니라 무리 전체를 올리고 ②`is_mine` 이
 *   남이 쓴 글까지 자기 글로 보여 준다.
 * ★ 대신 **확인 직전에 익명으로 쓴 자기 글은 남의 글처럼 보이게 된다** — 신원이 그때
 *   갈리기 때문이다. 과거를 소급해 고치지 않는 쪽을 택했다(기록은 쓴 시점의 것이다).
 */
async function promotePersonalIdentity(link) {
  const guestUser = await ensureShadowUser();
  await ConversationParticipant.findOrCreate({
    where: { conversation_id: link.conversation_id, user_id: guestUser.id },
    defaults: { conversation_id: link.conversation_id, user_id: guestUser.id, role: 'client' },
  });
  await link.update({ guest_user_id: guestUser.id });
  return guestUser;
}

/**
 * 개인 링크의 토큰 — **저장하지 않고 다시 만든다(파생).**
 *
 * ★ 문제: 알림 메일에는 그 사람의 링크가 들어가야 하는데, 우리는 `token_hash` 만 갖고 있어
 *   원문을 되살릴 수 없다. 길은 셋이었다.
 *     ① 메일마다 새 토큰으로 회전 → 지난 메일의 링크가 전부 죽는다("만료" 화면).
 *     ② 원문을 그대로 저장 → **DB 사본 하나로 모든 대화가 열린다.** 이 시스템이 해시만
 *        두는 이유가 그것이다.
 *     ③ (택함) 비밀키와 **그 행의 값들**로 매번 계산한다.
 * ★ ③ 의 성질: 비밀키만 새면 못 만든다(행의 값을 모른다). DB 만 새도 못 만든다(키가 없다).
 *   **둘 다 있어야** 만들어진다 — 원문을 저장하는 ② 보다 엄격히 낫다.
 * ★ 키가 없으면 **기능이 죽는다**(null). 기본값을 두면 그 기본값이 곧 만인의 열쇠다.
 */
function personalTokenFor(link) {
  const secret = process.env.GUEST_LINK_SECRET;
  if (!secret || String(secret).length < 32) return null;
  // ★ 이 모델은 `underscored: true` 라 **인스턴스 속성은 `createdAt`** 이다. `link.created_at` 은
  //   컬럼 이름이지 속성 이름이 아니라서 **undefined** 다(실측). 처음에 그것으로 재료를 만들었고,
  //   그래서 토큰이 조용히 null 이 되어 알림이 한 통도 안 나갔다 — 그런데 fail-closed 라
  //   에러도 없었다. 값이 없으면 "안전하게 아무것도 안 함" 이 되는 코드는, 값을 잘못 읽어도
  //   똑같이 조용하다. 그래서 여기서 **읽는 이름을 한 번만 정하고** 아래에서 반드시 검사한다.
  const createdAt = link?.createdAt || link?.created_at;
  if (!link || !link.id || !link.contact_email || !createdAt) return null;
  const material = `${link.id}:${new Date(createdAt).getTime()}:${link.contact_email}`;
  return crypto.createHmac('sha256', secret).update(material).digest('base64url');
}

/**
 * 확인을 마친 개인 링크에 **실제로 쓸 토큰**을 붙인다. 파생값이라 회전하지 않는다 —
 * 지난 알림 메일의 링크도 계속 열린다.
 */
async function mintPersonalToken(link) {
  const token = personalTokenFor(link);
  if (!token) return null;
  await link.update({ token_hash: hashToken(token), token_hint: token.slice(0, 6) });
  return token;
}

module.exports = {
  SLIDING_TTL_MS, hashToken, generateToken, visibleToGuest,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS, OTP_LOCK_MS, NOTIFY_COOLDOWN_MS,
  generateOtpCode, normalizeEmail, ensurePersonalLink, mintPersonalToken, personalTokenFor,
  promotePersonalIdentity,
  resolveGuestToken, ensureShadowUser, issueGuestLink,
  serializeGuestLink,
};
