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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../contexts/AuthContext';

interface FocusSession {
  id: number;
  task_id: number | null;
  state: string;
  started_at?: string;
}

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

  const runningMinutes = useMemo(() => {
    if (!session || session.state !== 'active' || !session.started_at) return 0;
    void tick;
    return Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60000));
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

  return { enabled, runningTaskId, runningMinutes, busyTaskId, toggle, canFocus, reload };
}

export default useFocusControl;
