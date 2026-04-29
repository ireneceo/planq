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
