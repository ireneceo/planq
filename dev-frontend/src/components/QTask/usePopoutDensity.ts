// 팝아웃 보기 밀도 — 카드(기본) / 촘촘히(한 줄). 오늘·이번 주 **두 탭 공통**으로 기억한다
//   (Irene 2026-10-12: "다른 탭도 같이 보기방식 추가"). 보기 기준·정렬과는 다른 축이라 따로 둔다.
//   TaskPopoutView 가 god-file 임계(800줄) 근처라 절출(PopoutSortSelect 의 usePopoutSort 와 같은 방식).
import { useEffect, useState } from 'react';

const KEY = 'planq:taskPopout:density';

export function usePopoutDensity() {
  const [compact, setCompact] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === 'compact'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem(KEY, compact ? 'compact' : 'card'); } catch { /* ignore */ } }, [compact]);
  return { compact, toggleCompact: () => setCompact((v) => !v) };
}

/** 촘촘히 보기에서도 글자로 남기는 상태 — "내가 처리할 차례" 라 점 하나로는 놓친다. 나머지는 색 점. */
export const COMPACT_TEXT_CODES = new Set(['task_requested', 'revision_requested', 'reviewing', 'done_feedback']);
