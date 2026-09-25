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
 * scope 정규화 — **한 곳**이다.
 *
 * ★ 2026-09-25 전까지 이 삼항(`scope === 'project' ? 'project' : 'conversation'`)이 **세 군데**
 *   (발급·조회·문)에 흩어져 있었다. 값을 하나 더하면서 그 셋 중 하나만 빠뜨리면 그 경로에서
 *   조용히 'conversation' 으로 **강등**된다 — 발급은 201 인데 링크를 누르면 채팅 화면이 뜬다.
 *   오류가 없어서 오래 안 보이는 계열이다(memory feedback_same_value_multiple_formulas).
 * ★ 모르는 값은 **가장 좁은 쪽**으로 떨어뜨린다(fail-closed). 넓은 쪽 기본값은 곧 가시성 확대다.
 */
const GUEST_SCOPES = ['conversation', 'project', 'workspace'];
const normalizeScope = (v) => (GUEST_SCOPES.includes(v) ? v : 'conversation');

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
      // ★ 대화방 일치 — **scope 로 가른다.** 워크스페이스 창구는 부모에게 방이 없고(NULL) 자식이
      //   확인을 마치면 **자기 방**을 갖는다(§4.2 — 방문자마다 자기 대화). 그래서 그 경로만 면제한다.
      //
      //   ★★ 2026-09-25 Fable FAIL(E6) 로 고친 자리다. 처음에 나는 이것을
      //      `parent.conversation_id && parent.conversation_id !== link.conversation_id` 로 썼고,
      //      «기존 링크는 부모가 전부 방을 가지므로 판정이 안 바뀐다» 고 적었다. **반대였다.**
      //      conversation scope 공유 링크의 방이 비면(이번 마이그레이션이 NULL 을 가능하게 만들었다)
      //      부모는 404 인데 **자식은 200 으로 열렸다** — truthiness 가 검사 자체를 건너뛴다.
      //      옛 코드는 `NULL !== 124` 로 자식도 닫았다. scope 로 가르면 옛 scope 는 HEAD 와
      //      **글자까지 같은 판정**이 된다. 「좁은 조건이 더 안전하다」는 직관이 틀린 경우다.
      if (parent.scope !== 'workspace' && parent.conversation_id !== link.conversation_id) return null;
    }

    // 킬스위치 2단 — 플랫폼 → 워크스페이스. 둘 중 하나만 꺼도 전부 닫힌다.
    // ★ **fail-closed.** 행이 없으면 닫는다.
    //   처음엔 `platform && ...=== false` 였는데, 그러면 `platform_settings` 행이 0개일 때
    //   **열린다**(Fable 실증: 행을 지우니 200). 나는 바로 옆 모델에 "기본값은 닫힘,
    //   켜는 것이 의식적 결정" 이라고 적어 놓고 조건식은 반대로 썼다.
    //   설정을 못 읽었으면 "허용" 이 아니라 "모름" 이고, 모르면 닫는 쪽이다.
    const platform = await PlatformSetting.findOne({ attributes: ['guest_links_enabled'] });
    if (!platform || platform.guest_links_enabled !== true) return null;
    // 이름·로고는 **게스트 화면의 발신자 표시**용(docs/CLIENT_ENTRY_DESIGN.md P0-①).
    //   내보내는 것은 routes/guest.js 의 `workspace:{name, logo_url}` 두 필드뿐이다 — 여기서 더 읽어도
    //   화이트리스트가 막는다. 그래도 필요 없는 칸(법인·연락처·slug)은 애초에 읽지 않는다.
    // ★ 워크스페이스 창구(scope='workspace')만 «안내 탭» 자료를 더 읽는다 — 연락처·소개.
    //   그 외 scope 에서는 **애초에 읽지 않는다**: 읽어 두면 다음 사람이 화이트리스트를 한 줄
    //   늘릴 때 그 값이 옛 채팅 링크 응답에도 따라 나간다(내보내는 것은 routes/guest.js 가
    //   가르지만, 안 읽는 것이 한 겹 더 안전하다).
    const bizAttrs = ['id', 'guest_links_enabled', 'deleted_at', 'name', 'brand_name', 'brand_logo_url'];
    if (link.scope === 'workspace') {
      bizAttrs.push('brand_tagline', 'phone', 'email', 'website', 'address', 'permissions');
    }
    const business = await Business.findByPk(link.business_id, { attributes: bizAttrs });
    if (!business || business.deleted_at || business.guest_links_enabled === false) return null;

    // 대화방은 **워크스페이스 창구에서만 없을 수 있다**(scope='workspace').
    //   ★ 그 외 scope 에서 NULL 이면 데이터가 어긋난 것이므로 **닫는다** — fail-closed.
    //     여기서 "없으면 그냥 통과" 로 두면 옛 채팅 링크의 방이 지워졌을 때 그 링크가
    //     방 없이 살아남아 아래 라우트들이 undefined 를 읽는다(500 이 곧 무인증 표면의 정보다).
    let conversation = null;
    if (link.conversation_id) {
      conversation = await Conversation.findByPk(link.conversation_id);
      // 대화방이 사라졌거나 다른 워크스페이스로 옮겨졌으면 닫는다(테넌트 이중 검증).
      if (!conversation || conversation.business_id !== link.business_id) return null;

      // ★★ 워크스페이스 창구: **이 링크가 그 방의 참여자인가**를 요구한다 (2026-09-25 Fable FAIL D1).
      //   다른 scope 는 «부모와 같은 방» 이라는 검사가 결속을 지켜 준다. 창구는 방문자마다 방이
      //   달라 그 검사를 면제했는데, 그 순간 **링크와 방을 잇는 검사가 아무것도 없어졌다** —
      //   Fable 실측: 개인 링크 A 의 conversation_id 를 B 의 방으로 바꾸면 ctx·messages 가 **200**.
      //   사용자가 그 값을 정할 HTTP 경로는 지금 0건이지만(쓰는 곳은 ensureVisitorConversation 뿐),
      //   «오늘 닿을 수 없다» 는 심층방어를 없앨 이유가 못 된다. 면제했으면 대체 검사를 둔다.
      //   ★ 정확히 맞는 검사인 이유: 확인을 마친 개인 링크의 그림자(guest_user_id)는 **그 사람 고유**이고
      //     `ensureVisitorConversation` 이 방을 만들 때 참여자로 넣은 뒤 **마지막에** conversation_id 를
      //     쓴다. 그래서 conversation_id 가 있으면 참여자 행도 반드시 있다(부분 실패 시 링크는 방 없는
      //     상태로 남고 다음 확인이 멱등으로 복구한다).
      if (link.scope === 'workspace') {
        const own = await ConversationParticipant.findOne({
          where: { conversation_id: link.conversation_id, user_id: link.guest_user_id },
          attributes: ['id'],
        });
        if (!own) return null;
      }
    } else if (link.scope !== 'workspace') {
      return null;
    }

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
    //   ★ 2026-09-25 — 상한이 지키는 것은 «그 방» 이다: 부모를 열람 전용으로 바꾸면 그 방에
    //     자식이 못 쓰게 된다. 워크스페이스 창구는 부모에게 방이 **없고** 자식은 자기 방을 갖는다 —
    //     공유하는 방이 없으니 상한도 뜻이 없다. 그대로 두면 창구 공유 링크의 `can_write=false`
    //     (routes/customer_entry.js 가 강제하는 값)가 자식에게 내려와 **이메일을 확인한 방문자가
    //     자기 방에 한 글자도 못 쓴다** — 「문의하기」 탭이 통째로 죽는다.
    //   ★★ 위 대화방 일치 검사와 **같은 방식으로 가른다(scope)** — 전에 `parent.conversation_id &&`
    //      로 썼다가 Fable FAIL(E6) 을 받았다. 같은 전제를 두 곳에서 다르게 표현하면 한쪽만 새고,
    //      실제로 그렇게 됐다. 두 줄이 같은 조건을 쓰는지 눈으로 확인할 수 있게 둔다.
    if (parent && parent.scope !== 'workspace' && parent.can_write !== true) link.set('can_write', false);

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
    return { link, parent, client, guestUser, conversation, business };
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
 * 이 방에 게스트 링크를 낼 수 있는가 — **대화방 발급과 프로젝트 발급이 같은 함수를 부른다.**
 *
 *   ★ 전에는 두 라우트가 같은 검사를 **복사**해 갖고 있었고, 프로젝트 쪽에서는 그 검사가
 *     **죽은 코드**였다(보관된 방을 찾지 않고 새 방을 만들어 버려 판정에 들어오지 못했다).
 *     그래서 닫힌 프로젝트에 링크가 나가고 고객채널이 복제됐다(2026-09-05 Fable 실측).
 *     "같은 술어" 는 주석으로 보장되지 않는다 — 같은 함수를 부르게 한다.
 *
 * @returns {Promise<null|{code: string, status: number}>} null 이면 발급 가능
 */
