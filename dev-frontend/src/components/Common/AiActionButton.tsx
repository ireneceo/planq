// PlanQ 표준 AI 액션 버튼 — 단일 소스. 모든 AI 진입점은 이 컴포넌트 재사용.
// 디자인 룰: Coral→Pink 그라디언트 + 5각 별 + 흰글자. 절대 변경 금지.
// 원본: components/Docs/PostsPage.tsx 의 AiBtn (운영 라이브 디자인).
//
// 사용자는 "누르면 AI 가 써준다" 를 색·아이콘만 보고 바로 알아야 한다. 그래서 화면마다
// 회색 secondary 로 흩어져 있던 AI 진입점(메일 답변 초안, 맥락 요약, 지식 자동 추가,
// 문서 자동 작성)을 전부 이 하나로 모은다. 새 AI 기능도 반드시 이걸 쓴다.
//
// size: sm(32px — 툴바·헤더 기본) / md(40px — 폼·컴포저에서 ActionButton md 와 높이 정렬)
import styled, { keyframes } from 'styled-components';

interface Props {
  onClick: () => void;
  label: string;          // 화면에 보이는 버튼 문구 (호출부에서 t() 로 넘긴다)
  title?: string;         // 호버 힌트
  disabled?: boolean;
  loading?: boolean;      // 생성 중 — 별 자리에 스피너 + 클릭 차단
  size?: 'sm' | 'md';
  className?: string;
}

export default function AiActionButton({
  onClick, label, title, disabled, loading, size = 'sm', className,
}: Props) {
  return (
    <Btn
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled || loading}
      $size={size}
      className={className}
    >
      {loading ? (
        <Spinner aria-hidden="true" />
      ) : (
        <svg width={size === 'md' ? 14 : 12} height={size === 'md' ? 14 : 12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z" />
        </svg>
      )}
      {label}
    </Btn>
  );
}

const spin = keyframes`to { transform: rotate(360deg); }`;

const Spinner = styled.span`
  width: 12px; height: 12px; flex-shrink: 0;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
  @media (prefers-reduced-motion: reduce) { animation-duration: 2s; }
`;

const Btn = styled.button<{ $size: 'sm' | 'md' }>`
  height: ${(p) => (p.$size === 'md' ? 40 : 32)}px;
  padding: 0 ${(p) => (p.$size === 'md' ? 16 : 12)}px;
  display: inline-flex; align-items: center; justify-content: center;
  gap: ${(p) => (p.$size === 'md' ? 6 : 4)}px;
  font-size: ${(p) => (p.$size === 'md' ? 13 : 12)}px;
  font-weight: 700; color: #fff; white-space: nowrap;
  background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  border: none; border-radius: 8px; cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  &:hover:not(:disabled) { transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
`;
