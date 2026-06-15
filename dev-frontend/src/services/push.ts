// Web Push 구독 관리 (사이클 J3).
// 흐름:
//   1) navigator.serviceWorker.register('/sw.js')
//   2) Notification.requestPermission()
//   3) GET /api/push/vapid-public-key
//   4) PushManager.subscribe({ applicationServerKey })
//   5) POST /api/push/subscribe (endpoint, keys, user_agent)
import { apiFetch, getAccessToken } from '../contexts/AuthContext';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function isPushSupported(): Promise<boolean> {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// self-healing #9 — iOS 는 홈화면에 추가한 standalone PWA 에서만 web push 가 동작.
//   Safari 탭에서는 구독/표시가 안 되므로, iOS + 비-standalone 이면 '홈화면 추가' 안내가 필요.
export function isStandalonePWA(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
}


// 구독 자동 신선도 유지 — web push 의 구조적 staleness 대응.
//   browser 의 endpoint 가 backend 와 일치해도(겉으론 정상) push service 가 silent drop 하는 stale 구독이 누적된다.
//   사용자에게 "껐다 켜기" 를 시키는 대신, 앱 사용 중 일정 주기(24h)마다 자동으로 구독을 재생성해 stale 을 청소.
//   박제: feedback_push_auto_resubscribe.md (운영 알림 미수신 미팅 누락 사고)
const RESUB_KEY = 'planq:push:lastResub';
const RESUB_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24시간

function shouldForceResub(): boolean {
  try { return Date.now() - Number(localStorage.getItem(RESUB_KEY) || '0') > RESUB_INTERVAL_MS; }
  catch { return false; }
}
function markResubNow(): void {
  try { localStorage.setItem(RESUB_KEY, String(Date.now())); } catch { /* ignore */ }
}

export async function getPushStatus(): Promise<'granted' | 'denied' | 'default' | 'unsupported'> {
  if (!await isPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.error('[push] SW register failed', e);
    return null;
  }
}

export async function subscribe(): Promise<{ ok: boolean; reason?: string }> {
  // 사이클 N+17 — logout 상태면 즉시 return. 로그인 페이지에서 401 무한 retry 회귀 차단.
  if (!getAccessToken()) return { ok: false, reason: 'not_authenticated' };
  if (!await isPushSupported()) return { ok: false, reason: 'unsupported' };

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'permission_denied' };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: 'sw_failed' };

  // VAPID 공개키
  const r = await apiFetch('/api/push/vapid-public-key');
  if (!r.ok) {
    const j = await r.json();
    return { ok: false, reason: j.message || 'vapid_unavailable' };
  }
  const { data } = await r.json();
  const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

  // 기존 구독 정리 (있으면 server 갱신만)
  let sub = await reg.pushManager.getSubscription();
  // 기존 sub 가 invalid 한 경우 (p256dh 짧음 등 — SW 업데이트 사이 깨진 케이스) 강제 재구독.
  // backend 에서도 동일 검증하지만 client 측에서 미리 unsubscribe 해 endpoint 갱신 보장.
  if (sub) {
    const checkJson = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
    const p = checkJson.keys?.p256dh || '';
    const a = checkJson.keys?.auth || '';
    if (p.length < 80 || a.length < 8) {
      console.warn('[push] invalid existing subscription detected — resubscribing');
      await sub.unsubscribe().catch(() => null);
      sub = null;
    }
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });
    } catch (e) {
      console.error('[push] subscribe failed', e);
      return { ok: false, reason: 'subscribe_failed' };
    }
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const post = await apiFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      user_agent: navigator.userAgent,
    }),
  });
  if (!post.ok) {
    const j = await post.json();
    return { ok: false, reason: j.message || 'register_failed' };
  }
  markResubNow();
  return { ok: true };
}

export async function unsubscribe(): Promise<{ ok: boolean; reason?: string }> {
  if (!('serviceWorker' in navigator)) return { ok: true }; // already not supported
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { ok: true };
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await apiFetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
  return { ok: true };
}

export async function isSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// browser 의 PushSubscription.endpoint 가 backend 의 active row 에 존재하는지 검증.
// browser 에는 sub 가 있는데 backend 에 row 가 없는 desync (좀비 자동 expire, DB reset 등) 시 false.
// 박제: feedback_external_dispatch_validation.md (N+12 — push 무성공 회귀의 핵심 원인)
async function backendHasMatchingSub(): Promise<{ matched: boolean; browserEndpoint: string | null }> {
  if (!('serviceWorker' in navigator)) return { matched: false, browserEndpoint: null };
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { matched: false, browserEndpoint: null };
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { matched: false, browserEndpoint: null };
  try {
    const r = await apiFetch('/api/push/me');
    if (!r.ok) return { matched: false, browserEndpoint: sub.endpoint };
    const j = await r.json();
    const list: string[] = j?.data?.endpoints || [];
    return { matched: list.includes(sub.endpoint), browserEndpoint: sub.endpoint };
  } catch {
    // 네트워크 에러 — 보수적으로 matched=true 처리해 무한 재구독 루프 방지.
    return { matched: true, browserEndpoint: sub.endpoint };
  }
}

