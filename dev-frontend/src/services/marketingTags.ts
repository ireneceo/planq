// 랜딩 마케팅 측정 — GTM(안에 GA4·Meta 픽셀) 을 «싣는가» 와 «무엇을 보내는가» 의 한 곳 (2026-10-17).
//   설계 정본 docs/MARKETING_TRACKING_DESIGN.md (Fable 설계 PASS). 이 파일 밖에서 dataLayer·gtag·fbq 를 만지지 않는다.
//
// ★ 범위 = 랜딩(공개 소개) + 가입 화면뿐(§2). 워크스페이스 앱·공유 링크·로그인 사용자·앱(네이티브)·초대 가입은 싣지도 않는다 —
//   제3자 스크립트는 DOM 을 읽을 수 있고, 앱 DOM 에는 고객사 데이터가 있다.
// ★ 태그를 실은 문서에서 범위 밖으로 나가면 문서를 새로 읽는다(leaveScope) — SPA 라 스크립트가 메모리에 남아
//   GA4·픽셀이 앱 주소(pushState)를 따라 보낸다. 철회 순서에 기대지 않고 통째로 버린다.
// ★ 켜는 스위치는 platform_settings.gtm_container_id(서버별 DB) — 비어 있으면 아무것도 안 한다(dev 기본 꺼짐).
// ★ 동의(§4, Fable K2 변형): 한국 방문자 = 기본 켜짐 + 띠(끌 수 있음) / 그 밖 = «허용» 전에는 싣지 않음.
// ★ 개인정보는 싣지 않는다 — 이메일·이름·전화·회사·본문·id·토큰 0. 주소는 경로 + utm_* 만(sanitizeLocation).
import { isNativeApp } from './native';

const GTM_ORIGIN = 'https://www.googletagmanager.com';
const CONSENT_KEY = 'planq:consent';
const SIGNUP_KEY = 'planq:mkt-signup-sent';
export const CONSENT_OPEN_EVENT = 'planq:open-consent';
export const CONSENT_CHANGED_EVENT = 'planq:consent-changed';

export interface Consent { v: 1; analytics: boolean; ads: boolean; at: number }

// ── 범위 ─────────────────────────────────────────────────────────────────────
// 랜딩 방문 집계(dev-backend/routes/landing_visits.js · public/seo-pages.json)와 같은 목록 + 가입 화면.
const LANDING_PAGES: Record<string, string> = {
  '/': 'home', '/features': 'features', '/details': 'details', '/security': 'security', '/start': 'start', '/pricing': 'pricing',
  '/service': 'service', '/service/diagnosis': 'diagnosis', '/insights': 'insights_list', '/guide': 'wiki',
  '/about': 'about', '/contact': 'contact', '/app': 'app', '/privacy': 'legal', '/terms': 'legal',
  '/register': 'register',
};

