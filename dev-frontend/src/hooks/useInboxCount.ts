// 인박스 (확인 필요) 미처리 카운트 — 좌측 nav 배지용
// 정책: TodoPage 와 동일하게 fetchTodo + Socket.IO 'inbox:refresh' 이벤트 구독.
// MainLayout 이 모든 페이지 공통이라 불필요한 호출을 피하기 위해 마운트 시 1회 + 이벤트 기반 갱신.
import { useEffect, useState, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { fetchTodo } from '../services/dashboard';

export function useInboxCount(businessId: number | null | undefined): number {
  const [count, setCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!businessId) { setCount(0); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        const r = await fetchTodo(businessId);
        if (!cancelled) setCount(r.total || 0);
      } catch { /* silent */ }
    };

    refresh();

    // Socket.IO 'inbox:refresh' 구독 — Todo/Inbox 페이지에서 발행
    const token = localStorage.getItem('token');
    if (token) {
      const socket = io(window.location.origin, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
      });
      socketRef.current = socket;

      let pending: ReturnType<typeof setTimeout> | null = null;
      const debounced = () => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(refresh, 300);
      };
      socket.on('inbox:refresh', debounced);
    }

    return () => {
      cancelled = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [businessId]);

  return count;
}