async function assertGuestLinkIssuable(conv, businessId, { scope = 'conversation' } = {}) {
  const { PlatformSetting, Business } = require('../models');
  // ★ 워크스페이스 창구(scope='workspace')는 **대화방에 붙지 않는다** — 검사할 방이 없다.
  //   그래서 ①② 를 건너뛴다. 그래도 이 함수를 지나게 하는 이유는 ③ 이다: 킬스위치가 꺼져 있는데
  //   발급만 201 이 나면 담당자가 죽은 주소를 고객에게 보낸다(아래 ③ 주석과 같은 사고).
  if (normalizeScope(scope) !== 'workspace') {
    // ① 내부 대화방에 링크를 내주면 **내부 대화가 통째로 밖으로 열린다.**
    if (!conv || conv.channel_type !== 'customer') return { code: 'not_customer_channel', status: 403 };
    // ② 보관된 방 — 끝난 대화를 다시 여는 링크는 만들 수 없다.
    if (conv.status === 'archived' || conv.archived_at) return { code: 'conversation_archived', status: 409 };
  }
  // ③ 킬스위치가 꺼져 있으면 **발급도 막는다.** 여태 발급은 201 이 났고 그 링크는 열리지 않았다 —
  //    담당자가 죽은 주소를 고객에게 보내고 고객은 없는 페이지를 본다.
  const platform = await PlatformSetting.findOne({ attributes: ['guest_links_enabled'] });
  const bizRow = await Business.findByPk(businessId, { attributes: ['guest_links_enabled'] });
  if (!platform || platform.guest_links_enabled !== true || !bizRow || bizRow.guest_links_enabled === false) {
    return { code: 'guest_links_disabled', status: 403 };
  }
  return null;
}

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
    // ★ Sequelize 속성명은 **createdAt** 이다(underscored:true 는 컬럼명만 바꾼다).
    //   `l.created_at` 은 언제나 undefined 라 JSON 에서 통째로 빠진다 — 오류 없이 조용히 사라진다.
    created_at: l.createdAt ?? l.created_at,
  };
}

