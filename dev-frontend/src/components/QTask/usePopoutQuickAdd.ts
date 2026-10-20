// components/QTask/usePopoutQuickAdd.ts — 팝아웃 퀵애드의 상태·생성 (2026-09-08 분리)
//
// 왜 뽑았나: TaskPopoutView 가 god-file 래칫(800줄)을 넘었다. 베이스라인을 올리는 것은
//   자를 옮기는 것이지 고치는 게 아니다 — 가드가 요구한 대로 한 덩어리를 뽑는다.
//   퀵애드는 "무엇을 고르고(보기 기준별) 무엇으로 만드는가" 하나의 이야기라 경계가 분명하다.
//
// 계약: 화면은 상태와 함수만 받아 그린다. 기본값 결정(오늘·이번 주)은 여기 있다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { listProjects } from '../../services/qtalk';
import { apiFetch } from '../../contexts/AuthContext';

export interface UsePopoutQuickAddArgs {
  bizId: number | null;
  myId: number | null;
  popTab: 'today' | 'week';
  todayStr: string;
  weekStart: string | null;
  viewMode: string;
  silentLoad: () => Promise<void> | void;
  /** 만든 직후(목록 갱신 전) — 내 순서 맨 위로 붙인다(설계 docs/TASK_USER_ORDER_DESIGN.md §8). */
  /** recentIds = 이 칸에서 방금 만든 앞 업무들(최신 먼저) — 화면 목록에 아직 없을 수 있다. */
  onCreated?: (newId: number, recentIds: number[]) => Promise<void> | void;
}

