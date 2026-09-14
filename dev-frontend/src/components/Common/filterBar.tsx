// 검색 + 필터 한 줄. (2026-09-14)
//
// Irene: *"전체 전체 전체 이렇게 나오게 하지 말고 무슨 필터인지 알게 하고 검색 옆에 배치해.
//          이거 전에도 요청했는데 왜 안해?"*
//
// 무엇이 문제였나 — 필터를 셀렉트만 나란히 세우면 고르기 전에는 전부 "전체" 라,
//   **무슨 축인지 알 수 없는 상자 세 개**가 된다. 축 이름을 셀렉트 **안이 아니라 옆**에 붙인다.
//   (안에 넣으면 값을 고르는 순간 축 이름이 사라진다 — 고른 뒤에도 무엇을 고른 축인지 보여야 한다.)
//
// 반응형 — 한 줄에 다 못 담으면 **줄이 바뀐다**(가로 스크롤로 숨기지 않는다).
//   Irene: *"열이 제한되게 해서 해당 열이 되면 엔터값들어가게."*
import React from 'react';
import styled from 'styled-components';

export const FilterBar = styled.div`
  display: flex; align-items: center; flex-wrap: wrap;
  /* 줄이 바뀌어도 간격이 같게 — column/row 를 따로 준다 */
  column-gap: 8px; row-gap: 8px;
  margin-bottom: 10px;
  /* ★ 한 줄 안의 모든 컨트롤은 **같은 높이 36px** 이다 (Irene 2026-09-14:
     *"검색이랑 필터가 같은 열이 되게 정돈 좀 제대로 좀 해줘."*)
     PlanQSelect size="sm" 가 36, 검색칸 36, 토글 36 — 하나라도 다르면 줄이 들쭉날쭉해진다. */
`;

/** 검색칸 — 남는 자리를 먹되, 좁아지면 제 줄을 차지한다. */
export const FilterSearchSlot = styled.div`
  flex: 1 1 240px; min-width: 180px;
  display: flex; align-items: center;
  > * { width: 100%; }
`;

/** 여기서부터 **오른쪽 끝**에 붙는다. 감싸서 쓴다 — 빈 칸막이(spacer)로 밀면
 *  줄이 바뀔 때 버튼이 **새 줄의 왼쪽**으로 떨어진다(1024px 실측: left 20). `margin-left:auto`
 *  는 줄이 바뀌어도 그 줄의 오른쪽 끝을 지킨다. (Irene: *"모든 버튼은 우측정렬 하되
 *  열이 제한되게 해서 해당 열이 되면 엔터값들어가게."*) */
export const FilterRight = styled.div`
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
`;

const Group = styled.div<{ $w?: number }>`
  display: inline-flex; align-items: center; gap: 6px;
  flex: 0 1 auto; min-width: 0;
`;
const Label = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #64748B; white-space: nowrap; flex-shrink: 0;
`;
const Control = styled.div<{ $w: number }>`
  width: ${p => p.$w}px; max-width: 100%; min-width: 0;
  /* 감싸는 칸이 폭을 준다 — react-select 는 폭을 직접 받지 않는다 */
`;

/** 축 이름이 **밖에 붙은** 필터 한 칸. */
export const LabeledFilter: React.FC<{
  label: string;
  width?: number;
  testId?: string;
  children: React.ReactNode;
}> = ({ label, width = 140, testId, children }) => (
  <Group data-testid={testId}>
    <Label>{label}</Label>
    <Control $w={width}>{children}</Control>
  </Group>
);

/** 켜고 끄는 필터(대응 필요만·종료 가리기처럼 참/거짓 하나). 셀렉트로 만들지 않는다. */
export const ToggleFilter = styled.button<{ $on: boolean; $accent?: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 12px; border-radius: 999px; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; white-space: nowrap;
  border: 1px solid ${p => (p.$on ? (p.$accent ? '#F43F5E' : '#0F766E') : '#E2E8F0')};
  color: ${p => (p.$on ? '#fff' : '#475569')};
  background: ${p => (p.$on ? (p.$accent ? '#F43F5E' : '#0F766E') : '#fff')};
  &:hover { border-color: ${p => (p.$on ? 'inherit' : '#CBD5E1')}; }
  b { font-weight: 700; }
`;
