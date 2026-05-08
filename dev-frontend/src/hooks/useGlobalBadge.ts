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
import { useEffect, useRef } from 'react';

interface NavigatorBadge {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

function applyBadge(count: number) {
  try {
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
  useEffect(() => {
    const total = (inboxCount || 0) + (chatUnread || 0);
    // 첫 마운트 시 합계 0 — 데이터 fetch 전일 가능성 큼. SW 가 설정한 옛 뱃지 그대로 두고 skip.
    if (prevTotalRef.current === null && total === 0) {
      prevTotalRef.current = 0;
      return;
    }
    // 변경 없으면 skip (재호출 노이즈 방지)
    if (prevTotalRef.current === total) return;
    prevTotalRef.current = total;
    applyBadge(total);
  }, [inboxCount, chatUnread]);
}
