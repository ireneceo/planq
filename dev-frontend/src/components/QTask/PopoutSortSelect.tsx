// 팝아웃 정렬 셀렉트 — 보기 기준 칩 줄의 맨 앞에 선다.
//
// Irene 2026-09-08: *"팝아웃에서는 셀렉트항목으로 소팅하게 해줄래? 최신등록순, 이름순,
//   업무단계순, 이렇게 넣고 기본은 최신등록순으로 하고 태그별, 프로젝트별로 표시될 때는
//   그 소항목 아래에서 이 순서로 나오게 해줘."*
//
// TaskPopoutView 가 800줄 임계(god-file 래칫)를 넘어 여기로 절출했다 —
// PopoutQuickAdd·PopoutViewChips 를 뺀 것과 같은 이유·같은 방식.
//
// ★ raw <select> 를 쓰지 않는다. 이 저장소의 셀렉트 표준은 PlanQSelect 이고
//   health-check 의 frontend 카테고리가 그것을 막는다(실제로 잡혔다).
import React from 'react';
import { useEffect, useState } from 'react';
import styled from 'styled-components';
import PlanQSelect from '../Common/PlanQSelect';
import type { PopoutSortKey } from './popoutSort';

interface Props {
  value: PopoutSortKey;
  onChange: (v: PopoutSortKey) => void;
  /** 라벨 정본은 locales/{ko,en}/qtask.json 의 popout.sort* 다 — 여기서 사전을 또 만들지 않는다. */
  labels: Record<PopoutSortKey, string>;
  ariaLabel: string;
}

// 저장 키 — 정렬은 보기 기준과 **다른 축**이라 따로 기억한다
//   (태그별로 보면서 이름순 같은 조합이 성립한다). 탭(오늘/이번 주)마다 따로.
const SORT_KEY = (tab: string) => `planq.popout.sort.${tab}`;
function readSort(tab: string): PopoutSortKey {
  try {
    const v = localStorage.getItem(SORT_KEY(tab));
    if (v === 'name' || v === 'stage' || v === 'recent') return v;
  } catch { /* ignore */ }
  return 'recent';   // 기본 = 최신등록순 (Irene 지정)
}

/** 탭별로 기억되는 정렬 상태. 화면은 값과 setter 만 쓴다. */
export function usePopoutSort(tab: string) {
  const [sortKey, setSortKey] = useState<PopoutSortKey>(() => readSort(tab));
  useEffect(() => { setSortKey(readSort(tab)); }, [tab]);
  useEffect(() => { try { localStorage.setItem(SORT_KEY(tab), sortKey); } catch { /* ignore */ } }, [tab, sortKey]);
  return { sortKey, setSortKey };
}

const PopoutSortSelect: React.FC<Props> = ({ value, onChange, labels, ariaLabel }) => (
  <Wrap data-testid="task-popout-sort">
    <PlanQSelect
      size="sm"
      aria-label={ariaLabel}
      value={{ value, label: labels[value] }}
      onChange={(v) => {
        const next = (v as { value?: string } | null)?.value;
        if (next === 'recent' || next === 'name' || next === 'stage') onChange(next);
      }}
      options={[
        { value: 'recent', label: labels.recent },
        { value: 'name', label: labels.name },
        { value: 'stage', label: labels.stage },
      ]}
    />
  </Wrap>
);

// 칩과 같은 줄에 서므로 폭만 잡아 준다(높이는 PlanQSelect size='sm' 이 정한다).
const Wrap = styled.div`min-width: 132px;`;

export default PopoutSortSelect;