export async function sendTestPush(): Promise<{ sent: number; skipped?: string }> {
  const r = await apiFetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const j = await r.json();
  return j.data || { sent: 0 };
}

// 자동 구독 시도 — 로그인 직후 한 번 호출.
//   granted  → 조용히 subscribe (이미 허락한 사용자)
//   default  → 7일에 1회 prompt (Slack 패턴, invasive 방지)
//   denied   → skip (NotificationSettings 에서 OS 권한 변경 안내)
const AUTO_PROMPT_KEY = 'planq:push:lastPrompt';
const PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

export async function autoSubscribeIfPossible(): Promise<{ ok: boolean; reason?: string }> {
  // 사이클 N+17 — logout 상태 즉시 return (401 무한 retry 차단)
  if (!getAccessToken()) return { ok: false, reason: 'not_authenticated' };
  if (!(await isPushSupported())) return { ok: false, reason: 'unsupported' };

  const perm = Notification.permission;
  if (perm === 'denied') return { ok: false, reason: 'permission_denied' };

  if (perm === 'granted') {
    // browser sub 존재만으로 'already_subscribed' 끝내면 backend desync 시 영영 재구독 안 됨.
    // backend 에 endpoint row 가 실제 있는지 비교 → 미스매치면 browser sub 해제 후 재구독.
    // 박제: N+12 dev PushLog total=17, sent=0, skipped=12("no_subs") 회귀.
    if (await isSubscribed()) {
      const check = await backendHasMatchingSub();
      // matched 여도 24h 경과(shouldForceResub) 면 stale 청소 위해 강제 재구독.
      if (check.matched && !shouldForceResub()) return { ok: true, reason: 'already_subscribed' };
      // desync(미스매치) 또는 신선도 만료 — browser sub 해제 후 subscribe() 가 깨끗하게 재등록
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const s = reg ? await reg.pushManager.getSubscription() : null;
        if (s) await s.unsubscribe();
        console.warn('[push] backend desync — resubscribing', { browserEndpoint: check.browserEndpoint });
      } catch { /* unsubscribe 실패 무시 — subscribe() 가 재시도 */ }
    }
    return await subscribe();
  }

  // default — 7일 1회 prompt
  try {
    const last = Number(localStorage.getItem(AUTO_PROMPT_KEY) || '0');
    if (Date.now() - last < PROMPT_INTERVAL_MS) {
      return { ok: false, reason: 'recently_prompted' };
    }
    localStorage.setItem(AUTO_PROMPT_KEY, String(Date.now()));
  } catch { /* localStorage 비활성 환경 무시 */ }

  return await subscribe();
}

// 권한 동기화 — 사용자가 OS/브라우저 설정에서 알림 권한 OFF 했을 때 backend 좀비 endpoint 정리.
// 페이지 focus 복귀 시 호출.
//   denied → backend 의 sub 도 자동 unsubscribe (좀비 차단)
//   granted → backend desync 검증 후 미스매치면 재구독 (N+12 회귀 자동 복구)
export async function syncPermissionOnFocus(): Promise<void> {
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return;
  // 사이클 N+17 — logout 상태 (accessToken null) 면 즉시 return.
  // 로그인 페이지에서 focus/visibility 시 push subscribe → 401 → refresh → 401 → 무한 retry 회귀 차단.
  if (!getAccessToken()) return;
  const perm = Notification.permission;
  if (perm === 'denied') {
    const subbed = await isSubscribed().catch(() => false);
    if (!subbed) return;
    await unsubscribe().catch(() => null);
    return;
  }
  if (perm === 'granted') {
    // browser 에 sub 가 있는데 backend 에 없거나(desync), 신선도 만료(24h) 면 자동 재구독. 사용자 액션 불필요.
    const check = await backendHasMatchingSub().catch(() => ({ matched: true, browserEndpoint: null }));
    if (!check.matched || shouldForceResub()) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const s = reg ? await reg.pushManager.getSubscription() : null;
        if (s) await s.unsubscribe();
      } catch { /* ignore */ }
      await subscribe().catch(() => null);
    }
  }
}

// App 진입 1회 + focus/visibility 시 등록 — main.tsx 또는 App.tsx 에서 한 번만 호출
let permissionSyncBound = false;
export function bindPermissionSync(): void {
  if (permissionSyncBound) return;
  permissionSyncBound = true;
  const handler = () => { void syncPermissionOnFocus(); };
  window.addEventListener('focus', handler);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handler();
  });
  // SW 가 구독 만료/교체 감지 시(pushsubscriptionchange) 재구독 요청 — 토큰 보유한 client 가 처리.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if (e.data && e.data.type === 'planq:resubscribe-needed') void subscribe();
    });
  }
  // 첫 1회 — 앱 진입 시점
  setTimeout(handler, 2000);
}
