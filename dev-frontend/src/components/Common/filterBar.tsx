// 검색 + 필터 한 줄. (2026-09-14)
//
// ★ 2026-09-14 2차 (Irene: *"단계 · 접근 · 담당자는 셀렉트 박스 안에서 고르게 해줘.
//   항목명으로 필요 없고 전체가 필요없는 거야."* · *"종료 가리기는 기존대로 체크박스로."*)
//
//   오전에는 축 이름을 셀렉트 **밖에** 라벨로 붙였다. 그러면 한 줄에 글자가 두 배로 들어차고
//   상자가 좁아진다. 지금 계약은 **축 이름이 셀렉트의 첫 옵션 라벨**이다:
//     · 고르기 전 → 상자에 "단계"·"접근"·"담당자" 가 보인다 (무슨 축인지 안다)
//     · 고른 뒤   → 고른 값이 보인다
//     · 되돌릴 때 → 첫 옵션(축 이름)을 다시 고른다 = 필터 해제
//   "전체" 라는 낱말을 쓰지 않으면서 **전체로 돌아갈 길은 그대로 있다**. 필터를 걸어 놓고
//   빠져나올 수 없는 상태를 만들지 않는다 — 그것이 옛 규칙(memory `feedback_filter_all_option_mandatory`)
//   의 요지였고, 그 요지는 여기서도 지켜진다. 바뀐 것은 **라벨뿐**이다.
//   → `axisOption(label)` 로 첫 옵션을 만든다. 손으로 `{value:'',label:'전체'}` 를 쓰지 않는다.
//
// 반응형 — 한 줄에 다 못 담으면 **줄이 바뀐다**(가로 스크롤로 숨기지 않는다).
//   Irene: *"열이 제한되게 해서 해당 열이 되면 엔터값들어가게."*
import React from 'react';
import styled from 'styled-components';

export const FilterBar = styled.div`
  display: flex; align-items: center; flex-wrap: wrap;
  /* 줄이 바뀌어도 간격이 같게 — column/row 를 따로 준다 */
  column-gap: 8px; row-gap: 8px;
  /* ★ 위 여백 (Irene 2026-09-14: *"필터줄이 위에 너무 들러붙었어."*)
     바로 위 블록(Cue 바·탭)과 붙어 있으면 같은 덩어리로 읽힌다. */
  margin-top: 14px; margin-bottom: 10px;
  /* ★ 한 줄 안의 모든 컨트롤은 **같은 높이 36px** 이다 (Irene 2026-09-14:
     *"검색이랑 필터가 같은 열이 되게 정돈 좀 제대로 좀 해줘."*)
     PlanQSelect size="sm" 가 36, 검색칸 36, 토글 36, 체크박스 줄 36 —
     하나라도 다르면 줄이 들쭉날쭉해진다. */
`;

/** 검색칸 — 줄의 **맨 앞**이다(2026-09-14, Irene: *"검색창 … 필터들 맨 앞에 둬. 단계 셀렉트 앞에."*).
 *  자라지 않는다 — `flex-grow:1` 이면 검색이 남는 자리를 다 먹어 셀렉트들이 줄 오른쪽 끝으로
 *  밀려난다(같은 줄인데 두 덩어리로 보인다). 프로젝트 목록의 검색칸과 같은 240px. */
export const FilterSearchSlot = styled.div`
  flex: 0 1 240px; min-width: 160px;
  display: flex; align-items: center;
  > * { width: 100%; }
  /* 폰 — [필터] 버튼과 한 줄에 서서 남는 폭을 다 쓴다(#447). */
  @media (max-width: 640px) { flex: 1 1 0; min-width: 0; }
`;

/** 여기서부터 **오른쪽 끝**에 붙는다. 감싸서 쓴다 — 빈 칸막이(spacer)로 밀면
 *  줄이 바뀔 때 버튼이 **새 줄의 왼쪽**으로 떨어진다(1024px 실측: left 20). `margin-left:auto`
 *  는 줄이 바뀌어도 그 줄의 오른쪽 끝을 지킨다. (Irene: *"모든 버튼은 우측정렬 하되
 *  열이 제한되게 해서 해당 열이 되면 엔터값들어가게."*) */
export const FilterRight = styled.div`
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0;
`;

