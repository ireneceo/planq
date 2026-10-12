// TaskPopoutView 의 styled 정의 + 인라인 아이콘 절출 (god-file 래칫 — 컴포넌트 파일 800줄 상한).
// 주석을 깎아 가드를 통과시키지 않는다 — QMail(MailPage.styles)·ProjectTaskList 와 같은 패턴.
//   ★ 확장자가 .tsx 인 이유: 이 블록에 SVG 아이콘 컴포넌트(JSX)가 함께 있다.
import React from 'react';
import { listRowTitleCss } from '../../theme/tokens';
import styled, { keyframes } from 'styled-components';

export const Wrap = styled.div`
  display: flex; flex-direction: column;
  height: 100%; min-height: 0;
  background: #F8FAFC;
`;
// PageShell/PanelHeader 표준값과 동일 (min-height 60px · padding 14px 20px · 18px/700)
export const Head = styled.div`
  min-height: 60px; box-sizing: border-box;
  padding: 14px 20px;
  display: flex; align-items: center; gap: 10px;
  background: #FFFFFF; border-bottom: 1px solid #E2E8F0;
  flex-shrink: 0;
`;
export const HeadTitle = styled.h1`
  margin: 0; font-size: 1.125rem; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
`;
// #258 — 헤더의 "Q Task 열기". 보조 액션이라 3톤 중 Secondary 톤(테두리+무채색)으로 둔다.
export const GoMainBtn = styled.button`
  flex-shrink: 0; height: 28px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF; color: #475569;
  font-size: 0.75rem; font-weight: 600; font-family: inherit;
  cursor: pointer; white-space: nowrap;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
export const HeadRight = styled.div`
  margin-left: auto;
  display: flex; align-items: center; gap: 10px;
`;
export const HeadMeta = styled.span`
  font-size: 0.75rem; color: #64748B; white-space: nowrap;
`;
// 태그 그룹 헤더 — 태그순 모드에서 대표 태그가 바뀌는 지점 (#237 "태그별로 시각적으로")
export const TagGroupHead = styled.div<{ $color: string }>`
  display: flex; align-items: center; gap: 6px;
  margin: 8px 0 2px; padding: 2px 0 2px 8px;
  border-left: 3px solid ${p => p.$color};
  font-size: 0.6875rem; font-weight: 700; color: #64748B; letter-spacing: 0.2px;
`;
// 오늘/이번 주 세그먼트 — 팝아웃 폭(≈520px)에서 한 줄. 헤더 아래 고정.
export const TabRow = styled.div`
  /* ★ 좌우 12px — 아래 보기 칩(8px 12px 0)·목록(12px) 과 **같은 축**에 서야 한다.
     10px 이면 탭만 2px 씩 밖으로 나가 "우측으로 너무 나가버린다"(운영 #280). */
  display: flex; gap: 4px; padding: 6px 12px 0;
  flex-shrink: 0;
`;
export const TabBtn = styled.button<{ $active: boolean }>`
  flex: 1; height: 30px; padding: 0 10px;
  font-size: 0.75rem; font-weight: ${p => (p.$active ? 700 : 600)};
  color: ${p => (p.$active ? '#0F766E' : '#64748B')};
  background: ${p => (p.$active ? '#F0FDFA' : 'transparent')};
  border: 1px solid ${p => (p.$active ? '#99F6E4' : '#E2E8F0')};
  border-radius: 8px; cursor: pointer; font-family: inherit;
  &:hover { background: ${p => (p.$active ? '#CCFBF1' : '#F8FAFC')}; }
`;
export const Body = styled.div`
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 12px;
`;
export const List = styled.div`
  display: flex; flex-direction: column; gap: 8px;
