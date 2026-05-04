// 디바이스 push 상태를 전역 두 곳에서 공유 (인박스 띠 배너 / 알림 설정 PushSection).
//   - 'loading'       — 첫 detect 진행 중
//   - 'unsupported'   — 브라우저가 Push API 미지원 (iOS Safari 비-PWA, 데스크탑 Safari 등)
//   - 'denied'        — 사용자가 OS / 브라우저에서 차단함
//   - 'default-off'   — 권한 미요청 상태 (안내해서 켜라고 유도해야 함)
//   - 'granted-off'   — 권한 OK 인데 이 디바이스 구독 안 됨 (재구독만 하면 됨)
//   - 'granted-on'    — 정상 구독 중
import { useEffect, useState, useCallback } from 'react';

export type PushStatus = 'loading' | 'unsupported' | 'denied' | 'default-off' | 'granted-off' | 'granted-on';

export function usePushStatus(): { status: PushStatus; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<PushStatus>('loading');

  const detect = useCallback(async (): Promise<PushStatus> => {
    const { isPushSupported, isSubscribed } = await import('../services/push');
    if (!await isPushSupported()) return 'unsupported';
    const perm = Notification.permission;
    if (perm === 'denied') return 'denied';
    const subbed = await isSubscribed();
    if (perm === 'granted') return subbed ? 'granted-on' : 'granted-off';
    return 'default-off';
  }, []);

  const refresh = useCallback(async () => {
    setStatus(await detect());
  }, [detect]);

  useEffect(() => {
    let cancelled = false;
    detect().then(s => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, [detect]);

  return { status, refresh };
}
