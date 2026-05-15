// Q Talk 토탈 unread 카운트 — 사이드바 Q Talk 메뉴 뱃지용.
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
//
// **OS App Badge 는 여기서 안 만진다** — 인박스 + 채팅 합산이 정확. MainLayout 의 합산 hook
//   (useGlobalBadge) 가 단일 source 로 setAppBadge/clearAppBadge 책임. 이전 구조는 채팅
//   unread 만 보고 badge 클리어해서 인박스 N 건 있어도 사라지는 버그가 있었음.
import { useEffect, useState, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuth, getAccessToken } from '../contexts/AuthContext';
import * as qtalkApi from '../services/qtalk';

export function useUnreadTotal(businessId: number | null | undefined): number {
  const [count, setCount] = useState(0);
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!businessId || !user) { setCount(0); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        const r = await qtalkApi.getUnreadTotal(businessId);
        if (!cancelled) setCount(r.total || 0);
      } catch { /* silent */ }
    };

    refresh();

    // 사이클 N+15-D — 사이드바 뱃지 실시간성 강화.
    // (1) 옵티미스틱: socket message:new 이벤트로 타 발신자 메시지 도착 시 setCount(+1) 즉시.
    //     채팅 리스트(QTalkPage)와 사이드바가 같은 frame 에 +1 → "타이밍 mismatch" 회귀 차단.
    // (2) 그 후 50ms debounce 로 backend API 와 reconcile (정확성).
    let pending: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(refresh, 50);
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
      s.on('message:new', (msg: { sender_id?: number; conversation_id?: number }) => {
        // 옵티미스틱 +1 — 타인 발신 메시지일 때만. 본인 발신은 backend 에서 제외되므로 카운트 변경 X.
        if (msg && msg.sender_id && Number(msg.sender_id) !== Number(user.id)) {
          setCount((prev) => prev + 1);
        }
        debouncedRefresh();
      });
      // 인박스/읽음 변경
      s.on('inbox:refresh', debouncedRefresh);
      // 사이클 N+15-D — 자기 conv 진입 시 즉시 뱃지에서 차감 (그 conv 의 unread 만큼).
      //   QTalkPage 가 'planq:unread-changed' detail 로 차감량 전달.
      socketRef.current = s;
    }

    // 'planq:unread-changed' 가 CustomEvent 로 detail.optimisticDelta 를 줄 수 있음.
    // 채팅방 진입 시 QTalkPage 가 차감 정보 전달 → 사이드바 즉시 -N (await API 기다리지 않음).
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.optimisticDelta === 'number') {
        setCount((prev) => Math.max(0, prev + detail.optimisticDelta));
      }
      refresh();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('planq:unread-changed', onChanged);
    window.addEventListener('focus', onChanged);
    // 모바일 PWA 는 focus 이벤트가 항상 발동하지 않음 → visibilitychange 로 보강.
    // 박제: feedback_visibility_refresh_server_fresh.md
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (pending) clearTimeout(pending);
      window.removeEventListener('planq:unread-changed', onChanged);
      window.removeEventListener('focus', onChanged);
      document.removeEventListener('visibilitychange', onVisible);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [businessId, user?.id]);

  return count;
}
