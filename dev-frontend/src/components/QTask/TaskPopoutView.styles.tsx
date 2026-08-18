// TaskPopoutView 의 styled 정의 + 인라인 아이콘 절출 (god-file 래칫 — 컴포넌트 파일 800줄 상한).
// 주석을 깎아 가드를 통과시키지 않는다 — QMail(MailPage.styles)·ProjectTaskList 와 같은 패턴.
//   ★ 확장자가 .tsx 인 이유: 이 블록에 SVG 아이콘 컴포넌트(JSX)가 함께 있다.
import React from 'react';
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
  margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.2px; color: #0F172A;
`;
// #258 — 헤더의 "Q Task 열기". 보조 액션이라 3톤 중 Secondary 톤(테두리+무채색)으로 둔다.
export const GoMainBtn = styled.button`
  flex-shrink: 0; height: 28px; padding: 0 10px;
  border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF; color: #475569;
  font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; white-space: nowrap;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
export const HeadRight = styled.div`
  margin-left: auto;
  display: flex; align-items: center; gap: 10px;
`;
export const HeadMeta = styled.span`
  font-size: 12px; color: #64748B; white-space: nowrap;
`;
// 태그 그룹 헤더 — 태그순 모드에서 대표 태그가 바뀌는 지점 (#237 "태그별로 시각적으로")
export const TagGroupHead = styled.div<{ $color: string }>`
  display: flex; align-items: center; gap: 6px;
  margin: 8px 0 2px; padding: 2px 0 2px 8px;
  border-left: 3px solid ${p => p.$color};
  font-size: 11px; font-weight: 700; color: #64748B; letter-spacing: 0.2px;
`;
// 오늘/이번 주 세그먼트 — 팝아웃 폭(≈520px)에서 한 줄. 헤더 아래 고정.
export const TabRow = styled.div`
  display: flex; gap: 4px; padding: 6px 10px 0;
  flex-shrink: 0;
`;
export const TabBtn = styled.button<{ $active: boolean }>`
  flex: 1; height: 30px; padding: 0 10px;
  font-size: 12px; font-weight: ${p => (p.$active ? 700 : 600)};
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
  font-size: 11.5px; font-weight: 600; line-height: 1.4;
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
  font-size: 11px; font-weight: 800; line-height: 1;
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
    font-size: 11px; font-weight: 800; line-height: 1;
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
  font-size: 11px; font-weight: 700;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  white-space: nowrap;
`;
export const RowTitle = styled.span`
  font-size: 13.5px; font-weight: 600; color: #0F172A; line-height: 1.4;
  word-break: break-word;
`;
export const RowMeta = styled.div`
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 11.5px; color: #64748B;
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
  font-size: 11px; line-height: 1.5; color: #64748B;
`;
export const ToggleDone = styled.button`
  width: 100%; margin-top: 10px;
  padding: 8px; border: 1px dashed #CBD5E1; border-radius: 8px;
  background: transparent; cursor: pointer;
  font-size: 12px; font-weight: 600; color: #64748B;
  &:hover { border-color: #94A3B8; color: #475569; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
export const Center = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  padding: 48px 20px; text-align: center;
  font-size: 13px; color: #94A3B8;
`;
export const EmptyTitle = styled.div`font-size: 14px; font-weight: 700; color: #475569;`;
export const EmptyLine = styled.div`font-size: 12.5px; color: #94A3B8;`;
export const ErrText = styled.div`font-size: 13px; color: #BE123C;`;
export const RetryBtn = styled.button`
  padding: 7px 14px; border: 1px solid #E2E8F0; border-radius: 8px;
  background: #FFFFFF; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #0F172A;
  &:hover { border-color: #0F766E; color: #0F766E; }
  &:focus-visible { outline: 2px solid rgba(15,118,110,0.5); outline-offset: 2px; }
`;
