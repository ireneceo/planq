// 사이드바 Q Talk 뱃지 + OS app icon — **전 워크스페이스 합산** unread.
//
// 사이클 N+72-6 (2026-05-26) — 사용자 호소 박제:
//   "알림 표시들이 시시간으로 다 통일된 숫자로 바로 바로 반영이 안되는 불안정한 상황"
//   "실시간 반영 필수"
//   "데스크탑/모바일 앱 아이콘에 표시되는 숫자 = 모든 워크스페이스 합산"
//
// 단일 source of truth:
//   - GET /api/conversations/me/unread-total-all → { total, by_business }
//   - 모든 표시 위치 (사이드바·OS icon·워크스페이스 selector) 가 같은 endpoint
//
// 갱신 트리거 (어디서든 즉시 반영):
//   - 마운트 1회 + window 'focus' + 'visibilitychange' (모바일 PWA 보강)
//   - Socket.IO 'message:new' (옵티미스틱 +1 + 50ms debounce refetch)
//   - Socket.IO 'inbox:refresh'
//   - custom event 'planq:unread-changed' (legacy)
//
// businessId 인자는 호환성 유지용 (옛 호출처) — 실제 fetch 는 전 워크스페이스.
import { useEffect, useState, useRef } from 'react';
import { useAuth, apiFetch } from '../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../services/socket';

export type UnreadByBusiness = Record<number, number>;
type AllResponse = { total: number; by_business: UnreadByBusiness };

// 모듈 단위 캐시 — 같은 데이터를 여러 hook 인스턴스가 공유.
//   사이드바 뱃지(useUnreadTotal) + 워크스페이스 selector(useUnreadByBusiness) 가
//   같은 socket·같은 fetch 사용. duplicate API 호출/socket connection 방지.
type Listener = (s: AllResponse) => void;
const listeners = new Set<Listener>();
let currentState: AllResponse = { total: 0, by_business: {} };
let offMessage: (() => void) | null = null;   // 공유 소켓 message:new 구독 해제
let offInbox: (() => void) | null = null;      // 공유 소켓 inbox:refresh 구독 해제
const joinedRooms = new Set<string>();         // joinRoom 중복 호출 방지 (refCount 누수 차단)
let refCount = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchAll(): Promise<AllResponse> {
  try {
    const r = await apiFetch('/api/conversations/me/unread-total-all');
    const j = await r.json();
    if (j?.success && j.data) return j.data;
  } catch { /* silent */ }
  return { total: 0, by_business: {} };
}

function broadcast(state: AllResponse) {
  currentState = state;
  listeners.forEach((fn) => fn(state));
}

// 알려진 모든 워크스페이스 business room join (client 측 defense).
//   서버가 connection 시 자동 join 하지만(근본 fix), 세션 중 새 워크스페이스가 추가되거나
//   서버 auto-join 이 누락돼도 message:new 를 받도록 이중 보장. join:business 는 멱등.
function joinKnownBusinesses() {
  Object.keys(currentState.by_business).forEach((bizId) => {
    const room = `business:${bizId}`;
    if (!joinedRooms.has(room)) { joinRoom(room); joinedRooms.add(room); }
  });
}

async function refreshAll() {
  const next = await fetchAll();
  broadcast(next);
  joinKnownBusinesses();
}

function scheduleRefresh() {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { refreshAll(); }, 50);
}

// 공유 소켓(services/socket) 구독. 재연결 시 room 재join 은 공유 소켓이 자동 처리.
function ensureSocket(userId: string | number) {
  if (offMessage) return; // 이미 구독됨
  offMessage = onSocket('message:new', (msg: { sender_id?: number }) => {
    // 옵티미스틱 +1 — 본인 발신 제외 (backend SQL 도 본인 제외)
    if (msg?.sender_id && Number(msg.sender_id) !== Number(userId)) {
      const next = { ...currentState, total: currentState.total + 1 };
      broadcast(next);
    }
    scheduleRefresh();
  });
  offInbox = onSocket('inbox:refresh', scheduleRefresh);
}

function teardownSocket() {
  if (offMessage) { offMessage(); offMessage = null; }
  if (offInbox) { offInbox(); offInbox = null; }
  joinedRooms.forEach((r) => leaveRoom(r));
  joinedRooms.clear();
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

function subscribe(userId: string | number, fn: Listener): () => void {
  listeners.add(fn);
  refCount += 1;
  if (refCount === 1) {
    ensureSocket(userId);
    refreshAll();
  } else {
    // 신규 listener 에 즉시 latest 전달
    fn(currentState);
  }
  return () => {
    listeners.delete(fn);
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) teardownSocket();
  };
}

function setupGlobalEvents(userId: string | number): () => void {
  const onChanged = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.optimisticDelta === 'number') {
      const next = { ...currentState, total: Math.max(0, currentState.total + detail.optimisticDelta) };
      broadcast(next);
    }
    refreshAll();
  };
  const onFocus = () => refreshAll();
  const onVisible = () => { if (document.visibilityState === 'visible') refreshAll(); };
  window.addEventListener('planq:unread-changed', onChanged);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  ensureSocket(userId);
  return () => {
    window.removeEventListener('planq:unread-changed', onChanged);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// businessId 인자 — 옛 호출처 호환용 (실제 fetch 는 전 워크스페이스).
//   active business 의 unread breakdown 이 필요하면 useUnreadByBusiness() 사용.
export function useUnreadTotal(_businessId?: number | null): number {
  const [count, setCount] = useState(currentState.total);
  const { user } = useAuth();
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user) { setCount(0); return; }
    const unsubscribe = subscribe(user.id, (s) => setCount(s.total));
    const cleanupEvents = setupGlobalEvents(user.id);
    cleanupRef.current = () => { unsubscribe(); cleanupEvents(); };
    return () => { cleanupRef.current?.(); cleanupRef.current = null; };
  }, [user?.id]);

  return count;
}

// 워크스페이스 selector / 워크스페이스 전환 UI 용 — biz id → unread 맵.
export function useUnreadByBusiness(): UnreadByBusiness {
  const [byBiz, setByBiz] = useState<UnreadByBusiness>(currentState.by_business);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) { setByBiz({}); return; }
    const unsubscribe = subscribe(user.id, (s) => setByBiz(s.by_business));
    const cleanupEvents = setupGlobalEvents(user.id);
    return () => { unsubscribe(); cleanupEvents(); };
  }, [user?.id]);

  return byBiz;
}