/**
 * 공유 링크 발급(본체). **토큰은 파생이다**(docs/GUEST_PROJECT_VIEW_DECISIONS.md §B-1) —
 *   난수로 만들면 해시만 남아 **주소를 다시 볼 수 없고**, 그래서 사람들이 링크를 새로 만들었다(§0-⑦).
 * ★ 두 단계다: 자리표시 해시로 행을 만들고 → **DB 에서 다시 읽은** createdAt 으로 파생 토큰을 계산해 붙인다.
 *   `created_at` 은 DATETIME(초 단위)이라, 만든 직후 메모리 값(밀리초 포함)으로 계산하면
 *   나중에 목록에서 다시 계산한 토큰과 **달라져 주소가 안 열린다.**
 * ★ 비밀키가 없으면 **던진다**(`guest_link_secret_missing`). 난수로 조용히 떨어지면 «다시 못 보는
 *   링크» 가 또 생긴다.
 * 트랜잭션은 부르는 쪽(issueOrReuseSharedLink)이 준다.
 */
async function issueGuestLink({ businessId, conversationId, projectId = null, client = null, createdBy, canWrite = true, guestName = null, scope = 'conversation', transaction } = {}) {
  if (!sharedSecret()) { const e = new Error('guest_link_secret_missing'); e.code = 'guest_link_secret_missing'; throw e; }
  // client 는 **선택**이다. 대화방에 고객이 붙어 있으면 기록해 두고(타임라인 연속성),
  //   없으면 NULL. 멤버에게 묻지 않는다 — 발급은 클릭 한 번이어야 한다.
  const guestUser = await ensureShadowUser({ transaction });
  // 대화방 참여자로 등록 — 없으면 메시지 목록·unread 집계가 이 사람을 모른다.
  //   ★ 워크스페이스 창구(scope='workspace')에는 방이 없다 — 방은 방문자가 이메일을 확인한 뒤
  //     개인 링크마다 생기고(ensureVisitorConversation), 참여자도 그때 붙는다.
  if (conversationId) {
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: conversationId, user_id: guestUser.id },
      defaults: { conversation_id: conversationId, user_id: guestUser.id, role: 'client' },
      transaction,
    });
  }

  const placeholder = generateToken();   // 버리는 값 — 파생 토큰을 붙이기 전까지 이 행은 열리지 않는다
  const link = await GuestLink.create({
    business_id: businessId,
    // NULL 은 scope='workspace' 에서만 — 모델 주석 참조(그 외 NULL 은 resolve 가 닫는다).
    conversation_id: conversationId || null,
    project_id: projectId,
    client_id: client ? client.id : null,
    guest_user_id: guestUser.id,
    token_hash: hashToken(placeholder),
    token_hint: '------',
    // 멤버가 붙이는 메모용 이름. 화면 표시명이 아니다(그건 messages.meta.guest.name).
    guest_name: guestName ? String(guestName).slice(0, 100) : null,
    can_write: !!canWrite,
    // ★ 기본은 대화방이다 — 부르는 쪽이 명시하지 않으면 넓어지지 않는다(fail-closed).
    scope: normalizeScope(scope),
    expires_at: new Date(Date.now() + SLIDING_TTL_MS),
    created_by: createdBy,
  }, { transaction });
  await link.reload({ transaction });
  const token = sharedTokenFor(link);
  if (!token) { const e = new Error('guest_link_secret_missing'); e.code = 'guest_link_secret_missing'; throw e; }
  await link.update({ token_hash: hashToken(token), token_hint: token.slice(0, 6) }, { transaction });
  return { link, token, guestUser };
}