`;
// ★ div 다 — 안에 체크박스 버튼이 들어가므로 button 이면 중첩이 된다.
export const Row = styled.div<{ $active: boolean; $dim: boolean }>`
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px;
  background: #FFFFFF;
  border: 1px solid ${({ $active }) => ($active ? '#0F766E' : '#E2E8F0')};
  border-radius: 10px;
  opacity: ${({ $dim }) => ($dim ? 0.6 : 1)};
  transition: border-color 0.12s, box-shadow 0.12s;
  &:hover { box-shadow: 0 2px 10px rgba(15,23,42,0.08); }
  /* 끌어 옮기기 — 끄는 행은 흐리게, 놓을 자리는 위·아래 Teal 선(카드·촘촘히 같은 표식) */
  &[data-dragging='1'] { opacity: 0.45; }
  &[data-drop='before'] { box-shadow: 0 -2px 0 0 #14B8A6; }
  &[data-drop='after'] { box-shadow: 0 2px 0 0 #14B8A6; }
`;
export const RowInner = styled.div`
  display: flex; align-items: center; gap: 6px;
`;
export const RowLead = styled.div`
  flex-shrink: 0;
`;
// 본문 클릭영역 — 드로어를 여는 버튼. 카드 테두리는 Row 가 그리므로 여기선 투명.
export const RowMain = styled.button`
  flex: 1; min-width: 0;
  text-align: left;
  display: flex; flex-direction: column; gap: 6px;
  margin: 0; padding: 0; border: 0; background: transparent;
  cursor: pointer;
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 3px; border-radius: 6px; }
`;
// 퀵액션 슬롯 — 분기가 달라도 폭·높이 동일 (터치 타겟 36, CLAUDE.md 반응형 원칙 2)
export const Slot = styled.span`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
`;
export const CheckBtn = styled.button<{ $checked?: boolean; $locked?: boolean }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: transparent;
  cursor: ${({ $locked }) => ($locked ? 'default' : 'pointer')};
  &::before {
    content: ''; position: absolute;
    width: 20px; height: 20px; border-radius: 6px;
    box-sizing: border-box;
    background: ${({ $checked }) => ($checked ? '#0F766E' : 'transparent')};
    border: 2px solid ${({ $checked }) => ($checked ? '#0F766E' : '#CBD5E1')};
    transition: border-color 0.12s, background 0.12s;
  }
  position: relative;
  ${({ $locked, $checked }) => ($locked ? `
    &::before { background: #94A3B8; border-color: #94A3B8; }
  ` : `
    &:hover::before { border-color: ${$checked ? '#0D9488' : '#0F766E'}; ${$checked ? 'background:#0D9488;' : ''} }
  `)}
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 0; border-radius: 8px; }
  &:disabled { cursor: default; opacity: 0.5; }
  > svg { position: relative; z-index: 1; }
`;
/* 시작/중지 — 팝아웃에서만 낸다 (2026-09-10 Irene: "굳이 상세 안들어가고 일을 알 수 있잖아.
   Q task에서는 리스트에 너무 많은 걸 보여주니 불필요해 보이는데 팝아웃은 있으면 좋을 것 같아").
   퀵액션 슬롯과 같은 36px 규격 — 행 높이가 달라지지 않는다.

   ★ 색은 **상세(Focus/TaskFocusBar 의 TONE)** 와 같은 값을 쓴다. 처음엔 반대로 칠해져 있었다 —
     진행 중을 호박색, 안 하는 중을 청록으로 뒀는데 상세는 정확히 그 반대다. 같은 업무를 두 화면이
     다른 색으로 말하면 색이 뜻을 잃는다. */
export const FocusBtn = styled.button<{ $tone: 'active' | 'paused' | 'idle' }>`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: transparent;
  cursor: pointer; position: relative;
  color: ${({ $tone }) => ($tone === 'active' ? '#0F766E' : $tone === 'paused' ? '#B45309' : '#64748B')};
  &::before {
    /* 장식용 링 — 36px 버튼 안쪽으로 5px 들여 그린다. (높이를 손으로 적으면 UISPEC 래칫이 오른다) */
    content: ''; position: absolute; inset: 5px; border-radius: 50%;
    box-sizing: border-box;
    border: 1px solid ${({ $tone }) => ($tone === 'active' ? '#14B8A6' : $tone === 'paused' ? '#FCD34D' : '#CBD5E1')};
    background: ${({ $tone }) => ($tone === 'active' ? '#F0FDFA' : $tone === 'paused' ? '#FFFBEB' : 'transparent')};
    transition: background 0.12s, border-color 0.12s;
  }
  &:hover:not(:disabled)::before {
    border-color: ${({ $tone }) => ($tone === 'active' ? '#0D9488' : $tone === 'paused' ? '#D97706' : '#0F766E')};
    background: ${({ $tone }) => ($tone === 'active' ? '#CCFBF1' : $tone === 'paused' ? '#FDE68A' : '#F0FDFA')};
  }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 0; border-radius: 50%; }
  &:disabled { cursor: default; opacity: 0.5; }
  > svg { position: relative; z-index: 1; }
`;
/* 시간 측정 슬롯 — 행 끝 고정 자리. **버튼이 없는 행에도 자리를 남긴다.**
   Irene 2026-09-10: "열이 안맞아서 이상해. 그냥 뒤쪽 태그추가하는 버튼 앞에 배치해."
   앞쪽(RowLead)에 조건부로 달아 두면 낼 수 있는 행과 없는 행의 제목 시작점이 달라진다 —
   PrioSlot 을 만든 이유와 같다("부여 버튼과 폭이 같아야 제목 좌측선이 안 흔들린다"). */
export const FocusSlot = styled.span`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
`;
/* 이 업무에 쌓인 시간 — **메타 줄**에 둔다. 컨트롤 옆에 두면 도는 행만 넓어져 다시 열이 어긋난다.
   숫자 하나면 충분하다(초 단위 재렌더 금지, 분만 센다). */
export const FocusTime = styled.span<{ $tone: 'active' | 'paused' }>`
  font-size: 0.6875rem; font-weight: 700;
  color: ${({ $tone }) => ($tone === 'active' ? '#0F766E' : '#B45309')};
  font-variant-numeric: tabular-nums; white-space: nowrap;
`;

export const SubmitBtn = styled.button`
  width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: transparent;
  cursor: pointer; color: #0F766E;
  &::before {
    content: ''; position: absolute;
    width: 24px; height: 24px; border-radius: 50%;
    border: 1px dashed #99F6E4; box-sizing: border-box;
    transition: background 0.12s, border-color 0.12s;
  }
  position: relative;
  &:hover::before { background: #F0FDFA; border-color: #0F766E; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 0; border-radius: 50%; }
  &:disabled { cursor: default; opacity: 0.5; }
  > svg { position: relative; z-index: 1; }
`;
export const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.75); }
`;
export const WaitDot = styled.span`
  width: 8px; height: 8px; border-radius: 50%;
  background: #94A3B8;
  animation: ${pulse} 1.4s ease-in-out infinite;