function stripPath(pathname: string): string {
  let p = String(pathname || '/').split(/[?#]/)[0].toLowerCase();
  if (p === '/en' || p === '/en/') return '/';
  if (p.startsWith('/en/')) p = p.slice(3);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

/** 이 주소의 페이지 종류 — 범위 밖이면 null. */
export function pageTypeOf(pathname: string): string | null {
  const p = stripPath(pathname);
  if (LANDING_PAGES[p]) return LANDING_PAGES[p];
  if (/^\/insights\/[a-z0-9][a-z0-9-]{0,120}$/.test(p)) return 'article';
  if (/^\/guide\/a\/[a-z0-9][a-z0-9-]{0,120}$/.test(p)) return 'wiki';
  return null;
}

/** 가입 완료 착지(/register?done=1) — «로그인한 사람 제외» 의 유일한 예외(§3-3). */
export function isSignupDone(pathname: string, search: string): boolean {
  return stripPath(pathname) === '/register' && new URLSearchParams(search).get('done') === '1';
}

/** 태그를 실어도 되는 주소·사람인가. 판정은 여기 한 곳. */
export function isTrackable(pathname: string, search: string, loggedIn: boolean): boolean {
  if (isNativeApp()) return false;
  const type = pageTypeOf(pathname);
  if (!type) return false;
  if (type === 'register') {
    // 초대 가입·다른 곳으로 돌아가는 가입은 획득이 아니고, 주소에 초대 토큰이 실린다 — 싣지 않는다.
    if (new URLSearchParams(search).has('redirect')) return false;
    if (isSignupDone(pathname, search)) return true;
  }
  return !loggedIn;
}

/** 보내는 주소 — 경로 + utm_* 만. 쿼리의 나머지(토큰·plan 등)와 해시는 버린다. */
export function sanitizeLocation(href: string): string {
  try {
    const u = new URL(href);
    const keep = new URLSearchParams();
    u.searchParams.forEach((v, k) => { if (/^utm_[a-z]{1,20}$/i.test(k)) keep.set(k, v.slice(0, 100)); });
    const q = keep.toString();
    return `${u.origin}${u.pathname}${q ? `?${q}` : ''}`;
  } catch { return ''; }
}

// ── 동의 ─────────────────────────────────────────────────────────────────────
export function isKoreanVisitor(): boolean {
  try {
    const langs = [navigator.language, ...(navigator.languages || [])].map((l) => String(l || '').toLowerCase());
    if (langs.some((l) => l.startsWith('ko'))) return true;
    return Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Seoul';
  } catch { return false; }
}

export function readConsent(): Consent | null {
  try {
    const v = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null') as Consent | null;
    if (v && v.v === 1 && typeof v.analytics === 'boolean' && typeof v.ads === 'boolean') return v;
  } catch { /* 저장소를 못 쓰면 고르지 않은 것 */ }
  return null;
}

/** 지금 적용되는 동의 — 고른 값, 없으면 한국 방문자만 기본 켜짐. null = 허용 전(싣지 않음). */
export function effectiveConsent(): { analytics: boolean; ads: boolean } | null {
  const c = readConsent();
  if (c) return { analytics: c.analytics, ads: c.ads };
  return isKoreanVisitor() ? { analytics: true, ads: true } : null;
}

export function saveConsent(analytics: boolean, ads: boolean): void {
  const prev = effectiveConsent();
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, analytics, ads, at: Date.now() } satisfies Consent)); } catch { /* noop */ }
  if (loadedId) {
    // 이미 실었는데 둘 다 껐으면 스크립트를 통째로 버린다(새로 읽기). 일부만 바뀌면 Consent Mode 로 알린다.
    if (!analytics && !ads) { window.location.reload(); return; }
    if (!prev || prev.analytics !== analytics || prev.ads !== ads) {
      gtag('consent', 'update', consentFields(analytics, ads));
      dl().push({ event: 'pq_consent_update', ads_allowed: ads ? '1' : '0' });
    }
  }
  try { window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT)); } catch { /* noop */ }
}

function consentFields(analytics: boolean, ads: boolean) {
  const a = ads ? 'granted' : 'denied';
  return { analytics_storage: analytics ? 'granted' : 'denied', ad_storage: a, ad_user_data: a, ad_personalization: a };
}

// ── 설정(ID) ─────────────────────────────────────────────────────────────────
let configPromise: Promise<string | null> | null = null;
/** 컨테이너 ID — 기존 공개 GET /api/platform/info 의 한 칸. 모양이 틀리면 꺼짐. */
export function loadContainerId(): Promise<string | null> {
  if (!configPromise) {
    configPromise = fetch('/api/platform/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const id = String(j?.data?.gtm_container_id || '').trim();
        return /^GTM-[A-Z0-9]{4,12}$/.test(id) ? id : null;
      })
      .catch(() => null);
  }
  return configPromise;
}

// ── 싣기·보내기 ──────────────────────────────────────────────────────────────
type DataLayer = Array<unknown> & { push: (...a: unknown[]) => number };
function dl(): DataLayer {
  const w = window as unknown as { dataLayer?: DataLayer };
  if (!w.dataLayer) w.dataLayer = [] as unknown as DataLayer;
  return w.dataLayer;
}
// gtag 는 arguments 객체를 넣어야 GTM 이 명령으로 읽는다(배열이면 데이터로 읽는다).
function gtag(..._args: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params
  dl().push(arguments);
}

let loadedId: string | null = null;
export function tagsLoaded(): boolean { return !!loadedId; }

