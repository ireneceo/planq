// 외부 OAuth 시작 — 웹/네이티브 분기 (MOBILE_APP_DESIGN §6.8 ★최우선 함정).
//
// Google OAuth 는 WebView 안(Capacitor WebView) 에서 열면 `disallowed_useragent` 로 차단된다.
// 따라서 네이티브 앱에서는 시스템 브라우저(iOS SFSafariViewController / Android Custom Tab)로 연다.
// 콜백은 Universal Link/App Link 로 앱에 복귀 → App.tsx 의 appUrlOpen 브리지가 Browser 를 닫고
// `planq:oauth-connected`(연동) / `planq:navigate`(딥링크) 이벤트를 발행한다.
//
// 웹(브라우저/PWA)에서는 기존 동작 그대로 — redirect 는 location.href, popup 은 window.open.
// 웹 회귀 0: 모든 분기는 isNativeApp() 이 true 인 쪽이 새 길.
import { isNativeApp } from './native';

function toAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return window.location.origin + (url.startsWith('/') ? url : '/' + url);
}

// ─── iOS 로그인 창 (ASWebAuthenticationSession) ─────────────────────────────
// Irene 2026-10-16 (아이패드 앱): "팝업이 하얗게 나오고 다시 닫으니까 예전 이상한 코드 넣으라는 잘못된 UI 가
//   그대로 나와. 구글 원터치 로그인 제대로 되게."
// 앱 안 플러그인(ios/App/App/AppDelegate.swift PlanqAuthSessionPlugin). 사파리에 로그인된 구글 계정을 그대로 쓰고,
// planq:// 로 돌아오는 순간 OS 가 창을 닫고 그 주소를 준다 — «열기» 확인도 6자리 코드도 없다.
// 이 플러그인이 없는 옛 앱(1.0.1 까지)은 아래 종전 창으로 간다.
type AuthSessionResult = { url?: string; canceled?: boolean };
interface PlanqAuthSessionPlugin { start(o: { url: string; callbackScheme: string }): Promise<AuthSessionResult> }

/** iOS 로그인 창으로 연다. 썼으면 true(결과 처리까지 끝), 못 쓰는 앱이면 false. */
async function openIosAuthSession(url: string): Promise<boolean> {
  const { Capacitor, registerPlugin } = await import('@capacitor/core');
  if (Capacitor.getPlatform() !== 'ios' || !Capacitor.isPluginAvailable('PlanqAuthSession')) return false;
  // ★ 플러그인 객체를 async 함수에서 돌려주지 않는다 — Capacitor 프록시는 아무 속성이나 함수로 답해
  //   `then` 까지 있는 것처럼 보여 await 가 그것을 부른다(창이 영영 안 뜬다, 카나리로 잡음).
  const plugin = registerPlugin<PlanqAuthSessionPlugin>('PlanqAuthSession');
  let r: AuthSessionResult;
  try {
    r = await plugin.start({ url: toAbsolute(url), callbackScheme: 'planq' });
  } catch {
    // 창이 못 떴다(auth_session_not_started 등) — 조용히 끝내면 «눌러도 아무 일 없는 버튼» 이 된다.
    //   false 를 돌려 부르는 쪽이 종전 창으로 연다(Fable 지적 3).
    return false;
  }
  if (r?.url) {
    let u: URL | null = null;
    try { u = new URL(r.url); } catch { /* 잘못된 주소 */ }
    const { handleNativeReturnUrl } = await import('./nativeReturn');
    if (u) await handleNativeReturnUrl(u);
  }
  // 창이 닫혔다(성공·취소 공통 — 옛 창의 browserFinished 와 같은 뜻). 취소면 아무것도 묻지 않는다.
  window.dispatchEvent(new CustomEvent('planq:oauth-dismissed'));
  return true;
}

async function openNativeBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  // ★ 'popover' 를 쓰지 않는다(2026-10-16) — 아이폰에서는 어차피 전체 화면으로 바뀌고, 아이패드에서만
  //   화면 가운데 팝오버로 떠 하얗게 비었다(Irene 신고). 전체 화면은 두 기기에서 같다.
  await Browser.open({ url: toAbsolute(url), presentationStyle: 'fullscreen' });
}

/** 전체 페이지 redirect 형 OAuth 시작 (로그인·Gmail 등). 네이티브는 시스템 브라우저. */
// ─── 앱 세션 페어링 ────────────────────────────────────────────────────────
// 딥링크(planq:// · App Link)가 앱을 열지 못하는 기기에서의 정본 경로.
//   Irene 2026-09-06: "앱에서 로그인해도 돌아가지 않아."
// 흐름: ①앱이 pair_id 를 받고 ②그것을 붙여 브라우저를 연다 ③로그인이 끝나면 **브라우저 화면에**
//       6자리 코드가 뜨고 ④사용자가 앱에 입력하면 앱이 세션을 받아간다.
//   ★ 비밀(코드)은 개시 링크로 들어가지 않는다 — 첫 설계가 그렇게 했다가 계정 탈취가 됐다
//     (dev-backend/services/oauthPairing.js 머리말).
const PAIR_KEY = 'planq.oauth.pair';
// 서버 pair TTL 과 같다(services/oauthPairing.js TTL_MS). 그보다 오래된 흐름은 서버에도 없다.
const PAIR_TTL_MS = 10 * 60 * 1000;