`;
export const spin = keyframes`to { transform: rotate(360deg); }`;
export const Spin = styled.span`
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid #E2E8F0; border-top-color: #0F766E;
  animation: ${spin} 0.7s linear infinite;
`;
export const RowErr = styled.div`
  margin-left: 42px;
  padding: 4px 8px; border-radius: 6px;
  background: #FEF2F2; color: #BE123C;
  font-size: 0.71875rem; font-weight: 600; line-height: 1.4;
`;
export const CheckIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6.2 L4.8 8.5 L9.5 3.6" stroke="#FFFFFF" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const SendIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M1.6 7 L12.4 2.2 L9.9 11.8 L7.2 8.4 Z" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const RowTop = styled.div`
  display: flex; align-items: flex-start; gap: 8px;
`;
// 우선순위 슬롯 — 완료/취소 행의 읽기 전용 자리. 부여 버튼과 폭이 같아야 제목 좌측선이 안 흔들린다.
// 태그 슬롯 — RowMain(button) **밖 형제**. 안에 넣으면 button-in-button 이라 HTML 상 무효이고
//   브라우저가 클릭 타깃을 임의로 접는다(위 RowMain 주석과 같은 이유 — 실제로 그렇게 넣었다가
//   팝아웃에서만 태그 버튼이 안 눌렸다, Irene 2026-08-23).
/* ★ 폭을 못 박는다 — 이 슬롯은 권한이 없는 행에서는 **비어 있다**(TaskPopoutView 참조).
   내용에 맡기면 그 행만 좁아져 행 끝 열이 어긋난다. 값은 TagQuickMenu 의 Trigger 규격과 같다. */
export const TagSlot = styled.span`
  width: 20px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  @media (max-width: 640px) { width: 32px; }