/**
 * 이 **자리**의 살아 있는 공유 링크 1건. 세 발급 라우트가 같이 부른다.
 *   자리의 키가 scope 마다 다르다:
 *     project     → 그 프로젝트          conversation → 그 대화방
 *     workspace   → **워크스페이스 자체** (한 워크스페이스에 창구는 하나 — §3-D2)
 */
async function findLiveSharedLink({ businessId, scope, projectId = null, conversationId = null, transaction } = {}) {
  const sc = normalizeScope(scope);
  const where = {
    business_id: businessId, kind: 'shared', revoked_at: null,
    scope: sc,
    expires_at: { [Op.gt]: new Date() },
  };
  if (sc === 'project') where.project_id = projectId;
  else if (sc === 'conversation') where.conversation_id = conversationId;
  // workspace 는 좁히는 조건이 없다 — business_id + scope 가 곧 자리다.
  return GuestLink.findOne({ where, order: [['id', 'DESC']], transaction });
}

/**
 * 발급 **문**(멱등) — 대화방·프로젝트 두 라우트가 이것 하나를 부른다(§B-3·4).
 *   살아 있는 링크가 있으면 그것을 돌려준다(reused). `replace` 면 그것을 회수하고 새로 만든다.
 * ★ 동시에 두 번 눌러도 하나다 — 자리의 주인 행(프로젝트 또는 대화방)을 `FOR UPDATE` 로 잡고 찾는다.
 * ★ `can_write`·`guest_name` 은 **새로 만들 때만** 쓴다(§B-5). 재사용은 기존 값을 그대로 돌려준다.
 * ★ 재사용 때 `expires_at` 을 밀지 않는다(§B-6) — 발급자가 열어 본 것은 사용이 아니다.
 * @returns {{ link, url: string|null, reused: boolean, replacedId: number|null }}
 */
