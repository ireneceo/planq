// 오늘의 출퇴근 상태 — 사이드바 위젯·모바일 카드·근태 페이지가 **같은 한 벌**을 쓴다 (#208).
//
// 세 표면이 각자 fetch 하면 한 곳에서 출근을 눌렀을 때 나머지가 옛 상태로 남는다.
// 그래서 액션 후 window CustomEvent 로 같은 탭의 다른 표면을 깨우고(§10 (e)),
// socket 으로 다른 기기·다른 사람의 변경을 받고(§10 (b)(c)), 복귀 시 다시 읽는다(§10 (d)).
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';
import { joinRoom, leaveRoom, onSocket } from '../services/socket';
import { useVisibilityRefresh } from './useVisibilityRefresh';

export type AttendanceState = 'working' | 'on_break' | 'done' | null;

export interface AttendanceDay {
  id: number;
  user_id: number;
  work_date: string;
  state: Exclude<AttendanceState, null>;
  clock_in_at: string | null;
  clock_out_at: string | null;
  break_started_at: string | null;
  work_sec: number;
  break_sec: number;
  auto_closed: boolean;
  admin_fixed: boolean;
  note: string | null;
}

export const ATTENDANCE_REFRESH_EVENT = 'attendance:refresh';

export function useAttendance(businessId: number | null) {
  const [day, setDay] = useState<AttendanceDay | null>(null);
  const [state, setState] = useState<AttendanceState>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 초 카운터의 기준점 — 서버에서 받은 값과 그 시각. 매초 state 를 갱신하지 않고
  // 화면이 tick 마다 이 기준에서 다시 계산한다(FocusWidget 이 같은 이유로 쓰는 방식).
  const baseRef = useRef<{ work: number; brk: number; at: number } | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    try {
      const r = await apiFetch(`/api/attendance/today?business_id=${businessId}`);
      // ★ apiFetch 는 실패해도 throw 하지 않는다 — res.ok 를 직접 본다.
      if (!r.ok) return;
      const j = await r.json();
      if (!j.success) return;
      setDay(j.data?.day || null);
      setState(j.data?.state || null);
      baseRef.current = j.data?.day
        ? { work: j.data.day.work_sec, brk: j.data.day.break_sec, at: Date.now() }
        : null;
    } catch { /* 네트워크 끊김 — 다음 복귀·소켓 이벤트에서 다시 읽는다 */ }
    finally { setLoading(false); }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  // 다른 사람·다른 기기의 변경
  useEffect(() => {
    if (!businessId) return;
    const room = `business:${businessId}`;
    joinRoom(room);
    const off = onSocket('attendance:updated', () => { void load(); });
    return () => { off(); leaveRoom(room); };
  }, [businessId, load]);

  // 같은 탭의 다른 표면(위젯 ↔ 카드 ↔ 페이지)
  useEffect(() => {
    const h = () => { void load(); };
    window.addEventListener(ATTENDANCE_REFRESH_EVENT, h);
    return () => window.removeEventListener(ATTENDANCE_REFRESH_EVENT, h);
  }, [load]);

  useVisibilityRefresh(load);

  // 근무·휴게 중일 때만 초를 센다 — 퇴근 후에는 흐르지 않아야 한다.
  useEffect(() => {
    if (state !== 'working' && state !== 'on_break') return;
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  const act = useCallback(async (path: string) => {
    if (!businessId || submitting) return null;
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/attendance/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) return { error: j?.message || 'error' };
      setDay(j.data);
      setState(j.data.state);
      baseRef.current = { work: j.data.work_sec, brk: j.data.break_sec, at: Date.now() };
      window.dispatchEvent(new CustomEvent(ATTENDANCE_REFRESH_EVENT));
      return { ok: true };
    } catch { return { error: 'network' }; }
    finally { setSubmitting(false); }
  }, [businessId, submitting]);

  // 지금까지 몇 초 — 진행 중이면 기준점에서 흐른 만큼 더한다.
  const live = (() => {
    const b = baseRef.current;
    if (!b) return { work: 0, brk: 0 };
    const elapsed = Math.floor((Date.now() - b.at) / 1000);
    if (state === 'working') return { work: b.work + elapsed, brk: b.brk };
    if (state === 'on_break') return { work: b.work, brk: b.brk + elapsed };
    return { work: b.work, brk: b.brk };
  })();

  return {
    day, state, loading, submitting, live, reload: load,
    clockIn: () => act('clock-in'),
    breakStart: () => act('break-start'),
    breakEnd: () => act('break-end'),
    clockOut: () => act('clock-out'),
  };
}

/** 초 → "3:42" (시:분). 근태는 초 단위까지 볼 이유가 없다 — 몰입시간과 다른 점이다. */
export function formatHm(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
/** 초 → "7.5h" (통계·요약용) */
export function formatHours(sec: number): string {
  return `${Math.round((sec / 3600) * 10) / 10}h`;
}
