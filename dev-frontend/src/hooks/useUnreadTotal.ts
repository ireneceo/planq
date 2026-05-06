// Q Talk 토탈 unread 카운트 — 사이드바 Q Talk 메뉴 뱃지용
// 갱신 트리거:
//   - 마운트 시 1회 fetch
//   - window 'focus' 이벤트 (다른 탭에서 돌아올 때)
//   - custom event 'planq:unread-changed' (QTalkPage 가 새 메시지 / 읽음 처리 후 dispatch)
// 부수효과: count 변경 시 navigator.setAppBadge / clearAppBadge — 데스크탑 PWA dock 아이콘 숫자
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import * as qtalkApi from '../services/qtalk';

// Badging API 타입 (TypeScript lib 미포함)
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

export function useUnreadTotal(businessId: number | null | undefined): number {
  const [count, setCount] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    if (!businessId || !user) { setCount(0); applyBadge(0); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        const r = await qtalkApi.getUnreadTotal(businessId);
        if (!cancelled) {
          const n = r.total || 0;
          setCount(n);
          applyBadge(n);
        }
      } catch { /* silent */ }
    };

    refresh();

    const onChanged = () => refresh();
    window.addEventListener('planq:unread-changed', onChanged);
    window.addEventListener('focus', onChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('planq:unread-changed', onChanged);
      window.removeEventListener('focus', onChanged);
    };
  }, [businessId, user?.id]);

  return count;
}