const Control = styled.div<{ $w: number }>`
  flex: 0 1 auto;
  width: ${p => p.$w}px; max-width: 100%; min-width: 0;
  /* 감싸는 칸이 폭을 준다 — react-select 는 폭을 직접 받지 않는다 */
`;

/** 셀렉트 한 칸. 축 이름은 **안**에 있다(첫 옵션 = `axisOption`). */
export const FilterSlot: React.FC<{
  width?: number;
  testId?: string;
  children: React.ReactNode;
}> = ({ width = 140, testId, children }) => (
  <Control $w={width} data-testid={testId}>{children}</Control>
);

/**
 * 셀렉트의 **첫 옵션** — 값은 비어 있고(=필터 없음) 라벨은 축 이름이다.
 * 이 한 함수로만 만든다. 화면마다 손으로 쓰면 어디는 "전체", 어디는 축 이름이 되어 갈라진다.
 */
export const axisOption = (axisLabel: string) => ({ value: '', label: axisLabel });

/** 켜고 끄는 필터(대응 필요만처럼 참/거짓 하나). 셀렉트로 만들지 않는다. */
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

/**
 * 체크박스 필터 — **켜 둔 채로 두는 기본 설정**에 쓴다(예: 종료 가리기).
 *
 * Irene 2026-09-14: *"종료 가리기는 기존대로 체크박스."*  알약 토글과 쓰임이 다르다 —
 * 알약은 "지금 이것만 본다" 는 **일시적 좁히기**라 켜진 것이 눈에 띄어야 하고,
 * 체크박스는 "늘 이렇게 본다" 는 **설정**이라 조용해야 한다. 규격은 옛 `CheckLabel` 그대로.
 */
export const CheckFilter = styled.label`
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; white-space: nowrap;
  font-size: 0.75rem; font-weight: 600; color: #475569; cursor: pointer; user-select: none;
  input { width: 16px; height: 16px; accent-color: #0D9488; cursor: pointer; margin: 0; }
`;

/**
 * 폰에서 필터를 **접는다** (운영 #447, 2026-10-02 — Irene: *"Q sales 모바일에서 필터가 두세줄이라
 * 쓸데없이 길어. 행을 좀 줄이거나 메일처럼 접거나 안돼?"*).
 *
 * Q mail 과 같은 모양이다 — [검색][필터 N] 한 줄, 누르면 아래로 펼친다. 데스크탑·태블릿은
 * 감싸는 상자가 레이아웃에 끼어들지 않는다(`display: contents`) — 지금 한 줄 배치 그대로다.
 * ★ 접었을 때 **걸려 있는 필터 수**를 버튼에 적는다 — 안 보이면 "왜 목록이 이상하지" 가 된다(Q mail #213 과 같은 규칙).
 */
export const FilterCollapsible = styled.div<{ $open: boolean }>`
  display: contents;
  @media (max-width: 640px) {
    display: ${p => (p.$open ? 'contents' : 'none')};
  }
`;

const MoreBtn = styled.button`
  display: none;
  @media (max-width: 640px) {
    display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
    height: 36px; padding: 0 12px; border-radius: 8px; cursor: pointer;
    background: #fff; border: 1px solid #E2E8F0;
    font-family: inherit; font-size: 0.75rem; font-weight: 600; color: #475569;
    &[aria-expanded='true'] { border-color: #0F766E; color: #0F766E; }
    b {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 18px; padding: 2px 5px; line-height: 1.4; border-radius: 9px;
      background: #0F766E; color: #fff; font-size: 0.625rem; font-weight: 700;
    }
    svg { width: 13px; transition: transform .15s; }
    &[aria-expanded='true'] svg { transform: rotate(90deg); }
  }
`;

/** 폰에서만 보이는 [필터 N] 버튼. `label` 은 호출부가 t() 로 넘긴다. */
export const FilterMoreToggle: React.FC<{
  open: boolean; onToggle: () => void; activeCount: number; label: string; testId?: string;
}> = ({ open, onToggle, activeCount, label, testId }) => (
  <MoreBtn type="button" aria-expanded={open} onClick={onToggle} data-testid={testId}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
    {label}
    {activeCount > 0 && <b>{activeCount}</b>}
  </MoreBtn>
);
