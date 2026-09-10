// 앱 아이콘 배지 — **좌측 메뉴에 뜨는 숫자와 같은 것**을 센다: 인박스(확인 필요) + Q Talk 안읽음.
//
// ★ 2026-09-04 정정. 이 자리를 한 번 "안 읽은 알림 수" 로 바꿨다가 되돌린다.
//   Irene: "좌측 메뉴에 나오는 기준이어야 하는데 알림숫자가 나와. 알림은 쓸데없이 많이 오는 건데."
//   실측이 그대로였다 — 그 시점 좌측 메뉴는 **확인 필요 2**, 앱 아이콘은 **17** 이었다.
//   알림은 정보 통지라 많이 오고, 아이콘의 숫자는 **처리할 일의 수**여야 한다. 정의를 바꾼 것은
//   요청이 아니라 내 판단이었고 틀렸다. 데스크탑 dock 이 쓰던 기준이 정본이다.
//
// 그때 얻은 것 중 유지하는 것 — **0 의 뜻을 값으로 추측하지 않는다.**
//   "아직 안 불러왔다(0)" 에서 지우면 푸시가 세워 둔 숫자가 앱을 열자마자 사라지고,
//   "불러왔더니 0 이다" 에서 안 지우면 다 처리했는데 숫자가 남는다. `loaded` 로 가른다.
//   (2026-09-04 Irene: "앱을 닫지도 않고 접어만 놔도 숫자가 없어져" 의 원인이 앞쪽이었다.)
//
// 백엔드 푸시 payload 의 badge 도 **같은 공식**이다 (routes/notifications.js).
//   공식이 두 벌이면 이미 갈라져 있다 — 잠금화면 숫자와 앱 안 숫자가 달라진다.
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
      // ★ 2026-09-10 — **배지 플러그인이 알림 권한의 첫 요청자가 되면 소리가 영영 빠진다.**
      //   `Badge.set/clear` 는 호출마다 내부적으로 권한을 요청하는데(BadgePlugin.swift:64,100)
      //   그 요청이 `requestAuthorization(options: .badge)` — **배지 하나뿐**이다(Badge.swift:27).
      //   iOS 는 최초 인증 시점의 옵션 집합을 고정하고 나중에 넓혀도 늘려주지 않으므로,
      //   이 호출이 먼저 나가면 그 기기에는 `Sounds` 항목 자체가 생기지 않는다
      //   (Irene 아이폰 실증: 알림은 오는데 설정에 Sounds 가 없음, 2026-09-10).
      //   → 푸시 권한이 이미 granted 일 때만 배지를 건드린다. 권한이 없으면 배지도 의미가 없다.
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const perm = await PushNotifications.checkPermissions().catch(() => null);
      if (perm?.receive !== 'granted') return;
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
 * @param inboxCount   확인 필요 건수 (좌측 메뉴의 그 숫자)
 * @param chatUnread   Q Talk 안 읽음 (좌측 메뉴의 그 숫자)
 * @param loaded       두 값을 서버에서 실제로 받았는가. false 인 동안의 0 은 "아직 모른다" 다.
 */
export function useGlobalBadge(inboxCount: number, chatUnread: number, loaded: boolean) {
  const prevTotalRef = useRef<number | null>(null);
  const totalRef = useRef<number>(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadedRef.current = loaded;
    if (!loaded) return;               // 아직 모른다 — 푸시가 세운 배지를 그대로 둔다
    const total = (inboxCount || 0) + (chatUnread || 0);
    totalRef.current = total;
    if (prevTotalRef.current === total) return;
    prevTotalRef.current = total;
    applyBadge(total);
  }, [inboxCount, chatUnread, loaded]);

  // visibility / focus 복귀 시 최신값으로 재적용 — SW push 가 background 에서 남긴 stale 배지 덮어쓰기
  //   (사이클 N+22). 단 값을 실제로 받은 뒤에만.
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