async function issueOrReuseSharedLink({ businessId, scope, conversationId, projectId = null, client = null, createdBy, canWrite = true, guestName = null, replace = false }) {
  if (!sharedSecret()) { const e = new Error('guest_link_secret_missing'); e.code = 'guest_link_secret_missing'; throw e; }
  const { sequelize } = require('../config/database');
  const { Project } = require('../models');
  const sc = normalizeScope(scope);
  const t = await sequelize.transaction();
  let out;
  try {
    // 자리를 잠근다 — 두 요청이 동시에 "없다" 를 보고 둘 다 만들지 않게.
    //   ★ 잠그는 행이 곧 «자리» 다. workspace 는 자리가 워크스페이스 자체이므로 businesses 행을 잡는다 —
    //     여기서 아무것도 잠그지 않으면 [링크 만들기] 를 두 번 누른 순간 창구가 둘이 되고,
    //     둘 중 어느 것이 «그 워크스페이스의 주소» 인지 아무도 모른다.
    if (sc === 'project') await Project.findByPk(projectId, { transaction: t, lock: t.LOCK.UPDATE });
    else if (sc === 'workspace') await Business.findByPk(businessId, { transaction: t, lock: t.LOCK.UPDATE });
    else await Conversation.findByPk(conversationId, { transaction: t, lock: t.LOCK.UPDATE });
    const live = await findLiveSharedLink({ businessId, scope: sc, projectId, conversationId, transaction: t });
    let replacedId = null;
    if (live && !replace) {
      out = { link: live, url: urlForSharedLink(live), reused: true, replacedId: null };
    } else {
      if (live && replace) {
        await revokeGuestLink(live, { userId: createdBy, transaction: t });
        replacedId = live.id;
      }
      const { link, token } = await issueGuestLink({
        businessId, conversationId, projectId, client, createdBy, canWrite, guestName, scope: sc, transaction: t,
      });
      out = { link, url: `${APP_URL}/g/${token}`, reused: false, replacedId };
    }
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }
  if (out.replacedId && conversationId) {
    try { require('./guest_notify').invalidateGuestCache(conversationId); } catch { /* 캐시일 뿐이다 */ }
  }
  return out;
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
    // ★ 여는 범위는 부모를 **그대로 물려받는다.** 안 물려주면 프로젝트 링크로 받은 사람이
    //   알림 메일의 개인 링크를 눌렀을 때 채팅 화면으로 떨어진다(좁아지는 쪽이라 누수는
    //   아니지만, 받은 사람에게는 "그 화면이 안 나온다" 는 고장이다 — 2026-09-05 Fable 지적).
    scope: normalizeScope(parentLink.scope),
    client_id: parentLink.client_id,
    guest_user_id: parentLink.guest_user_id,   // 확인 전까지는 부모의 익명 신원
    email_verified_at: null,
    token_hash: hashToken(placeholder),
    token_hint: '------',                      // 확인 전에는 보여줄 힌트가 없다
    // 권한은 부모를 넘지 않는다(판정은 resolve 에서).
    //   ★ 예외는 워크스페이스 창구뿐이다: 자식은 **자기 방**을 갖고(부모에게는 방이 없다)
    //     그 방은 이 방문자 한 사람의 것이다. 창구 공유 링크는 열람 전용으로 강제되므로
    //     그 값을 그대로 물려받으면 확인을 마친 사람이 자기 방에도 못 쓴다.
    //     여는 범위가 넓어지는 것이 아니다 — 쓸 수 있는 방이 자기 방 하나로 그대로다.
    can_write: normalizeScope(parentLink.scope) === 'workspace' ? true : parentLink.can_write,
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
  // ★ 워크스페이스 창구에서는 이 시점에 방이 **없다**(conversation_id NULL). 참여자 행을 먼저
  //   만들려 하면 NOT NULL 로 죽고, 그러면 확인 자체가 실패한다.
  //   그 경로의 방·참여자는 바로 다음에 `ensureVisitorConversation` 이 만든다 — 순서가 계약이다
  //   (신원을 먼저 갈라야 그 방이 «그 사람의 방» 이 된다. 부모 그림자로 만들면 무리 전체가 들어온다).
  if (link.conversation_id) {
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: link.conversation_id, user_id: guestUser.id },
      defaults: { conversation_id: link.conversation_id, user_id: guestUser.id, role: 'client' },
    });
  }
  await link.update({ guest_user_id: guestUser.id });
  return guestUser;
}

