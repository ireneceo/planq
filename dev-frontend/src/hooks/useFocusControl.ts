// 업무 시작/중지 — 목록에서 쓰는 컨트롤의 **단일 로직** (2026-09-10)
//
//   Irene: "팝아웃 Q task에 업무 시작 중지 아이콘 넣어서 적용시키면 어때?
//           굳이 상세 안들어가고 일을 알 수 있잖아."
//
// ★ 시간의 근거는 **포커스 타이머 하나**다(memory feedback_actual_hours_focus_only).
//   그래서 상세의 TaskFocusBar 와 **같은 API**(/api/focus/*)를 부른다 — 새 개념을 만들지 않는다.
// ★ "시작" 은 상태도 같이 옮긴다. 포커스만 켜면 목록에는 여전히 '대기' 로 보여
//   같은 화면이 두 가지를 말하게 된다(진행 중인데 대기).
// ★ 훅으로 뺀 이유 — 목록이 여럿(팝아웃·대시보드·주간)인데 각자 쓰면 갈라진다.
//   그리고 팝아웃 파일이 god-file 선(800줄)을 넘고 있었다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';

interface FocusSession {
  id: number;
  task_id: number | null;
  state: 'active' | 'paused';
  started_at?: string;
  /** 자리 비움으로 **자동** 멈춘 것 — 상세(TaskFocusBar)가 '자리 비움 감지' 로 따로 말하는 상태 */
  auto_paused?: boolean;
  /** 이 세션에서 실제로 흐른 초 (일시정지 구간 제외) — 서버가 계산해 준다 */
  actual_seconds?: number;
  /** 같은 업무의 **종료된** 세션 누적 초. 재개해도 0 부터가 아니다(운영 #17-2) */
  task_accumulated_seconds?: number;
}

/** 한 업무의 시간 측정 상태. **상세(TaskFocusBar)와 같은 낱말**을 쓴다 —
 *  거기서 '포커스 중 / 잠시 멈춤 / 자리 비움 감지' 로 보이는 것이 목록에서도 같은 뜻이어야 한다. */
export type FocusState = 'active' | 'paused' | 'idle';

interface TaskLike {
  id: number;
  status: string;
  assignee_id?: number | null;
}

const CLOSED = ['completed', 'canceled'];

