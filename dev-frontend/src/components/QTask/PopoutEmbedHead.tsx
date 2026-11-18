// PopoutEmbedHead — 팝아웃 업무 목록(TaskPopoutView)을 **폰 Q task «오늘·이번 주» 탭에 얹을 때**의 머리줄 (2026-11-18)
//
//   Irene: «모바일에서 나오는 q task 화면이 팝아웃처럼 원하는 기능 행을 선택해서 가리기 가능하게 해주고
//          업무추가 입력을 바로 바로 할 수 있게 … 모바일에서도 팝아웃에서 사용하듯 같은 형태면 편할 것 같아. 오늘의 업무랑 이번주 업무.»
//   → 목록을 다시 그리지 않고 팝아웃 본체를 얹는다(.claude/rules/ui-components «본체에 scope 를 받게 하고 얹는다»).
//   팝아웃 머리(범위 제목·Q Task 열기·핀)는 Q task 화면이 이미 가진 것(탭 줄·머리)과 겹치므로 이 한 줄로 바꾼다:
//     왼쪽 = 보이는 행 수(팝아웃과 같은 숫자) + 주인이 주는 요약(이번 주 계획/가용 등)  ·  오른쪽 = 보일 칸 고르기 + 주인 버튼(AI·업무 추가).
//   보기 밀도는 Q task 머리의 폰 카드/한 줄 토글이 정한다(같은 일을 하는 버튼을 두 벌 두지 않는다).
import React from 'react';
import styled from 'styled-components';
import { phoneTouchCss } from './TaskPopoutView.styles';

export interface PopoutEmbedded {
  /** 범위 — 주인(Q task 탭)이 정한다 */
  tab: 'today' | 'week';
  /** 카드 / 한 줄 — 주인의 폰 밀도 */
  compact: boolean;
  /** 행·긴급 띠를 누르면 주인의 상세로 연다(주소 ?task= 싱크 · 재클릭 토글은 주인이 한다) */
  onOpenTask: (id: number) => void;
  /** 주인의 상세에 열린 업무 — 행 강조 */
  activeId: number | null;
  /** 머리줄 왼쪽, 숫자 뒤에 붙일 요약 칩 */
  headLeft?: React.ReactNode;
  /** 머리줄 오른쪽, 보일 칸 고르기 뒤에 붙일 버튼 */
  headRight?: React.ReactNode;
}

const PopoutEmbedHead: React.FC<{ embedded: PopoutEmbedded; count: string; menu: React.ReactNode }> = ({ embedded, count, menu }) => (
  <Bar data-testid="task-popout-embed-head">
    <Left>
      <Count data-testid="task-popout-count">{count}</Count>
      {embedded.headLeft}
    </Left>
    <Right>
      {menu}
      {embedded.headRight}
    </Right>
  </Bar>
);

export default PopoutEmbedHead;

const Bar = styled.div`
  display: flex; align-items: center; gap: 8px;
  min-height: 52px; box-sizing: border-box; padding: 8px 12px;
  background: #FFFFFF; border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
`;
// 요약이 길면(이번 주 «계획 · 가용 · 초과») 줄을 늘리지 않고 옆으로 흘린다 — 오른쪽 버튼은 늘 제자리.
const Left = styled.div`
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  overflow-x: auto; scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
  & > * { flex-shrink: 0; }
`;
const Count = styled.span`
  font-size: 0.75rem; font-weight: 600; color: #475569; white-space: nowrap;
`;
// 버튼 높이는 손대지 않는다 — 머리줄 주 액션 정본 32px(AI·업무 추가·보일 칸 고르기 모두 32, canary headerrow «세 화면 같은 버튼»).
const Right = styled.div`
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
`;

// 얹는 자리 — 남은 높이를 다 쓰고 목록은 그 안에서 굴린다. 폰 손가락 규격은 **여기서만** 덮는다
//   (팝아웃 창도 폭 520 이라 styles 에 @media 로 걸면 데스크탑 곁창까지 바뀐다).
//   · 체크·확인요청 40px — 폰 목록 행(PhoneTaskRow)과 같은 값 · 마지막 행이 우하단 대화 버튼(FAB)에 깔리지 않게 --pq-fab-clearance
//   · 바로 입력 줄: 고르는 칸(176 고정)이 폰에선 입력 칸을 100px 안팎으로 눌러 글이 안 보였다 → 고르는 칸을 34% 로 줄여 입력을 넓힌다.
export const PopoutEmbedSlot = styled.div`
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  & > * { flex: 1; min-height: 0; }
  & [data-testid='task-popout-list'] { padding-bottom: var(--pq-fab-clearance, 88px); }
  ${phoneTouchCss}
  & [data-testid='task-popout-quickadd'] > div { flex: 0 1 34%; width: auto; min-width: 0; }
`;
