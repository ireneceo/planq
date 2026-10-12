// hooks/useFromActionHandoff.ts — 업무 «결과물 액션» 에서 넘어온 화면(문서·일정)이 **한 벌로** 읽는 것 (2026-10-12)
//   설계 docs/TASK_ACTIONS_DESIGN.md §4.2 — 들어오는 주소는 화면마다 같다: `?from_action=<id>`.
//   ① 주소에서 id 를 읽고 ② GET /api/task-actions/:id/handoff 를 읽어 ③ 화면에 넘기고 ④ 주소에서 즉시 지운다
//   (새로고침·뒤로가기로 두 번 만들지 않게 — ?prefill= 과 같은 규칙). 네 화면이 베끼지 않게 여기 한 곳.
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../contexts/AuthContext';

export interface FromActionHandoff {
  action: { id: number; kind: 'doc' | 'event' | 'mail' | 'project'; label: string; note: string | null; meta: Record<string, unknown> | null; status: string };
  task: { id: number; title: string; due_date: string | null; start_date: string | null; project_id: number | null; business_id: number };
  can_perform: boolean;
  reason: 'not_assignee' | 'no_assignee' | 'not_pending' | 'kind_disabled' | null;
}

/**
 * @param enabled  얹힌 화면(프로젝트 탭 등)에서는 끈다 — 그 주소는 주인의 것이다.
 * @param onHandoff 읽은 넘겨받기(실패하면 호출하지 않는다 — 남의 id·지운 액션은 그냥 보통 화면이다).
 * @param extraKeys 같이 지울 주소 인자(예: 일정의 `new`).
 */
export function useFromActionHandoff(enabled: boolean, onHandoff: (h: FromActionHandoff) => void, extraKeys: string[] = []) {
  const [sp, setSp] = useSearchParams();
  const cbRef = useRef(onHandoff);
  cbRef.current = onHandoff;
  // ★ 주소를 지우면 raw 가 null 로 바뀌어 이 효과가 다시 돈다 — 그 정리 함수로 응답을 버리면 안 된다
  //   (그러면 주소만 지워지고 화면은 아무 일도 안 한다 — 카나리가 잡았다). 그래서 «언마운트» 만 따로 본다.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const raw = enabled ? sp.get('from_action') : null;
  useEffect(() => {
    if (!raw) return;
    const id = Number(raw);
    const next = new URLSearchParams(sp);
    next.delete('from_action');
    for (const k of extraKeys) next.delete(k);
    setSp(next, { replace: true });
    if (!Number.isInteger(id) || id <= 0) return;
    void (async () => {
      try {
        const r = await apiFetch(`/api/task-actions/${id}/handoff`);
        const j = await r.json().catch(() => null);
        if (mountedRef.current && r.ok && j?.success) cbRef.current(j.data as FromActionHandoff);
      } catch { /* 넘겨받기 실패 = 보통 화면 */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
}