`;
export const PrioSlot = styled.span`
  width: 28px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
`;
// 우선순위 번호 — 메인 PrioNum 의 색 언어를 그대로(활성 Teal). 완료 행에서는 읽기 전용 span.
export const PrioChip = styled.span<{ $dim: boolean }>`
  flex-shrink: 0;
  width: 20px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-size: 0.6875rem; font-weight: 800; line-height: 1;
  background: ${({ $dim }) => ($dim ? '#F1F5F9' : '#14B8A6')};
  color: ${({ $dim }) => ($dim ? '#94A3B8' : '#FFFFFF')};
`;
// 우선순위 토글 버튼 — RowMain 밖 형제 버튼(button-in-button 금지). 안의 span 은 유효한 중첩이다.
//   지정됨 = Teal 원 + 번호 / 미지정 = 점선 빈 원(부여 어포던스).
export const PrioBtn = styled.button<{ $on: boolean }>`
  width: 28px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0; border: 0; background: transparent;
  cursor: pointer;
  &:disabled { cursor: default; opacity: 0.5; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; border-radius: 50%; }

  > span {
    width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 50%;
    font-size: 0.6875rem; font-weight: 800; line-height: 1;
    background: ${({ $on }) => ($on ? '#14B8A6' : 'transparent')};
    color: ${({ $on }) => ($on ? '#FFFFFF' : '#CBD5E1')};
    border: ${({ $on }) => ($on ? '0' : '1px dashed #CBD5E1')};
    transition: background 0.12s, border-color 0.12s;
  }
  &:hover:not(:disabled) > span {
    border-color: ${({ $on }) => ($on ? 'transparent' : '#14B8A6')};
    color: ${({ $on }) => ($on ? '#FFFFFF' : '#14B8A6')};
  }
`;
export const Badge = styled.span<{ $bg: string; $fg: string }>`
  flex-shrink: 0;
  padding: 2px 8px; border-radius: 999px;
  font-size: 0.6875rem; font-weight: 700;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  white-space: nowrap;
`;
export const RowTitle = styled.span`
  ${listRowTitleCss}
   font-weight: 600; color: #0F172A; line-height: 1.4;
  word-break: break-word;
`;
export const RowMeta = styled.div`
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 0.71875rem; color: #64748B;
`;
export const MetaChip = styled.span`
  padding: 1px 6px; border-radius: 6px; background: #F1F5F9; color: #475569;
`;
export const MetaDue = styled.span<{ $overdue: boolean }>`
  font-weight: ${({ $overdue }) => ($overdue ? 700 : 500)};
  color: ${({ $overdue }) => ($overdue ? '#BE123C' : '#64748B')};
`;
// #250 나열 기준 토글 — ToggleDone 과 같은 계열(bespoke 금지). 활성 시 Teal 로 눌린 상태 표시.
// (SortToggle 제거 — #258 보기 기준 칩 3종으로 대체됐다. components/QTask/PopoutViewChips.tsx)
// 운영 #280 — 우선순위 번호가 건너뛰어 보이는 이유를 목록 아래에서 설명한다.
export const PrioGapHint = styled.div`
  margin-top: 10px; padding: 7px 9px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 0.6875rem; line-height: 1.5; color: #64748B;
