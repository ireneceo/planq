// 앱 아이콘 배지 — **안 읽은 알림 수** 하나만 센다.
//
// ★ 2026-09-05 (Irene: "앱에 알림 표시 없어지는 거 똑같아. 앱 내리면 없어져버려" / "뱃지가 아예 없어져")
//   운영 실측이 원인을 확정했다. 그 시점 Irene 계정은
//     채팅 안읽음(참여방·ws1) = 0 · 인박스 확인필요 = 0 · **안 읽은 알림 = 17건**
//   그런데 배지가 세던 것은 `인박스 + 채팅` 이었다. 그래서 푸시가 띄워 놓은 배지를
//   앱이 열리자마자 0 으로 계산해 `Badge.clear()` 로 지웠다.
//   **배지를 올린 장부(알림)와 내리는 장부(인박스+채팅)가 서로 달랐다.**
//   알림이 17건 와 있는데 "아예 없어진" 것이 정확히 이 모양이다.
//
//   → 단일 원천을 `notifications.read_at IS NULL` 로 고정한다. 배지를 올리는 푸시는
//     `notify()` 가 보내고, 그 **같은 호출이 알림 행도 만든다**(inbox 채널). 올리는 것과
//     내리는 것이 같은 행을 센다. 백엔드 push payload 의 badge 도 같은 공식으로 맞췄다
//     (routes/notifications.js) — 공식이 두 벌이면 이미 갈라져 있다.
//
//   인박스(확인 필요)·채팅 안읽음은 **각자의 사이드바 뱃지를 그대로 유지**한다. 배지에 합산하지
//   않는 이유: 업무 배정 하나가 알림 1건 + 확인필요 1건을 동시에 만들어 **2 로 뜨는데 열면 1건**이
//   된다(같은 함정을 채팅 안읽음에서 이미 겪었다 — conversations.js `me/unread-total-all` 주석).
//
// 이전 이력 (그대로 유효한 것):
//   - 첫 마운트 시 0 은 "없다" 가 아니라 "아직 모른다" — SW/APNs 가 세운 배지를 지우지 않는다.
//   - visibility/focus 복귀 시 최신값으로 재적용 — SW push 가 남긴 stale 배지 덮어쓰기
//     (사이클 N+22). 단 **실제 갱신을 한 번이라도 받은 뒤에만**.
import { isNativeApp } from '../services/native';
import { useEffect, useRef } from 'react';

interface NavigatorBadge {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

async function applyBadge(count: number) {
  try {
    // 네이티브 앱: WebView 는 navigator.setAppBadge 미지원 → Badge 플러그인으로 아이콘 배지 제어(M-2).
    if (isNativeApp()) {
      const { Badge } = await import('@capawesome/capacitor-badge');
      if (count > 0) await Badge.set({ count });
      else await Badge.clear();
      return;
    }
    const nav = navigator as Navigator & NavigatorBadge;
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(count).catch(() => null);
    } else if (count === 0 && typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => null);
    }
  } catch { /* unsupported — silent */ }
}

/**
 * @param unreadNotifications 안 읽은 알림 수 (useNotificationCountState — 전 워크스페이스)
 * @param loaded 그 수를 서버에서 실제로 받았는가. **값으로 추측하지 않는다** —
 *   `false` 인 동안의 0 은 "아직 모른다" 라 배지를 건드리지 않고, `true` 인 0 은
 *   "확인해보니 없다" 라 배지를 지운다. 옛 코드는 이 둘을 값 하나로 구별하려다,
 *   다 읽어도 배지가 남거나 앱을 열자마자 배지가 사라지는 양쪽 회귀를 오갔다.
 */
export function useGlobalBadge(unreadNotifications: number, loaded: boolean) {
  const prevTotalRef = useRef<number | null>(null);
  const totalRef = useRef<number>(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadedRef.current = loaded;
    if (!loaded) return;               // 아직 모른다 — 푸시가 세운 배지를 그대로 둔다
    const total = unreadNotifications || 0;
    totalRef.current = total;
    if (prevTotalRef.current === total) return;
    prevTotalRef.current = total;
    applyBadge(total);
  }, [unreadNotifications, loaded]);

  useEffect(() => {
    const reapply = () => {
      if (document.visibilityState === 'visible' && loadedRef.current) {
        applyBadge(totalRef.current);
      }
    };
    document.addEventListener('visibilitychange', reapply);
    window.addEventListener('focus', reapply);
    return () => {
      document.removeEventListener('visibilitychange', reapply);
      window.removeEventListener('focus', reapply);
    };
  }, []);
}
