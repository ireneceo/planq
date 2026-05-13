// Web Push 구독 관리 (사이클 J3).
// 흐름:
//   1) navigator.serviceWorker.register('/sw.js')
//   2) Notification.requestPermission()
//   3) GET /api/push/vapid-public-key
//   4) PushManager.subscribe({ applicationServerKey })
//   5) POST /api/push/subscribe (endpoint, keys, user_agent)
import { apiFetch } from '../contexts/AuthContext';

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
  if (!(await isPushSupported())) return { ok: false, reason: 'unsupported' };

  const perm = Notification.permission;
  if (perm === 'denied') return { ok: false, reason: 'permission_denied' };

  if (perm === 'granted') {
    if (await isSubscribed()) return { ok: true, reason: 'already_subscribed' };
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
// 페이지 focus 복귀 시 호출. denied 면 backend 의 sub 도 자동 unsubscribe 시켜 발송 시도 자체 차단.
export async function syncPermissionOnFocus(): Promise<void> {
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'denied') return;
  const subbed = await isSubscribed().catch(() => false);
  if (!subbed) return;
  await unsubscribe().catch(() => null);
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
  // 첫 1회 — 앱 진입 시점
  setTimeout(handler, 2000);
}