`;
// 완료 가리기 — Q Task 리스트의 HideCheck 와 같은 감각(작은 체크박스 + 라벨).
//   보기 칩 줄 위에 놓아 "무엇을 보여줄지" 를 먼저 정하고 "어떻게 나열할지" 로 넘어가게 한다.
// 태그 사전 관리 진입 — 칩 줄 오른쪽, 완료 가리기 옆. 칩과 같은 높이(28)로 줄을 안 흔든다.
// 칩 줄에 서는 보조 버튼. 규격을 다시 적지 않고 같은 줄의 GoMainBtn 을 **상속**한다 —
// 손으로 베끼면 갈라진다(2026-09-08: 높이만 따로 적었다가 규격 래칫에 걸렸다).
// 칩 줄이라 모서리만 알약으로 바꾼다.
export const PopoutTagManageBtn = styled(GoMainBtn)`
  margin-right: 8px; padding: 0 8px;
  border-radius: 999px;
  font-size: 0.6875rem; color: #64748B;
  &:hover { border-color:#CBD5E1; color:#0F172A; }
`;
export const DoneFilterLabel = styled.label`
  display:inline-flex; align-items:center; gap:6px; cursor:pointer;
  font-size:0.75rem; font-weight:600; color:#64748B; user-select:none;
  input { width:14px; height:14px; accent-color:#14B8A6; cursor:pointer; }
  &:hover { color:#0F172A; }
`;
export const ToggleDone = styled.button`
  width: 100%; margin-top: 10px;
  padding: 8px; border: 1px dashed #CBD5E1; border-radius: 8px;
  background: transparent; cursor: pointer;
  font-size: 0.75rem; font-weight: 600; color: #64748B;
  &:hover { border-color: #94A3B8; color: #475569; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
export const Center = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 48px 20px; text-align: center;
  font-size: 0.8125rem; color: #94A3B8;
`;
export const EmptyTitle = styled.div`font-size: 0.875rem; font-weight: 700; color: #475569;`;
export const EmptyLine = styled.div`font-size: 0.78125rem; color: #94A3B8;`;
export const ErrText = styled.div`font-size: 0.8125rem; color: #BE123C;`;
export const RetryBtn = styled.button`
  padding: 7px 14px; border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF; cursor: pointer; font-size: 0.78125rem; font-weight: 600; color: #0F172A;
  &:hover { border-color: #0F766E; color: #0F766E; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;


/* ── 촘촘히 보기 (2026-10-12) ─────────────────────────────────────────
   Irene: "더 많은 할일이 보이게 … 글자가 더 작아지지 않아도 가능하면 칸 간격 없게 하고
   한줄로 해서 극단적으로 최소화". 글자 크기는 그대로 두고 **카드·간격·두 번째 줄**만 걷어낸다.
   카드 행 ≈ 74px → 한 줄 행 32px. 행 구조(형제 버튼들)는 그대로 — 규격만 덮는다.
   ★ 같은 styled 를 상속해 덮는다. 행을 두 벌 그리면 열·권한·버튼이 갈라진다. */
export const CompactList = styled(List)`
  gap: 0;
  background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;
  ${Row} {
    gap: 0; padding: 0 6px 0 2px; border: 0; border-radius: 0;
    border-bottom: 1px solid #F1F5F9;
    &:hover:not([data-drop]) { box-shadow: none; }
    &:hover { background: #F8FAFC; }
    &[data-drop='before'] { box-shadow: inset 0 2px 0 0 #14B8A6; }
    &[data-drop='after'] { box-shadow: inset 0 -2px 0 0 #14B8A6; }
  }
  ${Row}:last-child { border-bottom: 0; }
  ${RowInner} { gap: 4px; min-height: 32px; }
  /* 리드 칸은 div 안 inline-flex 버튼이라 줄 상자(글자 아래 여백)만큼 4px 더 커졌다 → flex 로 */
  ${RowLead} { display: flex; align-items: center; }
  ${Slot}, ${CheckBtn}, ${SubmitBtn}, ${FocusBtn}, ${FocusSlot}, ${PrioBtn}, ${PrioSlot} { height: 32px; }
  ${Slot}, ${CheckBtn}, ${SubmitBtn}, ${FocusBtn}, ${FocusSlot} { width: 30px; }
  ${FocusBtn}::before { inset: 3px 2px; }
  ${RowMain} { flex-direction: row; align-items: center; gap: 8px; min-height: 32px; }
  ${RowTop} { flex: 1; min-width: 0; align-items: center; gap: 6px; }
  ${RowTitle} {
    line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    word-break: normal; min-width: 0;
  }
  ${RowMeta} { flex-wrap: nowrap; flex-shrink: 0; gap: 6px; white-space: nowrap; }
  ${RowErr} { margin: 0 0 6px 34px; }
  /* 태그 + 는 행마다 점선 상자라 한 줄 목록에선 세로 기둥처럼 보인다 — 평소엔 테두리를 감추고 행에 올리면 보인다 */
  ${TagSlot} button { border-color: transparent; }
  ${Row}:hover ${TagSlot} button, ${TagSlot} button:focus-visible, ${TagSlot} button[aria-expanded='true'] { border-color: #CBD5E1; }
`;
/* 촘촘히 보기의 상태 표시 — 글자 알약 대신 색 점(이름은 마우스를 올리면). 처리할 차례인 상태는
   글자를 남긴다(TaskPopoutView 의 COMPACT_TEXT_CODES) — 점만으로는 "내가 할 일" 을 놓친다. */
export const StatusDot = styled.span<{ $bg: string; $fg: string }>`
  flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%;
  background: ${({ $fg }) => $fg}; box-shadow: 0 0 0 2px ${({ $bg }) => $bg};
  margin: 0 2px;
`;
export const CompactProject = styled(MetaChip)`
  max-width: 96px; overflow: hidden; text-overflow: ellipsis;
`;
/* 보기 밀도 토글 — 오늘/이번 주 탭 줄 오른쪽 끝(두 탭 공통). 탭 버튼과 같은 높이·테두리 언어. */
export const DensityBtn = styled.button<{ $active: boolean }>`
  /* 높이는 같은 줄의 탭 버튼을 따른다(stretch) — 숫자를 다시 적으면 규격 래칫이 오르고 둘이 갈라진다 */
  flex-shrink: 0; width: 30px; align-self: stretch; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  color: ${p => (p.$active ? '#0F766E' : '#64748B')};
  background: ${p => (p.$active ? '#F0FDFA' : 'transparent')};
  border: 1px solid ${p => (p.$active ? '#99F6E4' : '#E2E8F0')};
  border-radius: 8px; cursor: pointer;
  &:hover { background: ${p => (p.$active ? '#CCFBF1' : '#F8FAFC')}; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
export const DensityIcon: React.FC<{ compact: boolean }> = ({ compact }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    {compact
      ? <path d="M2 3h10M2 5.7h10M2 8.3h10M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      : <><rect x="1.8" y="2" width="10.4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <rect x="1.8" y="8" width="10.4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.3" /></>}
  </svg>
);

/* ── 내 순서: 끌어 옮기기 (2026-10-12, docs/TASK_USER_ORDER_DESIGN.md) ──────────────
   손잡이는 우선순위 번호가 비운 자리(행 왼쪽)에 선다. 끌 수 없는 행(완료·다른 정렬)에는 빈 칸을 남겨 열을 맞춘다.
   놓을 자리는 행의 data-drop 으로 그린다(위·아래 선) — 행을 따로 그리지 않는다. */
export const DragSlot = styled.span`
  width: 20px; align-self: stretch; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
`;
export const DragHandle = styled.button`
  width: 20px; height: 100%; padding: 0; border: 0; background: transparent;
  display: inline-flex; align-items: center; justify-content: center;
  color: #CBD5E1; cursor: grab; touch-action: none; border-radius: 4px;
  &:hover { color: #64748B; background: #F1F5F9; }
  &:active { cursor: grabbing; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 0; color: #0F766E; }
`;
export const DragGrip: React.FC = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="3" r="1.2" /><circle cx="7" cy="3" r="1.2" />
    <circle cx="3" cy="7" r="1.2" /><circle cx="7" cy="7" r="1.2" />
    <circle cx="3" cy="11" r="1.2" /><circle cx="7" cy="11" r="1.2" />
  </svg>
);

/* Cue 에게 말하기 칸 — CueTaskBar compact 는 자기 여백이 0 이라(목록 안에 얹을 때용) 팝아웃에선 탭 줄·퀵애드와
   **같은 축**(좌우 12px)과 위 간격을 여기서 준다. Irene 2026-10-12: "위에 여백없고, 좌우 레이아웃 여백없어서 이상해". */
export const PopoutCueSlot = styled.div`
  padding: 10px 12px 0;
  flex-shrink: 0;
`;
