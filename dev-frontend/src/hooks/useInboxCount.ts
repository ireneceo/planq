// 인박스 (확인 필요) 미처리 카운트 — 좌측 nav 배지용
// 정책: TodoPage 와 동일하게 fetchTodo + Socket.IO 'inbox:refresh' 이벤트 구독.
// MainLayout 이 모든 페이지 공통이라 불필요한 호출을 피하기 위해 마운트 시 1회 + 이벤트 기반 갱신.
import { useEffect, useState, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { fetchTodo } from '../services/dashboard';
import { useAuth, getAccessToken } from '../contexts/AuthContext';

export function useInboxCount(businessId: number | null | undefined): number {
  const [count, setCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const localCleanupRef = useRef<(() => void) | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!businessId || !user) { setCount(0); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        const r = await fetchTodo(businessId);
        if (!cancelled) setCount(r.total || 0);
      } catch { /* silent */ }
    };

    refresh();

    let pending: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(refresh, 300);
    };

    // N+63 — CLAUDE.md §16 (e) 안전망 박제 정합. TaskDetailDrawer 가 status 변경 시
    // window.dispatchEvent('inbox:refresh') 호출하지만 본 hook 이 못 받아 사이드바
    // 뱃지 안 줄어드는 회귀 fix. 같은 탭 안 즉시 sync — socket 없을 때도 작동.
    // visibility 복귀도 같이 — PWA background → foreground 후 missed event 회복.
    const onLocalRefresh = () => debounced();
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('inbox:refresh', onLocalRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    localCleanupRef.current = () => {
      window.removeEventListener('inbox:refresh', onLocalRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
    };

    // Socket.IO 'inbox:refresh' 구독 — backend 가 task workflow 라우트에서 emit
    if (getAccessToken()) {
      const socket = io(window.location.origin, {
        auth: (cb) => cb({ token: getAccessToken() }),
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
        reconnectionAttempts: Infinity,
      });
      socket.on('connect_error', async (err) => {
        const msg = String((err as Error)?.message || '');
        if (/auth|token|jwt|unauthorized/i.test(msg)) {
          const { apiFetch } = await import('../contexts/AuthContext');
          await apiFetch('/api/auth/me').catch(() => null);
        }
      });
      socketRef.current = socket;
      socket.on('inbox:refresh', debounced);
      // N+63 — workspace room join → backend 가 io.to('business:N').emit('inbox:refresh') 받음.
      // socket connect 후 register (이미 user 인증 + bizId 있으니 즉시).
      socket.emit('join:business', businessId);
      socket.on('connect', () => socket.emit('join:business', businessId));
    }

    return () => {
      cancelled = true;
      if (localCleanupRef.current) { localCleanupRef.current(); localCleanupRef.current = null; }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [businessId, user?.id]);

  return count;
}
