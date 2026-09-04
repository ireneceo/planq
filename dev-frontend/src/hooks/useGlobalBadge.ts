// 단일 source — 인박스(확인 필요) + Q Talk 채팅 unread 합산해서 OS App Badge 적용.
//
// Irene 피드백 (2026-05-08): "앱 열면 뱃지 숫자가 사라짐. 실제로 봐야 사라지는 게 맞아."
//   원인: 기존엔 useUnreadTotal (채팅) 만 setAppBadge 호출. 인박스 N건 있어도 채팅 unread=0
//         이면 clearAppBadge 발동 → 데스크탑 dock 의 뱃지 즉시 사라짐.
//   해결: 인박스 + 채팅 합산값으로 단일 setAppBadge. 둘 중 하나라도 0 보다 크면 표시.
//
// **★ 회귀 fix (2026-05-08 Q-S):** useEffect 첫 마운트 시 두 hook 이 0 으로 시작 (fetch 전).
//   그대로 applyBadge(0) 호출하면 clearAppBadge 발동 → SW push 가 설정한 옛 뱃지 즉시 삭제.
//   해결: 첫 마운트 + 합계 0 → skip. fetch 끝난 후 실값 받으면 그때 적용. 이전값 변화 없으면 skip.
//
// **사이클 N+22 — 데스크탑·모바일 dock badge stale fix:**
//   사용자 보고: "데스크탑 dock 4 / 사이드바 Q Talk 3 / 채팅 읽어도 4 안 사라짐"
//   원인: SW push 가 mark-read 직후 stale payload.badge=4 로 setAppBadge 덮어쓰기 (race).
//   해결: 1) SW 가 visible client 있으면 setAppBadge skip (sw.js).
//        2) 본 hook 이 visibility / focus 변경 시 latest total 로 setAppBadge 강제 재호출.
//        3) skip 로직 제거 — 변화 없어도 visibilitychange 시 한 번 더 호출해 SW stale 덮어쓰기.
import { isNativeApp } from '../services/native';
import { useEffect, useRef } from 'react';

interface NavigatorBadge {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

async function applyBadge(count: number) {
  try {
    // 네이티브 앱: WebView 는 navigator.setAppBadge 미지원 → Badge 플러그인으로 아이콘 배지 제어(M-2).
    //   다 읽으면 count=0 → Badge.clear() 로 배지 즉시 감소/해제 (APNs aps.badge 만으론 stale 잔존).
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

export function useGlobalBadge(inboxCount: number, chatUnread: number) {
  const prevTotalRef = useRef<number | null>(null);
  const totalRef = useRef<number>(0);
  // ★ 2026-09-04 (Irene: "앱을 닫지도 않고 접어만 놔도 앱에 표시되던 숫자 알림이 없어져")
  //   아래 visibility 재적용이 **카운트가 도착하기 전에도** 0 을 적용해 배지를 지웠다.
  //   순서: 앱 시작(카운트 0, prevTotal=0 기록) → 백그라운드에서 푸시 도착(배지 3) →
  //   앞으로 나옴 → visibilitychange → applyBadge(0) → Badge.clear().
  //   "아직 모른다(0)" 와 "확인해보니 0 이다" 는 다른 상태다. 실제 갱신을 한 번이라도
  //   받은 뒤에만 재적용한다. 재적용의 원래 목적(SW 가 남긴 stale 배지 덮어쓰기)은 유지된다.
  const hasRealUpdateRef = useRef(false);

  useEffect(() => {
    const total = (inboxCount || 0) + (chatUnread || 0);
    totalRef.current = total;
    // 첫 마운트 시 합계 0 — 데이터 fetch 전일 가능성 큼. SW 가 설정한 옛 뱃지 그대로 두고 skip.
    if (prevTotalRef.current === null && total === 0) {
      prevTotalRef.current = 0;
      return;
    }
    // 변경 시 즉시 setAppBadge — 마크 리드 직후 dock 즉시 갱신 보장.
    if (prevTotalRef.current === total) return;
    prevTotalRef.current = total;
    hasRealUpdateRef.current = true;   // 실제 갱신을 받았다 — 이제 0 도 신뢰할 수 있다
    applyBadge(total);
  }, [inboxCount, chatUnread]);

  // visibility / focus 변경 시 latest total 로 재호출 — SW push handler 가 background 에서
  // setAppBadge 했다 하더라도 client active 되면 즉시 정답 값으로 덮어쓰기.
  useEffect(() => {
    const reapply = () => {
      // 실제 갱신 전에는 손대지 않는다 — 0 은 "없다" 가 아니라 "아직 모른다" 이다.
      if (document.visibilityState === 'visible' && hasRealUpdateRef.current) {
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
