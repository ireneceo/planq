// services/workspacePage.js — 워크스페이스 **공개 페이지(고객 창구 «안내»)** 의 데이터 한 벌
//
//   설계: docs/WORKSPACE_PUBLIC_PAGE_DESIGN.md §3·§4 (2026-11-20 Irene «권고대로»)
//
// ★ 저장 모양(normalizeEntry)과 밖으로 내보내는 모양(publicView)을 **이 파일 한 곳**이 정한다.
//   - 설정 화면 읽기·쓰기(routes/customer_entry.js) · 창구 «안내» 탭(routes/guest.js) ·
//     로그인 고객 홈(routes/client_home.js) · (P3) 공개 주소·미리 만든 HTML·디렉터리 카드가 전부 이것을 지난다.
//   - 라우트마다 손으로 모양을 쓰면 갈라진다 — 09-25 에 guest.js entryOf 와 customer_entry.js normalizeIntro 가
//     같은 일을 두 벌로 하고 있었다(서비스 120자·6개를 두 곳에 따로 적었다).
// ★ publicView 는 **화이트리스트**다 — 남길 것만 남긴다. 가린 항목은 응답에 **실리지 않는다**
//   (화면에서만 숨기면 API·HTML·JSON-LD 로 샌다). id·owner·plan·permissions 원문은 절대 나가지 않는다.
// ★ 저장 자리는 `businesses.permissions.customer_entry` JSON(새 컬럼·새 표 없음 — 설계 §4).
const crypto = require('crypto');
const { normalizeBooking, bookingOf, normalizeWorkHours, serializeWorkHours } = require('./booking');

const INTRO_MAX = 2000;
const SERVICE_MAX = 12;
const EXTRA_MAX = 8;
const TAG_MAX = 5;

/** 가릴 수 있는 자동 항목 키 — 화면의 «자동으로 들어간 정보» 줄과 같은 목록이다(이 순서로 그린다). */
const AUTO_KEYS = ['tagline', 'website', 'phone', 'email', 'address', 'work_hours', 'representative', 'biz_type'];
/** 처음 저장하는 워크스페이스의 기본 가림 — 이메일(주소 수집 대상·문의 폼이 대신한다)·대표자·업태. */
const DEFAULT_HIDDEN_NEW = ['email', 'representative', 'biz_type'];
/** 이미 창구 설정이 있던 워크스페이스 — 지금 보이던 이메일이 조용히 사라지지 않게(설계 §4). 대표자·업태는 원래 안 나갔다. */
const DEFAULT_HIDDEN_EXISTING = ['representative', 'biz_type'];

/** 공개 화면이 읽는 `businesses` 칸 — 화이트리스트가 막지만 **애초에 이것만 읽는다**(guest_link.js·client_home.js 가 같이 쓴다). */
const PROFILE_ATTRS = [
  'id', 'name', 'brand_name', 'brand_name_en', 'brand_logo_url', 'brand_tagline', 'brand_tagline_en',
  'phone', 'email', 'website', 'address', 'address_en', 'representative', 'representative_en',
  'biz_type', 'biz_item', 'work_hours', 'timezone', 'permissions',
];

/** 서비스 사진·로고 — 우리 심볼 서빙 길만(공개 무인증 · UUID 파일명). 그 밖의 주소는 그리지 않는다. */
const SYMBOL_PATH = /^\/api\/businesses\/symbol\/[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i;

const str = (v, max) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : '';
};
const orNull = (s) => (s ? s : null);
/** 바깥 주소 — http(s) 만. 임의 스킴(`javascript:`·`data:`)을 공개 화면에 그리지 않는다. */
function webUrl(v) {
  const s = String(v || '').trim().slice(0, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : null;
  } catch { return null; }
}
/** 예전 창구가 쓰던 규칙 — 홈페이지는 https 만(옛 entryOf 그대로). */
function httpsUrl(v) {
  const u = webUrl(v);
  return u && u.startsWith('https:') ? u : null;
}
const newId = () => crypto.randomBytes(6).toString('hex');