export function usePopoutQuickAdd({
  bizId, myId, popTab, todayStr, weekStart, viewMode, silentLoad, onCreated,
}: UsePopoutQuickAddArgs) {
  const [quickPick, setQuickPick] = useState('');
  // ★ 마감일별 보기의 날짜 칸. **quickAdd 보다 위에** 둔다 — 아래에 두면 useCallback 의
  //   의존성 배열이 렌더 시점에 이 값을 읽어 TDZ ReferenceError 가 난다.
  const [quickDue, setQuickDue] = useState('');
  // 기간(시작~마감) — 마감일별 보기에서 Q task 와 같은 캘린더로 고른다.
  const [quickStart, setQuickStart] = useState('');
  // 워크스페이스 프로젝트 사전 — 퀵애드 선택지의 정본.
  //   Irene: "프로젝트 선택에 왜 모든 프로젝트가 안나와? 스크롤되면서 다 나와야지."
  //   태그와 같은 사고였다: 선택지를 **지금 목록에 등장한** 프로젝트에서만 모았다.
  //   목록은 '오늘/이번 주 내 업무' 라 일부만 나온다(dev 실측: 워크스페이스 8개 중 목록엔 1개).
  const [projectDict, setProjectDict] = useState<Array<{ id: number; name: string }>>([]);
  useEffect(() => {
    if (!bizId) return;
    let alive = true;
    listProjects(bizId)
      .then((rows) => { if (alive) setProjectDict(rows.map((pj) => ({ id: pj.id, name: pj.name }))); })
      .catch(() => { /* 선택지가 없어도 화면은 살아 있어야 한다 */ });
    return () => { alive = false; };
  }, [bizId]);


  // 뒤에서 잇는 일(태그·맨 위로·갱신)은 **한 줄로 세운다** — 빠르게 연달아 치면 «맨 위로» 가 앞 줄보다 먼저 닿아
  //   순서가 뒤집힐 수 있다. 만들기 자체는 줄 세우지 않는다(그게 기다림의 원인이었다).
  const tailRef = useRef<Promise<unknown>>(Promise.resolve());
  // 빠르게 연달아 친 앞 줄은 화면 목록(tasks)에 아직 없다 — 그 목록으로 «맨 위로» 를 보내면 앞 줄을 모른 채
  //   같은 자리를 받아 새 것이 아래로 갔다(2026-10-21 실측 pos 동일). 방금 만든 것을 2분간 기억해 같이 싣는다.
  const recentRef = useRef<Array<{ id: number; at: number }>>([]);
  const quickAdd = useCallback(async (title: string): Promise<boolean> => {
    if (!bizId || !myId || myId <= 0) return false;   // 담당자는 언제나 나 — 나를 모르면 만들지 않는다(서버 체인이 남을 고른다)
    // 이번 주 탭인데 아직 weekStart 를 못 받았으면 만들지 않는다 —
    //   null 로 보내면 주간 술어를 못 넘겨 방금 만든 업무가 화면에서 사라진다.
    if (popTab === 'week' && !weekStart) return false;
    const quickDueEff = (viewMode === 'due' && quickDue) ? quickDue : todayStr;
    // 시작일은 고른 경우에만 보낸다 — 안 고르면 종전대로 마감일만 있는 업무다.
    const quickStartEff = (viewMode === 'due' && quickStart) ? quickStart : undefined;
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: bizId,
          title,
          assignee_id: myId,                                   // 이 팝아웃은 내 업무 목록이다
          //   ★ 이번 주 탭에도 마감일을 넣는다(Irene) — 주차 버킷만 있고 날짜가 없으면
          //     "기간" 칸이 빈 채로 태어나 목록·정렬·지연 판정이 전부 이 업무를 비껴간다.
          //     주간 술어는 planned_week_start 로, 오늘 술어는 due_date 로 각각 통과한다.
          //   마감일별로 보고 있으면 **고른 날짜**가 마감이다(안 골랐으면 종전대로 오늘).
          //   주차 버킷(planned_week_start)은 그대로 둔다 — 날짜를 바꿔도 이번 주 탭에서 사라지지 않게.
          ...(popTab === 'today'
            ? { due_date: quickDueEff, planned_week_start: weekStart || undefined }
            : { due_date: quickDueEff, planned_week_start: weekStart }),
          ...(quickStartEff ? { start_date: quickStartEff } : {}),
          // #309 — 프로젝트별로 보고 있으면 그 프로젝트로 바로 만든다.
          ...(viewMode === 'project' && quickPick ? { project_id: Number(quickPick) } : {}),
        }),
      });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!res.ok) return false;
      const json = await res.json();
      if (!json.success) return false;
      // 업무는 만들어졌다 — 여기서 true 를 돌려 입력 칸을 바로 비운다(PopoutQuickAdd 2026-10-21 주석).
      //   태그·순서·목록 갱신은 **뒤에서** 잇는다. 예전엔 셋을 다 기다린 뒤에야 칸이 비었다.
      //   순서는 그대로다: 태그 → 맨 위로(placeOnTop) → 서버 fresh 로 덮어쓰기(부분 merge 금지).
      const newId = json.data?.id;
      const tagId = viewMode === 'tag' && quickPick ? Number(quickPick) : null;
      tailRef.current = tailRef.current.then(async () => {
        // #309 — 태그는 생성 API 가 안 받는다. 전용 경로로 이어 붙인다(QTaskPage 와 같은 계약).
        //   ★ 태그 부여가 실패해도 업무는 이미 만들어졌다 — 되돌리지 않고 목록만 갱신한다.
        if (tagId && newId) {
          try {
            const tagRes = await apiFetch(`/api/tasks/${newId}/tags`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tag_ids: [tagId] }),
            });
            if (!tagRes.ok) console.warn('[popout quickadd tags] HTTP', tagRes.status);
          } catch (err) { console.warn('[popout quickadd tags]', err); }
        }
        const now = Date.now();
        const recent = recentRef.current.filter((r) => now - r.at < 120000).map((r) => r.id);
        if (newId) recentRef.current = [{ id: Number(newId), at: now }, ...recentRef.current.filter((r) => now - r.at < 120000)].slice(0, 20);
        try { if (newId && onCreated) await onCreated(Number(newId), recent); } catch { /* 순서만 못 붙었다 */ }
        await silentLoad();
      }).catch(() => { /* 갱신 실패는 다음 갱신이 메운다 */ });
      return true;
    } catch {
      return false;
    }
  }, [bizId, myId, popTab, todayStr, weekStart, silentLoad, onCreated, viewMode, quickPick, quickDue, quickStart]);
  return { quickPick, setQuickPick, quickDue, setQuickDue, quickStart, setQuickStart, quickAdd, projectDict };
}