/** 범위 안에서만 부른다. ID·동의가 있으면 GTM 을 한 번 싣는다. 실었으면 true. */
export async function ensureLoaded(): Promise<boolean> {
  if (loadedId) return true;
  // 마지막 방어선 — 부르는 쪽이 판정을 빠뜨려도 범위 밖 주소·돌아갈 곳(토큰이 실린다)이 있는 주소에서는 싣지 않는다
  //   (Fable 완료 검증 1차 FAIL: 이메일 가입이 /register?redirect=/c/<토큰> 에서 실을 뻔했다).
  if (!pageTypeOf(window.location.pathname) || new URLSearchParams(window.location.search).has('redirect')) return false;
  const id = await loadContainerId();
  if (!id) return false;
  const c = effectiveConsent();
  if (!c || (!c.analytics && !c.ads)) return false;
  if (loadedId) return true;
  // 같은 사이트 안에서 온 referrer 는 출처(origin)만 남긴다 — 공유 링크(/public/…/<토큰>·/c/<토큰>) 에서 홈으로 문서 이동하면
  //   document.referrer 에 토큰 주소가 실려 GA4 page_referrer·픽셀이 그대로 읽는다. 사이트 안 이동은 유입 경로로 의미가 없다.
  //   (밖에서 온 referrer — 검색·SNS — 는 그대로 둔다. 링크 쪽 rel="noreferrer" 와 겹으로.)
  try {
    const ref = document.referrer;
    if (ref && new URL(ref).origin === window.location.origin && !pageTypeOf(new URL(ref).pathname)) {
      Object.defineProperty(document, 'referrer', { configurable: true, get: () => `${window.location.origin}/` });
    }
  } catch { /* 못 덮으면 링크 쪽 noreferrer 가 막는다 */ }
  // 동의 기본값이 먼저 — GTM 은 큐를 순서대로 읽는다.
  gtag('consent', 'default', consentFields(c.analytics, c.ads));
  dl().push({ 'gtm.start': Date.now(), event: 'gtm.js', ads_allowed: c.ads ? '1' : '0' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `${GTM_ORIGIN}/gtm.js?id=${encodeURIComponent(id)}`;
  s.dataset.pqMarketing = '1';
  document.head.appendChild(s);
  loadedId = id;
  return true;
}

export type MarketingEvent =
  | 'pq_page_view' | 'pq_view_pricing' | 'pq_view_service' | 'pq_cta_click' | 'pq_signup_view' | 'pq_sign_up'
  | 'pq_lead' | 'pq_diagnosis_start' | 'pq_diagnosis_complete' | 'pq_diagnosis_email' | 'pq_app_download';

/**
 * 이벤트 한 건. 실려 있지 않거나 지금 주소가 범위 밖이면 아무것도 안 한다.
 *   params 에 개인정보를 넣지 않는다 — 범주값(고른 칸·종류)만.
 */
export function track(event: MarketingEvent, params: Record<string, string | number | undefined> = {}, opts: { onDone?: () => void } = {}): void {
  if (!loadedId) { opts.onDone?.(); return; }
  const payload: Record<string, unknown> = {
    event,
    page_location: sanitizeLocation(window.location.href),
    page_path: stripPath(window.location.pathname),
    ...params,
  };
  if (opts.onDone) {
    let called = false;
    const done = () => { if (!called) { called = true; opts.onDone?.(); } };
    payload.eventCallback = done;
    payload.eventTimeout = 2000;
    window.setTimeout(done, 2500);   // GTM 이 못 떠도(차단·네트워크) 사용자를 세워 두지 않는다
  }
  dl().push(payload);
}

/** 범위 밖으로 나갈 때 — 태그를 실은 문서면 새로 읽어 스크립트를 버린다. */
export function leaveScope(): boolean {
  if (!loadedId) return false;
  window.location.replace(window.location.href);
  return true;
}

/** 가입 전환 — 한 사람 한 번(브라우저 표식). 끝나면 to 로 간다(실었으면 문서 새로 읽기). */
export async function finishSignup(
  params: { method: string; trial_plan?: string }, userId: number | string | undefined,
  to: string, spaNavigate: (to: string) => void,
): Promise<void> {
  const go = () => { if (loadedId) window.location.replace(to); else spaNavigate(to); };
  let already = false;
  try { already = !!userId && localStorage.getItem(SIGNUP_KEY) === String(userId); } catch { /* noop */ }
  if (already || !(await ensureLoaded())) { go(); return; }
  try { if (userId) localStorage.setItem(SIGNUP_KEY, String(userId)); } catch { /* noop */ }
  track('pq_sign_up', { method: params.method, trial_plan: params.trial_plan }, { onDone: go });
}

/** 링크 주소 → CTA 목적지(측정하는 것만). */
export function ctaTargetOf(href: string): string | null {
  try {
    const u = new URL(href, window.location.href);
    if (u.origin !== window.location.origin) return null;
    const p = stripPath(u.pathname);
    if (p === '/register') return 'register';
    if (p === '/pricing') return 'pricing';
    if (p === '/service') return 'service';
    if (p === '/service/diagnosis') return 'diagnosis';
    if (p === '/contact') return 'contact';
    if (p === '/app') return 'app';
  } catch { /* noop */ }
  return null;
}