/**
 * 저장값 → 정본 모양. 읽기·쓰기 모두 이 함수를 지난다. 모르는 키는 버린다.
 * `hadSaved` = 이 워크스페이스에 창구 설정이 이미 있었나 — `hidden` 기본값을 가른다.
 */
function normalizeEntry(raw, { hadSaved = true } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hidden = Array.isArray(src.hidden)
    ? [...new Set(src.hidden.filter((k) => AUTO_KEYS.includes(k)))]
    : (hadSaved ? DEFAULT_HIDDEN_EXISTING : DEFAULT_HIDDEN_NEW).slice();

  // 서비스 — 옛 모양(문자열 배열)은 `{ name }` 으로 올린다(마이그레이션 없음, 저장 때 새 모양).
  const seen = new Set();
  const services = (Array.isArray(src.services) ? src.services : [])
    .map((s) => (typeof s === 'string' ? { name: s } : s))
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      let id = typeof s.id === 'string' && /^[0-9a-f]{6,24}$/.test(s.id) ? s.id : newId();
      if (seen.has(id)) id = newId();
      seen.add(id);
      return {
        id,
        name: str(s.name, 40),
        name_en: str(s.name_en, 40),
        summary: str(s.summary, 200),
        summary_en: str(s.summary_en, 200),
        price_text: str(s.price_text, 40),
        price_text_en: str(s.price_text_en, 40),
        image_url: typeof s.image_url === 'string' && SYMBOL_PATH.test(s.image_url) ? s.image_url : '',
      };
    })
    // 이름이 비면 버린다 — 빈 카드가 목록에 남으면 고장으로 보인다. 단 편집 중 «새 카드» 는 화면이 들고 있다.
    .filter((s) => s.name)
    .slice(0, SERVICE_MAX);

  const extras = (Array.isArray(src.extras) ? src.extras : [])
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      label: str(x.label, 30), label_en: str(x.label_en, 30),
      value: str(x.value, 200), value_en: str(x.value_en, 200),
    }))
    .filter((x) => x.label && x.value)
    .slice(0, EXTRA_MAX);

  const tags = [...new Set((Array.isArray(src.tags) ? src.tags : [])
    .map((t) => str(t, 20)).filter(Boolean))].slice(0, TAG_MAX);

  const f = src.form && typeof src.form === 'object' ? src.form : {};
  return {
    intro: str(src.intro, INTRO_MAX),
    intro_en: str(src.intro_en, INTRO_MAX),
    hidden,
    services,
    extras,
    tags,
    // 문의 폼(P2) — 기본 켜짐. 전화·회사명은 워크스페이스가 켰을 때만 묻는다.
    form: { enabled: f.enabled !== false, ask_phone: f.ask_phone === true, ask_company: f.ask_company === true },
    // 상담 예약 — 모양은 services/booking.js normalizeBooking 한 곳.
    booking: normalizeBooking(src.booking),
  };
}

/** 저장된 창구 설정(없으면 null). */
function savedEntryOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  return p.customer_entry && typeof p.customer_entry === 'object' ? p.customer_entry : null;
}

/**
 * 이 워크스페이스의 창구 설정 — 저장된 값 + 기본값.
 * ★ 읽을 때 저장값이 없으면 **지금까지의 표시**(이메일 보임)로 읽는다 — 창구 링크만 있고 설정을 저장한 적 없는
 *   워크스페이스(dev ws6 실측)의 이메일이 배포 순간 조용히 사라지지 않게(설계 §4).
 *   새 기본값(이메일 가림)은 «처음 꾸미는» 순간에 저장으로 박는다 — 창구 링크를 처음 만들 때·링크 없이 처음 저장할 때
 *   (routes/customer_entry.js 가 `newDefaults` 로 부른다).
 */
function entryOf(biz) {
  return normalizeEntry(savedEntryOf(biz), { hadSaved: true });
}
/** 처음 꾸미는 워크스페이스의 저장값 — 새 기본 가림(이메일·대표자·업태). */
function newDefaults() {
  return normalizeEntry(null, { hadSaved: false });
}

