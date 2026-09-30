// 동료의 **오늘 근무 상태**(근무중·휴게중·퇴근·미출근·휴가) — 워크스페이스 멤버끼리 (2026-09-30, 운영 #429)
//
//   Irene: "출근 표시있는 곳 근처에 직원들 출퇴근 및 상태 볼 수 없어? 그리고 아이디들에도 채팅에? 거기도 표시되서
//           업무대화에 참고하게." → 결정: 멤버 전원이 서로의 **상태만** 본다(시각·기록 없음) · 고객에게는 안 보인다.
//
//   ★ 새 API 없음 — `GET /api/attendance/presence` 가 이미 «멤버 전원 — 뱃지만» 으로 있었다.
//     고객·비멤버는 서버가 403 이고, 실시간 `attendance:updated` 는 멤버만 들어가는 business 방으로만 간다.
//   ★ 워크스페이스당 **한 저장소**를 나눠 본다 — 사이드바·채팅 이름 옆 점 여러 개가 각자 부르면
//     채팅 한 화면에서 수십 번 요청이 나간다.
//   ★ 소켓·창 리스너는 **구독자 수가 0→1 일 때 붙이고 1→0 일 때 뗀다**(모듈 수준). 첫 구독자의 effect 가
//     붙이고 그 구독자가 떠날 때 떼면, 남은 구독자는 실시간을 잃는다(초안에 있던 버그).
import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '../contexts/AuthContext';
import { onSocket, joinRoom, leaveRoom } from '../services/socket';
import { ATTENDANCE_REFRESH_EVENT } from './useAttendance';

export type PresenceState = 'working' | 'on_break' | 'done' | 'none' | 'leave';
export interface Presence { state: PresenceState }

export type PresenceStore = { map: Map<number, Presence>; loaded: boolean; forbidden: boolean };
const stores = new Map<number, PresenceStore>();
const subs = new Map<number, Set<() => void>>();
const refCount = new Map<number, number>();
const detach = new Map<number, () => void>();
const inflight = new Map<number, Promise<void>>();
const timers = new Map<number, number>();
const EMPTY: PresenceStore = { map: new Map(), loaded: false, forbidden: false };

function emit(biz: number) { (subs.get(biz) || new Set()).forEach((f) => f()); }

function toState(row: { state: string | null; on_leave_today: boolean }): PresenceState {
  // 휴가가 근무 기록보다 앞선다 — 휴가인데 실수로 출근이 찍혀도 동료에게 필요한 정보는 «오늘 휴가» 다
  if (row.on_leave_today) return 'leave';
  if (row.state === 'working' || row.state === 'on_break' || row.state === 'done') return row.state;
  return 'none';
}

async function load(biz: number): Promise<void> {
  const cur = inflight.get(biz);
  if (cur) return cur;
  const p = (async () => {
    try {
      const r = await apiFetch(`/api/attendance/presence?business_id=${biz}`);
      if (r.status === 403) { stores.set(biz, { map: new Map(), loaded: true, forbidden: true }); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success || !Array.isArray(j.data)) return; // 일시 실패 — 보던 값을 유지한다
      const map = new Map<number, Presence>();
      for (const row of j.data) map.set(Number(row.user_id), { state: toState(row) });
      stores.set(biz, { map, loaded: true, forbidden: false });
    } catch { /* 네트워크 끊김 — 다음 복귀·소켓 이벤트에서 다시 읽는다 */ }
    finally {
      inflight.delete(biz);
      emit(biz);
    }
  })();
  inflight.set(biz, p);
  return p;
}

function reloadSoon(biz: number) {
  window.clearTimeout(timers.get(biz));
  timers.set(biz, window.setTimeout(() => { void load(biz); }, 250));
}

function attach(biz: number): () => void {
  const room = `business:${biz}`;
  joinRoom(room);
  const offA = onSocket('attendance:updated', () => reloadSoon(biz));
  const offL = onSocket('leave:updated', () => reloadSoon(biz));
  const onVis = () => { if (document.visibilityState === 'visible') reloadSoon(biz); };
  const onLocal = () => reloadSoon(biz);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', onVis);
  window.addEventListener(ATTENDANCE_REFRESH_EVENT, onLocal);
  return () => {
    offA(); offL();
    leaveRoom(room);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', onVis);
    window.removeEventListener(ATTENDANCE_REFRESH_EVENT, onLocal);
    window.clearTimeout(timers.get(biz));
    timers.delete(biz);
  };
}

/** 워크스페이스 멤버들의 오늘 상태. bizId 가 없으면 빈 저장소, 고객이면 forbidden. */
export function useTeamPresence(bizId: number | null | undefined): PresenceStore {
  const biz = bizId ? Number(bizId) : 0;
  const snap = useSyncExternalStore(
    (cb) => {
      if (!biz) return () => {};
      const set = subs.get(biz) || new Set();
      set.add(cb); subs.set(biz, set);
      return () => { set.delete(cb); };
    },
    () => (biz ? stores.get(biz) || EMPTY : EMPTY),
  );

  useEffect(() => {
    if (!biz) return undefined;
    const n = (refCount.get(biz) || 0) + 1;
    refCount.set(biz, n);
    if (n === 1) {
      detach.set(biz, attach(biz));
      void load(biz); // 처음 구독할 때는 늘 새로 읽는다(떠나 있던 동안의 변화)
    } else if (!stores.get(biz)) {
      void load(biz);
    }
    return () => {
      const m = (refCount.get(biz) || 1) - 1;
      if (m <= 0) {
        refCount.delete(biz);
        detach.get(biz)?.();
        detach.delete(biz);
      } else {
        refCount.set(biz, m);
      }
    };
  }, [biz]);

  return snap;
}

/** 상태 점 색 — 사이드바 요약(SidebarStatusSummary)의 DOT 과 같은 값 + 휴가 */
export const PRESENCE_DOT: Record<PresenceState, string> = {
  working: '#5EEAD4', on_break: '#FCD34D', done: '#94A3B8', none: '#CBD5E1', leave: '#C4B5FD',
};
