// 인박스 (확인 필요) 미처리 카운트 — 좌측 nav 배지용
// 정책: TodoPage 와 동일하게 fetchTodo + Socket.IO 'inbox:refresh' 이벤트 구독.
// MainLayout 이 모든 페이지 공통이라 불필요한 호출을 피하기 위해 마운트 시 1회 + 이벤트 기반 갱신.
import { useEffect, useState, useRef } from 'react';
import { fetchTodo } from '../services/dashboard';
import { useAuth } from '../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../services/socket';

export interface InboxCounts { total: number; bill: number; mail: number; /** 서버에서 실제로 받았는가 — 앱 배지가 0 의 뜻을 값으로 추측하지 않게 한다. */ loaded: boolean }
export function useInboxCount(businessId: number | null | undefined): InboxCounts {
  const [count, setCount] = useState<InboxCounts>({ total: 0, bill: 0, mail: 0, loaded: false });
  const localCleanupRef = useRef<(() => void) | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!businessId || !user) { setCount({ total: 0, bill: 0, mail: 0, loaded: false }); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        // ★ 워크스페이스 범위를 **바꾸지 않는다.** 잠깐 전 워크스페이스 합계로 바꿨다가 되돌렸다 —
        //   푸시가 계산하는 배지(routes/notifications.js)는 현재 워크스페이스만 세므로, 여기만
        //   넓히면 두 숫자가 갈라지고 푸시가 도착할 때 배지를 덮어쓴다. 같은 범위를 유지한다.
        const r = await fetchTodo(businessId);
        if (!cancelled) setCount({ total: r.total || 0, bill: r.billCount || 0, mail: r.mailReplyCount || 0, loaded: true });
      } catch { /* silent — 실패는 0 건이 아니다. loaded 를 세우지 않는다 */ }
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

    // Socket.IO 'inbox:refresh' 구독 (공유 소켓 services/socket) — backend 가 task workflow 라우트에서 emit.
    // N+63 — workspace room join → backend 가 io.to('business:N').emit('inbox:refresh') 받음. join 은 멱등.
    joinRoom(`business:${businessId}`);
    const offInbox = onSocket('inbox:refresh', debounced);

    return () => {
      cancelled = true;
      if (localCleanupRef.current) { localCleanupRef.current(); localCleanupRef.current = null; }
      leaveRoom(`business:${businessId}`);
      offInbox();
    };
  }, [businessId, user?.id]);

  return count;
}