/**
 * 밖으로 내보내는 모양 — **화이트리스트.** 가린 항목·빈 값은 키 자체가 null 이다.
 * lang = 'en' 이면 `_en` 칸을 쓰고, 비어 있으면 한국어 값으로 떨어진다.
 *
 * 돌려주는 키는 기존 창구 응답(`tagline·intro·services·contact·booking`)을 **넓힌 것**이다 —
 * 옛 화면 번들이 같은 키를 읽어도 깨지지 않게 `contact` 모양을 유지한다.
 */
function publicView(biz, { lang = 'ko' } = {}) {
  if (!biz) return null;
  const e = entryOf(biz);
  const en = lang === 'en';
  const pick = (ko, enV) => (en && enV ? enV : ko);
  const shown = (k) => !e.hidden.includes(k);

  const wh = shown('work_hours') ? serializeWorkHours(biz.work_hours) : null;
  const bizType = shown('biz_type') ? [str(biz.biz_type, 100), str(biz.biz_item, 100)].filter(Boolean).join(' · ') : '';
  const bk = bookingOf(biz);

  return {
    tagline: shown('tagline') ? orNull(str(pick(biz.brand_tagline, biz.brand_tagline_en), 200)) : null,
    intro: orNull(pick(e.intro, e.intro_en)),
    services: e.services.map((s) => ({
      id: s.id,
      name: pick(s.name, s.name_en),
      summary: orNull(pick(s.summary, s.summary_en)),
      price_text: orNull(pick(s.price_text, s.price_text_en)),
      image_url: orNull(s.image_url),
    })),
    contact: {
      phone: shown('phone') ? orNull(str(biz.phone, 50)) : null,
      email: shown('email') ? orNull(str(biz.email, 200)) : null,
      website: shown('website') ? httpsUrl(biz.website) : null,
      address: shown('address') ? orNull(str(pick(biz.address, biz.address_en), 500)) : null,
    },
    // 근무시간 — booking.js 가 정한 모양({mon:[9,18],…})이 **저장된 경우에만**. 모양 없는 원문·기본값은 싣지 않는다.
    work_hours: wh,
    timezone: wh ? (str(biz.timezone, 50) || 'Asia/Seoul') : null,
    representative: shown('representative') ? orNull(str(pick(biz.representative, biz.representative_en), 100)) : null,
    biz_type: orNull(bizType),
    extras: e.extras.map((x) => {
      const value = pick(x.value, x.value_en);
      return { label: pick(x.label, x.label_en), value, href: webUrl(value) };
    }),
    // 상담 예약 탭을 보일지·한 번 길이 — 두 값만(담당 멤버·상한·리드타임은 싣지 않는다).
    booking: { enabled: bk.enabled, duration_minutes: bk.duration },
    // 문의 폼(P2) — 켜짐 여부와 묻는 칸만.
    form: { ...e.form },
  };
}

/** 설정 화면의 «자동으로 들어간 정보» — 원천 값(가림 여부와 무관하게, 멤버 이상 인증 응답에서만 쓴다). */
function autoValuesOf(biz) {
  const hoursSet = !!normalizeWorkHours(biz.work_hours);
  return {
    name: biz.brand_name || biz.name || '',
    logo_url: biz.brand_logo_url && SYMBOL_PATH.test(biz.brand_logo_url) ? biz.brand_logo_url : null,
    tagline: biz.brand_tagline || '',
    website: biz.website || '',
    phone: biz.phone || '',
    email: biz.email || '',
    address: biz.address || '',
    work_hours: hoursSet ? serializeWorkHours(biz.work_hours) : null,
    representative: biz.representative || '',
    biz_type: [biz.biz_type, biz.biz_item].filter(Boolean).join(' · '),
  };
}

module.exports = {
  AUTO_KEYS, PROFILE_ATTRS, SYMBOL_PATH, SERVICE_MAX, EXTRA_MAX, TAG_MAX, INTRO_MAX,
  normalizeEntry, entryOf, savedEntryOf, newDefaults, publicView, autoValuesOf, webUrl,
};
