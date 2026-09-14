// Cue 바 껍데기 — **Q task 와 Q sale 이 같이 쓴다.** (2026-09-14 공용 추출)
//
// Irene: *"Q sale에 나오는 cue에게 말하기가 Q task에 나오는 기능이랑 다르잖아. … 별표 아이콘
//   들어가는 거라 입력할 때 빨간 라인 들어가는 거 모두 완전히 스타일 기능 완벽히 똑같이 하되
//   Q sale에 맞춰줘."*
//
// ★ 여기 있던 값들은 `components/QTask/CueTaskBar.tsx` 에 있던 것을 **그대로** 옮긴 것이다.
//   옮기면서 색·크기를 하나도 바꾸지 않았다. Q sale 이 이걸 베껴 쓰다 갈라진 전례가 이미 있다
//   (2026-09-13: 주석엔 "같다" 고 적혀 있었지만 민트 vs 흰 배경으로 달랐다 —
//    memory `feedback_comment_lies_predicate_drifts`). 껍데기를 한 곳에 두면 그 일이 안 생긴다.
import styled, { keyframes } from 'styled-components';

export const CORAL = '#F43F5E';

export const Wrap = styled.div<{ $compact?: boolean }>`
  padding: ${(p) => (p.$compact ? '0' : '10px 16px 0')};
  flex-shrink: 0;
`;
export const BarRow = styled.div<{ $active: boolean }>`
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px 7px 12px;
  background: #fff;
  border: 1px solid ${p => p.$active ? CORAL : '#E2E8F0'};
  border-radius: 10px;
  transition: border-color .15s, box-shadow .15s;
  box-shadow: ${p => p.$active ? `0 0 0 3px rgba(244,63,94,0.10)` : 'none'};
  &:focus-within { border-color: ${CORAL}; box-shadow: 0 0 0 3px rgba(244,63,94,0.12); }
`;
export const Sparkle = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  color: ${CORAL}; flex-shrink: 0;
`;
export const Field = styled.textarea`
  flex: 1; min-width: 0;
  border: none; outline: none; resize: none;
  background: transparent;
  font-family: inherit; font-size: 0.84375rem; line-height: 1.5; color: #0F172A;
  padding: 1px 0;
  max-height: 140px;
  &::placeholder { color: #94A3B8; }
  &:disabled { color: #94A3B8; }
`;
export const SendBtn = styled.button`
  flex-shrink: 0;
  width: 30px; height: 30px; border-radius: 8px; border: none;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${CORAL}; color: #fff; cursor: pointer;
  transition: background .15s, transform .05s;
  &:hover { background: #E11D48; }
  &:active { transform: scale(0.94); }
  &:disabled { opacity: 0.5; cursor: default; }
`;
export const Shortcut = styled.span`
  flex-shrink: 0;
  font-size: 0.6875rem; font-weight: 600; color: #CBD5E1;
  padding: 2px 6px; border: 1px solid #E2E8F0; border-radius: 5px;
  @media (max-width: 640px) { display: none; }
`;
export const AddedBadge = styled.span`
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 0.75rem; font-weight: 600; color: #0D9488;
  animation: cuefade .25s ease;
  @keyframes cuefade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; } }
`;
export const Check = styled.svg`width: 14px; height: 14px;`;
export const SubHint = styled.div`
  font-size: 0.6875rem; color: #94A3B8; padding: 5px 4px 0 14px;
`;
export const ErrorMsg = styled.div`
  font-size: 0.75rem; color: #DC2626; background: #FEF2F2;
  padding: 8px 10px; border-radius: 6px; margin-top: 8px;
`;
// #237 — 실패가 아니라 안내(업무는 생성됨). 실패와 같은 빨강을 쓰지 않는다.
export const NoticeMsg = styled.div`
  font-size: 0.75rem; color: #B45309; background: #FFFBEB;
  padding: 8px 10px; border-radius: 6px; margin-top: 8px;
`;
export const Drop = styled.div`
  margin-top: 8px;
  padding: 12px;
  background: #FFF1F2;
  border: 1px solid #FECDD3;
  border-radius: 10px;
  display: flex; flex-direction: column; gap: 10px;
  animation: cuedrop .2s ease;
  @keyframes cuedrop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
`;
export const CueLine = styled.div`
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 0.78125rem; line-height: 1.5; color: #9F1239; font-weight: 500;
`;
export const CardList = styled.div`display: flex; flex-direction: column; gap: 8px;`;
export const Actions = styled.div`
  display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap;
`;
export const Thinking = styled.div`
  display: flex; align-items: center; gap: 8px;
  font-size: 0.78125rem; color: #9F1239; font-weight: 500;
`;
const blink = keyframes`0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}`;
export const Dots = styled.span`
  display: inline-flex; gap: 3px;
  i { width: 5px; height: 5px; border-radius: 50%; background: ${CORAL}; display: inline-block; animation: ${blink} 1.2s infinite; }
  i:nth-child(2) { animation-delay: .2s; }
  i:nth-child(3) { animation-delay: .4s; }
`;