/**
 * 워크스페이스 창구로 들어와 이메일을 확인한 방문자에게 **자기 대화방**을 준다 (§4.2 «문의하기»).
 *
 * ★ 왜 여기서 만드나: 창구(shared) 링크에는 방이 없다 — «아직 아무와도 대화하지 않은 문» 이다.
 *   방을 창구에 하나 두고 모두가 같이 쓰게 하면, 링크를 받은 사람 전원이 **남의 문의를 읽는다.**
 *   그래서 방은 «확인을 마친 사람» 단위다. 그 시점이 신원이 생기는 시점이기도 하다.
 * ★ **멱등**이다 — 이미 방이 붙어 있으면 그것을 돌려준다. 재확인(두 번째 verify)에서 다시
 *   불려도 방이 둘이 되지 않는다.
 * ★ `client_id` 는 **붙이지 않는다.** P1 에서는 고객 행을 만들지 않는다(prospect 생성은 P2 예약의
 *   몫이다 — §5). 고객 없는 customer 대화방은 Q sale «상담» 탭이 `client_id IS NULL` 축으로
 *   이미 모아 보는 형태다(Q_SALE §5.2-A) — 그래서 팀 쪽에 **새 화면이 필요 없다.**
 * ★ 환영 문구는 `clientOnboarding.welcomeText` **한 곳**에서 가져온다. 여기에 문구를 새로 쓰면
 *   초대로 들어온 고객과 창구로 들어온 고객이 다른 인사를 받는다(같은 값의 공식 두 벌).
 *
 * @returns {Promise<object|null>} 붙인(또는 이미 있던) Conversation. 실패하면 null — 확인 자체는 성공해야 한다.
 */
