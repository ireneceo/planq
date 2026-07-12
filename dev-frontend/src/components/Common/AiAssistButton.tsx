// PlanQ 보조 AI 버튼 — 파스텔 민트. 단일 소스.
//
// AI 버튼은 두 단계로 나눈다:
//  - AiActionButton (별 + Coral)  : 그 화면의 주 AI 액션 (답변 초안 쓰기, 문서 자동 작성, 지식 자동 추가)
//  - AiAssistButton (파스텔 민트) : 패널 안에서 거드는 보조 액션 (요약 생성, 업무 추출)
// 보조까지 전부 Coral 이면 화면이 빨간 버튼투성이가 되어 정작 주 액션이 안 보인다.
//
// 원본: Q Talk ChatPanel 의 업무 추출 버튼 (운영 라이브 디자인) — 그대로 박제.
import type { ReactNode } from 'react';
import styled, { keyframes } from 'styled-components';

interface Props {
  onClick: () => void;
  label: string;
  title?: string;
  disabled?: boolean;
  loading?: boolean;
  /** 왼쪽 아이콘 (기본: 체크박스 = 업무 추출). 요약 등은 다른 아이콘을 넘긴다. */
  icon?: ReactNode;
}

const DefaultIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);

export default function AiAssistButton({ onClick, label, title, disabled, loading, icon }: Props) {
  return (
    <Btn type="button" onClick={onClick} title={title} disabled={disabled || loading}>
      {loading ? <Spinner aria-hidden="true" /> : (icon ?? DefaultIcon)}
      {label}
    </Btn>
  );
}

const spin = keyframes`to { transform: rotate(360deg); }`;

const Spinner = styled.span`
  width: 12px; height: 12px; flex-shrink: 0;
  border: 2px solid #99F6E4;
  border-top-color: #0F766E;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation-duration: 2s; }
`;

const Btn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: #F0FDFA;
  color: #0F766E;
  border: 1px solid #99F6E4;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease;
  &:hover:not(:disabled) { background: #CCFBF1; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
