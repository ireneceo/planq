// components/QTask/usePopoutQuickAdd.ts — 팝아웃 퀵애드의 상태·생성 (2026-09-08 분리)
//
// 왜 뽑았나: TaskPopoutView 가 god-file 래칫(800줄)을 넘었다. 베이스라인을 올리는 것은
//   자를 옮기는 것이지 고치는 게 아니다 — 가드가 요구한 대로 한 덩어리를 뽑는다.
//   퀵애드는 "무엇을 고르고(보기 기준별) 무엇으로 만드는가" 하나의 이야기라 경계가 분명하다.
//
// 계약: 화면은 상태와 함수만 받아 그린다. 기본값 결정(오늘·이번 주)은 여기 있다.
import { useCallback, useState } from 'react';
import { apiFetch } from '../../contexts/AuthContext';

export interface UsePopoutQuickAddArgs {
  bizId: number | null;
  myId: number | null;
  popTab: 'today' | 'week';
  todayStr: string;
  weekStart: string | null;
  viewMode: string;
  silentLoad: () => Promise<void> | void;
}

export function usePopoutQuickAdd({
  bizId, myId, popTab, todayStr, weekStart, viewMode, silentLoad,
}: UsePopoutQuickAddArgs) {
  const [quickPick, setQuickPick] = useState('');
  // ★ 마감일별 보기의 날짜 칸. **quickAdd 보다 위에** 둔다 — 아래에 두면 useCallback 의
  //   의존성 배열이 렌더 시점에 이 값을 읽어 TDZ ReferenceError 가 난다.
  const [quickDue, setQuickDue] = useState('');

  const quickAdd = useCallback(async (title: string): Promise<boolean> => {
    if (!bizId) return false;
    // 이번 주 탭인데 아직 weekStart 를 못 받았으면 만들지 않는다 —
    //   null 로 보내면 주간 술어를 못 넘겨 방금 만든 업무가 화면에서 사라진다.
    if (popTab === 'week' && !weekStart) return false;
    const quickDueEff = (viewMode === 'due' && quickDue) ? quickDue : todayStr;
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
          // #309 — 프로젝트별로 보고 있으면 그 프로젝트로 바로 만든다.
          ...(viewMode === 'project' && quickPick ? { project_id: Number(quickPick) } : {}),
        }),
      });
      // apiFetch 는 throw 하지 않는다 — res.ok 를 반드시 본다 (memory: apifetch_no_throw)
      if (!res.ok) return false;
      const json = await res.json();
      if (!json.success) return false;
      // #309 — 태그는 생성 API 가 안 받는다. 전용 경로로 이어 붙인다(QTaskPage 와 같은 계약).
      //   ★ 태그 부여가 실패해도 업무는 이미 만들어졌다 — 되돌리지 않고 목록만 갱신한다.
      //     (apiFetch 는 throw 하지 않으므로 res.ok 를 본다.)
      const newId = json.data?.id;
      if (viewMode === 'tag' && quickPick && newId) {
        try {
          const tagRes = await apiFetch(`/api/tasks/${newId}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: [Number(quickPick)] }),
          });
          if (!tagRes.ok) console.warn('[popout quickadd tags] HTTP', tagRes.status);
        } catch (err) { console.warn('[popout quickadd tags]', err); }
      }
      await silentLoad();     // 서버 fresh 로 덮어쓴다(부분 merge 금지)
      return true;
    } catch {
      return false;
    }
  }, [bizId, myId, popTab, todayStr, weekStart, silentLoad, viewMode, quickPick, quickDue]);
  return { quickPick, setQuickPick, quickDue, setQuickDue, quickAdd };
}
