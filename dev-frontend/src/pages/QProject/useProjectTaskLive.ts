// 프로젝트 목록 화면 — 업무 신호가 오면 **그 프로젝트의 업무만** 다시 읽는다 (2026-11-03).
//
// ★ 왜 따로: 목록의 load() 는 프로젝트마다 /api/projects/:id/tasks 를 읽는다(ws 6 = 100 프로젝트 → 요청 101개).
//   업무 신호(task:new·updated·deleted)마다 load() 를 부르면 바쁜 워크스페이스에서 사용자당 한도(600/분)를 넘겨
//   429 가 쏟아지고 마지막 변경이 오히려 안 보였다(Fable 검증 실측: 업데이트 8번 → 요청 311 · 429 52건).
//   그래서 신호에 실린 project_id + 지금 그 업무를 들고 있는 프로젝트(다른 프로젝트로 옮겨 간 경우)만 다시 읽는다.
// ★ 프로젝트 자체 신호(project:new·updated)는 화면이 useLiveReload 로 load() 에 묶는다 — 드물다.
import { useEffect, useRef } from 'react';
import { apiFetch } from '../../contexts/AuthContext';
import { onSocket } from '../../services/socket';
import { writeCache } from '../../lib/pageCache';

const TASK_EVENTS = ['task:new', 'task:updated', 'task:deleted'] as const;

export function useProjectTaskLive<T extends { id: number }>(
  bizId: number | null,
  tasksByProject: Record<number, T[]>,
  setTasksByProject: (fn: (prev: Record<number, T[]>) => Record<number, T[]>) => void,
  cacheKeyTasks: string,
): void {
  const mapRef = useRef(tasksByProject);
  mapRef.current = tasksByProject;

  useEffect(() => {
    if (!bizId) return;
    const pending = new Set<number>();
    let timer: number | null = null;
    let alive = true;
    const flush = async () => {
      timer = null;
      const ids = [...pending];
      pending.clear();
      const fresh = await Promise.all(ids.map(async (pid) => {
        try {
          const j = await (await apiFetch(`/api/projects/${pid}/tasks`)).json();
          return j?.success ? [pid, j.data as T[]] as const : null;   // 실패면 그 프로젝트는 보던 그대로 둔다
        } catch { return null; }
      }));
      if (!alive) return;
      setTasksByProject((prev) => {
        const next = { ...prev };
        for (const f of fresh) if (f) next[f[0]] = f[1];
        writeCache(cacheKeyTasks, next);
        return next;
      });
    };
    const onTask = (d: { id?: number; project_id?: number | null; business_id?: number } | null) => {
      if (!d) return;
      if (d.business_id != null && Number(d.business_id) !== Number(bizId)) return;
      const map = mapRef.current;
      // 목록에 있는 프로젝트만 — 모르는 프로젝트(새로 생김)는 project:new 가 전체를 다시 읽는다
      if (d.project_id != null && map[Number(d.project_id)] !== undefined) pending.add(Number(d.project_id));
      if (d.id != null) {
        for (const [pid, rows] of Object.entries(map)) {
          if (rows.some((t) => t.id === d.id)) pending.add(Number(pid));   // 옮겨 간 업무의 옛 프로젝트
        }
      }
      if (pending.size && timer == null) timer = window.setTimeout(() => { void flush(); }, 800);
    };
    const offs = TASK_EVENTS.map((ev) => onSocket(ev, onTask));
    return () => { alive = false; if (timer != null) window.clearTimeout(timer); offs.forEach((off) => off()); };
  }, [bizId, setTasksByProject, cacheKeyTasks]);
}
