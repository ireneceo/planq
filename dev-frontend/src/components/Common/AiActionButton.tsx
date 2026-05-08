// PlanQ 표준 AI 액션 버튼 — 단일 소스. 모든 AI 진입점은 이 컴포넌트 재사용.
// 디자인 룰: Coral→Pink 그라디언트 + 5각 별 + 흰글자. 절대 변경 금지.
// 원본: components/Docs/PostsPage.tsx 의 AiBtn (운영 라이브 디자인).
import styled from 'styled-components';

interface Props {
  onClick: () => void;
  label: string;          // 보통 'AI'
  title?: string;         // 호버 힌트
  disabled?: boolean;
}

export default function AiActionButton({ onClick, label, title, disabled }: Props) {
  return (
    <Btn type="button" onClick={onClick} title={title} disabled={disabled}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
      {label}
    </Btn>
  );
}

const Btn = styled.button`
  height: 32px; padding: 0 12px;
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
  border: none; border-radius: 8px; cursor: pointer;
  transition: opacity 0.15s, transform 0.15s;
  &:hover { transform: translateY(-1px); }
  &:focus-visible { outline: 2px solid #F43F5E; outline-offset: 2px; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