export function useFocusControl({
  businessId, myId, onTaskChanged,
}: { businessId: number | null; myId: number; onTaskChanged?: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [session, setSession] = useState<FocusSession | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(async () => {
    try {
      const r = await apiFetch('/api/focus/current');
      const j = await r.json();
      setSession(j.success ? (j.data || null) : null);
    } catch { /* 조용히 — 시작/중지는 부가 기능이다 */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/api/focus/settings');
        const j = await r.json();
        if (!cancelled) setEnabled(j.success ? !!j.data.focus_enabled : false);
      } catch { if (!cancelled) setEnabled(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
    // 다른 창(상세·포커스 위젯)에서 시작/중지해도 여기 표시가 따라가야 한다.
    const onRefresh = () => reload();
    window.addEventListener('focus:refresh', onRefresh);
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    const id = window.setInterval(reload, 30000);
    return () => {
      window.removeEventListener('focus:refresh', onRefresh);
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
      window.clearInterval(id);
    };
  }, [enabled, reload]);

  // 경과 표시는 **분 단위**로만 센다 — 초마다 목록 전체를 다시 그릴 이유가 없다.
  useEffect(() => {
    if (!session || session.state !== 'active') return;
    const id = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, [session?.id, session?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const runningTaskId = session && session.state === 'active' ? session.task_id : null;

  /**
   * 이 업무의 시간 측정 상태 — **상세(TaskFocusBar)와 같은 판정**이어야 한다.
   *   상세는 ①세션이 이 업무 것이면 active/paused 를 그대로 쓰고
   *        ②세션이 없거나 다른 업무로 갔는데 status 가 in_progress 면 '이 업무 진행 중 — 이어서 작업' 을 낸다.
   *   목록이 이 셋을 하나로 뭉개면 **재개할 일과 시작도 안 한 일이 같은 아이콘**이 된다
   *   (Irene 2026-09-10: "재개를 하는 상황인데 아예 시작도 안한 거랑 아이콘상태가 같잖아").
   */
  const stateFor = useCallback((task: TaskLike): FocusState => {
    if (session && session.task_id === task.id) return session.state === 'active' ? 'active' : 'paused';
    return task.status === 'in_progress' ? 'paused' : 'idle';
  }, [session]);

  /** 자리 비움으로 **자동** 멈춘 것인가 — 상세가 따로 말하는 상태라 목록도 말이 달라야 한다. */
  const autoPausedFor = useCallback((task: TaskLike) => (
    !!session && session.task_id === task.id && session.state === 'paused' && !!session.auto_paused
  ), [session]);

  // 경과 기준선 — 서버가 준 실측 초를 받은 **시각**과 함께 잡아 둔다.
  //   상세(TaskFocusBar)가 쓰는 것과 같은 방식이다. `actual_seconds + tick` 으로 세면
  //   30초 폴링이 값을 갱신할 때 이중으로 더해진다(운영 #17-1).
  const baseRef = useRef<{ sec: number; at: number } | null>(null);
  useEffect(() => {
    if (!session) { baseRef.current = null; return; }
    baseRef.current = {
      sec: (session.actual_seconds || 0) + (session.task_accumulated_seconds || 0),
      at: Date.now(),
    };
  }, [session?.id, session?.state, session?.actual_seconds, session?.task_accumulated_seconds]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 이 업무에 쌓인 시간(분). **상세 카운터와 같은 값**이어야 한다 —
   *   옛 구현은 `now - started_at` 이라 **일시정지 구간까지 셌고** 이전 세션 누적은 아예 빠졌다.
   *   같은 업무를 두 화면이 다른 숫자로 말하면 둘 다 못 믿게 된다.
   */
  const minutesFor = useCallback((task: TaskLike) => {
    if (!session || session.task_id !== task.id) return 0;
    void tick;
    const base = baseRef.current;
    if (!base) return 0;
    const sec = session.state === 'active'
      ? base.sec + Math.floor((Date.now() - base.at) / 1000)
      : base.sec;
    return Math.max(0, Math.floor(sec / 60));
  }, [session, tick]);

  const toggle = useCallback(async (task: TaskLike) => {
    if (busyTaskId) return;
    setBusyTaskId(task.id);
    try {
      if (runningTaskId === task.id && session) {
        const r = await apiFetch('/api/focus/pause', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: session.id, reason: 'manual' }),
        });
        const j = await r.json();
        if (j.success) setSession(j.data || null);
      } else if (session && session.task_id === task.id && session.state === 'paused') {
        // ★ 재개는 **/resume** 이다 — 상세(TaskFocusBar.onResume)와 같은 문.
        //   여기서 /start 를 부르면 서버가 그 세션을 end_reason:'switch' 로 끊고 새 세션을 만든다
        //   (routes/focus.js POST /start). 원장에는 '전환' 으로, 감사에는 focus.start 로 남아
        //   **이어서 한 일이 다른 일로 갈아탄 것처럼** 기록된다. 화면만 같게 하고 원장을 갈라 두면
        //   나중에 시간을 되짚을 근거가 없어진다.
        const r = await apiFetch('/api/focus/resume', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: session.id }),
        });
        const j = await r.json();
        if (j.success) setSession(j.data || null);
      } else {
        const r = await apiFetch('/api/focus/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_id: task.id, business_id: businessId }),
        });
        const j = await r.json();
        if (j.success) setSession(j.data || null);
        // autosave-exempt: 시작 버튼은 **액션**이다(입력값 저장이 아니다).
        //   ✓ 배지를 붙일 입력란이 없고, 결과는 행의 상태 칩과 타이머로 즉시 보인다.
        if (j.success && (task.status === 'not_started' || task.status === 'waiting') && businessId) {
          await apiFetch(`/api/tasks/by-business/${businessId}/${task.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'in_progress' }),
          }).catch(() => null);
          onTaskChanged?.();
        }
      }
      try { window.dispatchEvent(new CustomEvent('focus:refresh')); } catch { /* noop */ }
    } catch { /* 실패는 다음 폴링이 정리한다 */ }
    finally { setBusyTaskId(null); }
  }, [busyTaskId, runningTaskId, session, businessId, onTaskChanged]);

  /** 이 업무에 시작/중지를 낼 수 있는가 — 내 업무이고, 열려 있고, 컨펌 대기가 아닐 때 */
  const canFocus = useCallback((task: TaskLike) => (
    !!enabled && task.assignee_id === myId && !CLOSED.includes(task.status) && task.status !== 'reviewing'
  ), [enabled, myId]);

  return { enabled, runningTaskId, stateFor, autoPausedFor, minutesFor, busyTaskId, toggle, canFocus, reload };
}

export default useFocusControl;
