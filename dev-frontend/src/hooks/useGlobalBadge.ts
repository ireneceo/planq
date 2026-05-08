// 단일 source — 인박스(확인 필요) + Q Talk 채팅 unread 합산해서 OS App Badge 적용.
//
// Irene 피드백 (2026-05-08): "앱 열면 뱃지 숫자가 사라짐. 실제로 봐야 사라지는 게 맞아."
//   원인: 기존엔 useUnreadTotal (채팅) 만 setAppBadge 호출. 인박스 N건 있어도 채팅 unread=0
//         이면 clearAppBadge 발동 → 데스크탑 dock 의 뱃지 즉시 사라짐.
//   해결: 인박스 + 채팅 합산값으로 단일 setAppBadge. 둘 중 하나라도 0 보다 크면 표시.
//         감소는 사용자가 실제로 채팅방 진입 (markRead) 또는 인박스 액션 (ack/approve/complete)
//         을 했을 때만.
import { useEffect } from 'react';

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
  useEffect(() => {
    const total = (inboxCount || 0) + (chatUnread || 0);
    applyBadge(total);
  }, [inboxCount, chatUnread]);
}
