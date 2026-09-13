// optionList — 팝오버 안의 **선택 목록** 한 벌 (이름 + 설명 한 줄짜리 옵션 버튼)
//
// ★ 2026-09-13 — Q sale 단계 칩이 전체 프로필(SaleDetailPage)과 우측 패널(ClientPanel) 두 곳에서
//   같은 목록을 그린다. 각자 styled 를 선언하면 반드시 갈라진다(CLAUDE.md "새로 만들지 않는다").
//   여기가 그 한 벌이다 — 새로 쓰는 팝오버 목록도 이것을 가져다 쓴다.
//
// ★ ChipPopover 안에서 쓴다. 그 컴포넌트에 PlanQSelect 를 넣지 않는 이유(포털된 옵션이 바깥클릭으로
//   판정돼 선택 전에 닫힌다)와 같은 맥락 — 목록 버튼으로 직접 그린다.
import styled from 'styled-components';

export const OptionList = styled.div`display: flex; flex-direction: column; gap: 2px;`;

export const OptionBtn = styled.button<{ $on: boolean }>`
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')};
  border: 1px solid ${(p) => (p.$on ? '#5EEAD4' : 'transparent')};
  &:hover { background: #F8FAFC; }
`;

export const OptName = styled.span`font-size: 0.8125rem; font-weight: 600; color: #0F172A;`;
export const OptHint = styled.span`font-size: 0.6875rem; color: #94A3B8;`;