async function ensureVisitorConversation(link) {
  try {
    if (!link || normalizeScope(link.scope) !== 'workspace') return null;
    // 이미 자기 방이 있으면 그것이다(멱등).
    if (link.conversation_id) {
      const existing = await Conversation.findByPk(link.conversation_id);
      if (existing && existing.business_id === link.business_id) return existing;
      // 가리키는 방이 사라졌거나 어긋났으면 새로 만든다 — 그대로 두면 resolve 가 링크를 닫는다.
    }
    const { Message } = require('../models');
    const biz = await Business.findByPk(link.business_id, {
      attributes: ['id', 'name', 'brand_name', 'default_language', 'cue_user_id'],
    });
    const lang = biz?.default_language === 'en' ? 'en' : 'ko';
    const workspaceName = biz?.brand_name || biz?.name || 'PlanQ';

    const conversation = await Conversation.create({
      business_id: link.business_id,
      project_id: null,
      // ★ 제목은 **방문자가 적은 이름**이다. 없으면 워크스페이스 이름으로 떨어진다 —
      //   `contact_email` 을 제목에 쓰지 않는다: 대화방 제목은 Q Talk 목록·알림·검색에 뜨고,
      //   주소는 그 자리들에 필요하지 않다(최소 노출).
      title: link.contact_name || workspaceName,
      client_id: null,
      channel_type: 'customer',
      cue_enabled: true,
      auto_extract_enabled: true,
    });

    // 참여자 — 방문자(그림자 User)는 필수. 확인 직후라 `promotePersonalIdentity` 가 이미
    //   자기 그림자를 붙여 두었다(호출 순서가 계약이다 — 부모 것으로 만들면 무리 전체가 한 방에 들어온다).
    await ConversationParticipant.findOrCreate({
      where: { conversation_id: conversation.id, user_id: link.guest_user_id },
      defaults: { conversation_id: conversation.id, user_id: link.guest_user_id, role: 'client' },
    });
    // 팀 쪽 참여자 — 창구를 만든 사람(created_by). 없으면 방이 **아무에게도 안 보인다.**
    if (link.created_by && link.created_by !== link.guest_user_id) {
      await ConversationParticipant.findOrCreate({
        where: { conversation_id: conversation.id, user_id: link.created_by },
        defaults: { conversation_id: conversation.id, user_id: link.created_by, role: 'owner' },
      });
    }
    if (biz?.cue_user_id && biz.cue_user_id !== link.created_by) {
      await ConversationParticipant.findOrCreate({
        where: { conversation_id: conversation.id, user_id: biz.cue_user_id },
        defaults: { conversation_id: conversation.id, user_id: biz.cue_user_id, role: 'member' },
      });
    }

    // 환영 메시지 — 초대 경로와 **같은 문구**(clientOnboarding 한 곳).
    const senderId = link.created_by || biz?.cue_user_id || null;
    const content = require('./clientOnboarding')
      .welcomeText(lang, { workspaceName, clientName: link.contact_name });
    const welcome = await Message.create({
      conversation_id: conversation.id,
      business_id: link.business_id,
      sender_id: senderId,
      content,
      message_type: senderId ? 'text' : 'system',
      is_read: false,
    });
    await conversation.update({ last_message_at: welcome.created_at || new Date() });

    // 링크가 자기 방을 가리키게 — 이 한 줄이 «내 자리» 를 만든다.
    await link.update({ conversation_id: conversation.id });
    return conversation;
  } catch (e) {
    // ★ 던지지 않는다. 방을 못 만들어도 **이메일 확인 자체는 성공해야 한다** — 확인이 실패로
    //   보이면 방문자는 코드를 다시 받으려 하고, 그 사이 한도에 걸린다.
    //   방이 없으면 화면은 «문의하기» 탭에서 안내를 보여 주고(대화가 없는 상태), 다음 확인·
    //   다음 진입에서 이 함수가 다시 불린다(멱등).
    console.error('[guest_link] 방문자 대화방 생성 실패:', e.message);
    return null;
  }
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

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
function sharedSecret() {
  const secret = process.env.GUEST_LINK_SECRET;
  return secret && String(secret).length >= 32 ? secret : null;
}

/**
 * **공유** 링크의 토큰 — 개인 링크(personalTokenFor)와 같은 원리, 재료만 다르다(§B-1).
 *   `shared:` 접두어가 두 종류의 토큰 공간을 가른다(같은 행 값으로 두 토큰이 겹치지 않게).
 * ★ createdAt 은 **DB 에서 읽은 값**이어야 한다(초 단위). issueGuestLink 가 reload 뒤에 부른다.
 */
function sharedTokenFor(link) {
  const secret = sharedSecret();
  if (!secret) return null;
  const createdAt = link?.createdAt || link?.created_at;
  if (!link || !link.id || !link.business_id || !createdAt) return null;
  const material = `shared:${link.id}:${new Date(createdAt).getTime()}:${link.business_id}`;
  return crypto.createHmac('sha256', secret).update(material).digest('base64url');
}

/**
 * 살아 있는 공유 링크의 주소 — 파생 토큰의 해시가 저장된 해시와 **같을 때만.**
 *   옛 난수 링크는 원문을 모르므로 null 이다(마이그레이션할 수 없다 — §B 하지 말 것).
 */
function urlForSharedLink(link) {
  if (!link || link.kind !== 'shared' || link.revoked_at) return null;
  const token = sharedTokenFor(link);
  if (!token || hashToken(token) !== link.token_hash) return null;
  return `${APP_URL}/g/${token}`;
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

/**
 * 게스트 링크 회수 — **단일 지점.**
 *
 * ★ 2026-09-10 — 대화방(routes/guest_admin.js)과 프로젝트(routes/projects.js)가 각자 구현하고 있었고
 *   프로젝트 쪽이 넷을 빠뜨렸다: `revoked_by` 미기록 · **자식(개인) 링크 동반 회수 안 함** ·
 *   캐시 무효화 안 함 · 감사 action 이 'delete'(다른 쪽은 'guest_link.revoke').
 *   발급 판정은 이미 assertGuestLinkIssuable 한 함수로 모아 두었는데 회수만 갈라져 있었다.
 *   "같은 술어" 를 주석으로 약속하지 말고 **같은 함수를 부르게** 한다.
 *
 * @returns {{ ok: boolean, already?: boolean, link?: object }}
 */
/**
 * 답글 알림을 신청한 **사람** 한 명 — 링크가 아니다.
 *
 * ★ 2026-09-10 — 프로젝트 경로가 이 직렬화를 손으로 다시 쓰면서 **없는 컬럼**(`guest_email`)을
 *   읽고 `guest_name`(personal 행에서는 언제나 null)을 썼다. 응답은 200 인데 화면의
 *   "답글 알림을 신청한 사람" 칸이 전원 `—` / 빈 이메일 / "확인 안 됨" 으로 나갔다.
 *   실제 컬럼은 contact_name · contact_email · email_verified_at 이다.
 *   같은 값의 공식을 두 벌 두지 않는다 — 회수(revokeGuestLink)와 같은 원칙.
 *
 * ★ 이 이름을 대화 메시지 옆에 붙이지 말 것. 링크는 메일로 전달될 수 있고, 전달받은
 *   제3자의 글이 **확인된 사람의 글로 보인다**(#259 에서 이미 난 사고와 같은 모양).
 *   메시지 표시명의 원천은 언제나 messages.meta.guest.name 박제다.
 */
function serializeGuestContact(l) {
  return {
    id: l.id,
    name: l.contact_name,
    email: l.contact_email,
    verified_at: l.email_verified_at,
    unsubscribed_at: l.unsubscribed_at,
    last_used_at: l.last_used_at,
    last_used_ip: l.last_used_ip,
    last_notified_at: l.last_notified_at,
    revoked_at: l.revoked_at,
    // ★ Sequelize 속성명은 **createdAt** 이다(underscored:true 는 컬럼명만 바꾼다).
    //   `l.created_at` 은 언제나 undefined 라 JSON 에서 통째로 빠진다 — 오류 없이 조용히 사라진다.
    created_at: l.createdAt ?? l.created_at,
  };
}

async function revokeGuestLink(link, { userId, transaction } = {}) {
  if (!link) return { ok: false };
  if (link.revoked_at) return { ok: true, already: true, link };
  const at = new Date();
  await link.update({ revoked_at: at, revoked_by: userId || null }, { transaction });
  // ★ 부모를 회수하면 **자식(개인 링크)도 같이 닫는다.** 읽는 쪽(resolveGuestToken)이
  //   부모를 보므로 이미 닫히지만, 행에 흔적을 남겨야 목록·30일 삭제 타이머가
  //   "언제 닫혔는지" 를 안다. 상태를 파생으로만 두면 그 시각을 아무도 모른다.
  if (link.kind === 'shared') {
    await GuestLink.update(
      { revoked_at: at, revoked_by: userId || null },
      { where: { parent_link_id: link.id, revoked_at: null }, transaction },
    );
  }
  if (link.conversation_id) {
    try { require('./guest_notify').invalidateGuestCache(link.conversation_id); } catch { /* 캐시일 뿐이다 */ }
  }
  return { ok: true, already: false, link };
}

module.exports = {
  revokeGuestLink,
  serializeGuestContact,
  SLIDING_TTL_MS, hashToken, generateToken, visibleToGuest,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS, OTP_LOCK_MS, NOTIFY_COOLDOWN_MS,
  generateOtpCode, normalizeEmail, ensurePersonalLink, mintPersonalToken, personalTokenFor,
  promotePersonalIdentity, ensureVisitorConversation, normalizeScope,
  resolveGuestToken, ensureShadowUser, issueGuestLink,
  issueOrReuseSharedLink, findLiveSharedLink, urlForSharedLink, sharedTokenFor,
  serializeGuestLink,
  assertGuestLinkIssuable,
};