/**
 * 앱이 코드 입력을 띄워야 하는지 — 진행 중인 페어링이 있으면 그 id.
 * ★ 2026-09-10 — 시각을 같이 저장하고 **10분 지난 것은 없는 것으로** 본다. 여태는 지우는 길이
 *   성공/취소뿐이라, 팝오버를 그냥 닫고 며칠 뒤 앱을 켜도 "코드를 입력하세요" 가 떴다.
 */
export function pendingPairId(): string | null {
  try {
    const raw = localStorage.getItem(PAIR_KEY);
    if (!raw) return null;
    let id: string | null = null; let at = 0;
    if (raw.startsWith('{')) { const j = JSON.parse(raw) as { id?: string; at?: number }; id = j.id || null; at = Number(j.at) || 0; }
    // 옛 형식(문자열만) — 나이를 알 수 없으니 만료로 본다(한 번만 겪는다).
    if (!id || !at || Date.now() - at > PAIR_TTL_MS) { localStorage.removeItem(PAIR_KEY); return null; }
    return id;
  } catch { return null; }
}
export function clearPair(): void {
  try { localStorage.removeItem(PAIR_KEY); } catch { /* private mode */ }
}

/**
 * 코드 입력창을 띄울 때인가 — 브라우저에서 로그인이 **끝나** 코드가 화면에 떴을 때만 true.
 * 창을 그냥 닫았거나(로그인 전) 흐름이 만료됐으면 false. 만료면 흐름을 지운다.
 * (2026-10-16 Irene 아이패드: 하얀 창을 닫았는데 코드를 물었다 — 입력할 코드가 없는데.)
 */
export async function pairReadyForCode(): Promise<boolean> {
  const pairId = pendingPairId();
  if (!pairId) return false;
  try {
    const { apiFetch } = await import('../contexts/AuthContext');
    const r = await apiFetch('/api/auth/google/pair/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair_id: pairId }),
    });
    const st = r.ok ? (await r.json())?.data?.status : null;
    if (st === 'unknown') clearPair();
    // 묻는 사이 딥링크 교환이 흐름을 지웠을 수 있다 — 그때는 띄우지 않는다.
    return st === 'ready' && pendingPairId() === pairId;
  } catch {
    return false;   // 모르면 띄우지 않는다 — 엉뚱한 질문보다 다시 누르는 편이 낫다
  }
}

/** 사용자가 입력한 6자리로 세션을 받아온다. */
export async function claimWithCode(code: string): Promise<{ ok: boolean; reason?: string }> {
  const pairId = pendingPairId();
  if (!pairId) return { ok: false, reason: 'no_pair' };
  const { apiFetch } = await import('../contexts/AuthContext');
  const { detectClientKind } = await import('./native');
  const r = await apiFetch('/api/auth/google/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair_id: pairId, code: String(code).replace(/\D/g, ''), client_kind: detectClientKind() }),
  });
  if (r.ok) { clearPair(); return { ok: true }; }
  let reason = 'failed';
  try { reason = (await r.json())?.message || reason; } catch { /* 본문 없음 */ }
  // 되돌릴 수 없는 실패는 흐름을 정리한다 — 계속 물어보면 사용자가 갇힌다.
  if (reason === 'too_many_attempts' || reason === 'expired_or_unknown') clearPair();
  return { ok: false, reason };
}

export async function startAuthRedirect(url: string): Promise<void> {
  if (isNativeApp()) {
    // iOS 로그인 창이 있으면 그것으로 끝낸다 — 복귀를 OS 가 보장하므로 6자리 페어링을 열지 않는다
    //   (페어링이 없으면 코드 입력창은 뜰 일이 없다).
    clearPair();
    if (await openIosAuthSession(url)) return;
    // 딥링크가 실패해도 코드로 이어갈 수 있게 흐름을 먼저 연다. 실패하면 딥링크만으로 진행.
    let withPair = url;
    try {
      const { apiFetch } = await import('../contexts/AuthContext');
      const r = await apiFetch('/api/auth/google/pair/start', { method: 'POST' });
      const j = await r.json();
      const pairId = j?.data?.pair_id;
      if (pairId) {
        localStorage.setItem(PAIR_KEY, JSON.stringify({ id: pairId, at: Date.now() }));
        withPair += (url.includes('?') ? '&' : '?') + 'pair=' + encodeURIComponent(pairId);
      }
    } catch { /* 페어링 없이 딥링크만으로 진행 */ }
    await openNativeBrowser(withPair);
    return;
  }
  window.location.href = url;
}

/**
 * popup 형 OAuth 시작 (워크스페이스 Drive·개인 연동 등).
 * 웹: window.open 팝업 반환(호출측이 closed 폴링 / postMessage 수신).
 * 네이티브: 시스템 브라우저로 열고 null 반환 — 호출측은 isNativeApp() 이면 `planq:oauth-connected`
 *          이벤트로 완료를 감지해야 한다(팝업 참조/postMessage 없음).
 */
export async function startAuthPopup(
  url: string,
  name = 'planq-oauth',
  features = 'width=520,height=660',
): Promise<Window | null> {
  if (isNativeApp()) {
    if (await openIosAuthSession(url)) return null;
    await openNativeBrowser(url);
    return null;
  }
  return window.open(url, name, features);
}
