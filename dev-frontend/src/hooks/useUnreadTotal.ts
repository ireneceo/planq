// Q Talk 토탈 unread 카운트 — 사이드바 Q Talk 메뉴 뱃지 + 데스크탑 PWA dock 아이콘 숫자.
//
// 갱신 트리거 (단일 source of truth):
//   - 마운트 시 1회 fetch
//   - window 'focus' (다른 탭에서 돌아올 때)
//   - custom event 'planq:unread-changed' (legacy — QTalkPage 의 read/send 후)
//   - **Socket.IO 'message:new' 직접 listen** — 어느 페이지에 있든 실시간 갱신
//   - **Socket.IO 'inbox:refresh'** — 읽음 처리·삭제 등
//
// 핵심: useUnreadTotal 자체가 단일 socket 을 들고 있어 다른 페이지에 있을 때도 실시간 갱신.
//       이전 구조는 QTalkPage 가 unmount 되면 'planq:unread-changed' dispatch 가 멈춰 좌측
//       메뉴 뱃지가 stale 됐음.
import { useEffect, useState, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth, getAccessToken } from '../contexts/AuthContext';
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
  const socketRef = useRef<Socket | null>(null);

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

    // Socket — 새 메시지 / 읽음 처리 즉시 갱신 (debounce 200ms 로 burst 합침)
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(refresh, 200);
    };

    if (getAccessToken()) {
      const s = io(window.location.origin, {
        auth: (cb) => cb({ token: getAccessToken() }),
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
        reconnectionAttempts: Infinity,
      });
      s.on('connect_error', () => { /* silent reconnect */ });
      // 새 메시지 — sender 본인 메시지든 타인 것이든 일단 refresh (백엔드 SQL 이 본인 발신 제외)
      s.on('message:new', debouncedRefresh);
      // 인박스/읽음 변경
      s.on('inbox:refresh', debouncedRefresh);
      socketRef.current = s;
    }

    const onChanged = () => refresh();
    window.addEventListener('planq:unread-changed', onChanged);
    window.addEventListener('focus', onChanged);

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      window.removeEventListener('planq:unread-changed', onChanged);
      window.removeEventListener('focus', onChanged);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [businessId, user?.id]);

  return count;
}
