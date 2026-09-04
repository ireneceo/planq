// N+63 — 인앱 알림 feed (Notification 테이블). 확인 필요 (useInboxCount) 와 분리.
//   본질이 다름: 확인 필요 = action queue, 알림 = activity feed (정보 통지).
//
// 사용처:
//   - 사이드바 헤더 종 모양 (count badge)
//   - NotificationDropdown (popover, 최근 10건)
//   - /notifications 페이지 (full list)
//   - 대시보드 카드 (최근 5건)
//
// 실시간 동기화 (CLAUDE.md §16 박제):
//   - socket 'notification:new' → unread-count +1 + list 갱신
//   - socket 'notification:read' / 'notification:read-all' → multi-device 동기화
//   - visibility/focus refresh 안전망

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, useAuth } from '../contexts/AuthContext';
import { onSocket } from '../services/socket';

export interface NotificationItem {
  id: number;
  user_id: number;
  business_id: number | null;
  event_kind: string;
  title: string;
  body: string | null;
  link: string | null;
  cta_label: string | null;
  actor_user_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  read_at: string | null;
  created_at: string;
  actor?: { id: number; name: string; name_localized?: string | null } | null;
}

// 미읽음 카운트 — 사이드바 종 모양 badge + OS 앱 아이콘 배지 공용.
//
// ★ `loaded` 를 같이 돌려준다. 앱 아이콘 배지는 **0 을 두 가지로 구분해야** 하기 때문이다.
//   "아직 안 불러왔다(0)" 에서 배지를 지우면 푸시가 세워 둔 숫자가 앱을 열자마자 사라지고,
//   "불러왔더니 0 이다" 에서 안 지우면 다 읽었는데 숫자가 남는다. 값으로 추측하지 않는다.
export function useNotificationCountState(): { count: number; loaded: boolean } {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) { setCount(0); setLoaded(false); return; }
    let cancelled = false;

    const refresh = async () => {
      try {
        const r = await apiFetch('/api/notifications/unread-count');
        const j = await r.json();
        if (!cancelled && j.success) { setCount(Number(j.data?.count) || 0); setLoaded(true); }
      // 실패는 0 건이 아니다 — loaded 를 세우지 않아야 배지가 제 값을 잃지 않는다.
      } catch { /* silent */ }
    };
    refresh();

    // visibility/focus 안전망
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', refresh);
    // 같은 탭 안 'notification:refresh' window event (페이지/dropdown 에서 read 액션 시)
    const onLocal = () => refresh();
    window.addEventListener('notification:refresh', onLocal);

    // 공유 소켓 (services/socket) — multi-device 동기화. notification:* 는 user room 자동 join.
    const offNew = onSocket('notification:new', () => refresh());
    const offRead = onSocket('notification:read', () => refresh());
    const offReadAll = onSocket('notification:read-all', () => { setCount(0); setLoaded(true); });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('notification:refresh', onLocal);
      offNew(); offRead(); offReadAll();
    };
  }, [user?.id]);

  return { count, loaded };
}

/** 숫자만 필요한 곳(헤더 종 아이콘) 용 얇은 래퍼. */
export function useNotificationCount(): number {
  return useNotificationCountState().count;
}


// 알림 list (dropdown / 페이지 공용)
interface UseNotificationsOptions {
  limit?: number;
  unreadOnly?: boolean;
  autoRefresh?: boolean;  // socket listener — dropdown/페이지 open 시 true
}
export function useNotifications(opts: UseNotificationsOptions = {}) {
  const { limit = 20, unreadOnly = false, autoRefresh = true } = opts;
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (unreadOnly) qs.set('unread_only', 'true');
      const r = await apiFetch(`/api/notifications?${qs}`);
      const j = await r.json();
      if (j.success) setItems(j.data || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [user, limit, unreadOnly]);

  useEffect(() => {
    if (!user) { setItems([]); return; }
    refresh();
    if (!autoRefresh) return;

    const onLocal = () => refresh();
    window.addEventListener('notification:refresh', onLocal);

    // 공유 소켓 (services/socket) — notification:* 는 user room 자동 join.
    const offNew = onSocket('notification:new', () => refresh());
    const offRead = onSocket('notification:read', () => refresh());
    const offReadAll = onSocket('notification:read-all', () => setItems(prev => prev.map(it => ({ ...it, read_at: it.read_at || new Date().toISOString() }))));

    return () => {
      window.removeEventListener('notification:refresh', onLocal);
      offNew(); offRead(); offReadAll();
    };
  }, [user?.id, autoRefresh, refresh]);

  const markRead = useCallback(async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setItems(prev => prev.map(it => it.id === id ? { ...it, read_at: new Date().toISOString() } : it));
      window.dispatchEvent(new CustomEvent('notification:refresh'));
    } catch { /* silent */ }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      setItems(prev => prev.map(it => ({ ...it, read_at: it.read_at || new Date().toISOString() })));
      window.dispatchEvent(new CustomEvent('notification:refresh'));
    } catch { /* silent */ }
  }, []);

  return { items, loading, refresh, markRead, markAllRead };
}
