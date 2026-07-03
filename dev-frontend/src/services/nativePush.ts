// 네이티브 푸시 (APNs/FCM) 등록 — Capacitor 앱 전용 (MOBILE_APP_DESIGN §5.4).
//   웹 push(services/push.ts)의 네이티브 대응. isNativeApp() 일 때만 push.ts 가 이리로 위임.
//   @capacitor/push-notifications 는 dynamic import — 웹 번들에 eager 로드되지 않음.
import { apiFetch, getAccessToken } from '../contexts/AuthContext';
import { nativePlatform } from './native';

let bound = false;
// device token 을 localStorage 에 영속 — 세션 재시작 후에도 unregisterNative(알림 끄기) 가능.
const TOKEN_KEY = 'planq:native:pushToken';
function setLastToken(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } }
function getLastToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function clearLastToken() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

const kindOf = (): 'apns' | 'fcm' => (nativePlatform() === 'ios' ? 'apns' : 'fcm');

// 앱 실행 시 호출 — 권한 요청 → 토큰 등록 → backend subscribe-native.
//   register() 는 매 호출 안전(토큰 변동 시 registration 이벤트 재발화 → subscribe-native 가 upsert).
//   웹의 24h 재구독/stale 로직에 해당하는 별도 처리 불필요(APNs/FCM 토큰은 안정적).
export async function registerNative(): Promise<{ ok: boolean; reason?: string }> {
  if (!getAccessToken()) return { ok: false, reason: 'not_authenticated' };
  let PushNotifications;
  try {
    ({ PushNotifications } = await import('@capacitor/push-notifications'));
  } catch {
    return { ok: false, reason: 'plugin_unavailable' };
  }

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') return { ok: false, reason: 'permission_denied' };

  if (!bound) {
    bound = true;
    // 토큰 수신 → backend 등록 (토큰 변동 시 재발화 → upsert).
    await PushNotifications.addListener('registration', async (token) => {
      setLastToken(token.value);
      try {
        const { Device } = await import('@capacitor/device');
        const info = await Device.getInfo().catch(() => null);
        await apiFetch('/api/push/subscribe-native', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: kindOf(),
            device_token: token.value,
            device_name: info ? `${info.manufacturer ?? ''} ${info.model}`.trim() : undefined,
          }),
        });
      } catch (e) {
        console.error('[nativePush] subscribe-native failed', e);
      }
    });
    await PushNotifications.addListener('registrationError', (e) => {
      console.error('[nativePush] registration error', e);
    });
    // 포그라운드 도착 — OS 알림은 config presentationOptions:[] 로 억제, 인앱 토스터(socket)가 담당 → no-op.
    await PushNotifications.addListener('pushNotificationReceived', () => { /* in-app toaster handles */ });
    // 알림 탭 — payload custom key 'link'(상대경로) 로 SPA 네비게이트 (NativeBridge 가 수신).
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification?.data as Record<string, unknown> | undefined;
      const link = (typeof data?.link === 'string' ? data.link : '') || '/';
      window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path: link } }));
    });
  }

  // Android: FCM notification 이 지정하는 채널(fcm_sender.js channel_id 'planq_default')을 생성.
  //   채널 미존재 시 Android 8+ 에서 알림이 표시되지 않음 (M-6). iOS 는 no-op.
  if (nativePlatform() === 'android') {
    try {
      await PushNotifications.createChannel({
        id: 'planq_default',
        name: 'PlanQ',
        description: 'PlanQ 알림',
        importance: 5, // HIGH — heads-up
        visibility: 1,
      });
    } catch { /* iOS/미지원 무시 */ }
  }

  await PushNotifications.register(); // → registration 이벤트로 토큰 수신
  return { ok: true };
}

// 구독 해지 — 저장된 토큰으로 backend DELETE (앱에서 알림 끄기).
export async function unregisterNative(): Promise<{ ok: boolean }> {
  const token = getLastToken();
  if (!token) return { ok: true };
  try {
    await apiFetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: kindOf(), device_token: token }),
    });
  } catch { /* ignore */ }
  clearLastToken();
  return { ok: true };
}

// 네이티브 푸시 권한/등록 상태 (NotificationSettings 용).
export async function nativePushStatus(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const p = await PushNotifications.checkPermissions();
    if (p.receive === 'granted') return 'granted';
    if (p.receive === 'denied') return 'denied';
    return 'prompt';
  } catch { return 'unknown'; }
}
