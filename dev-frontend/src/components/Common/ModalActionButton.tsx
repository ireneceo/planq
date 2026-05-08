// PlanQ 표준 모달 액션 버튼 — 단일 소스.
// 디자인 룰: /docs (PostAiModal · NewDocumentModal) 의 PrimaryBtn / SecondaryBtn 그대로.
//   - variant 'ai': 빨강 그라디언트 + 별 아이콘 (AI 액션 트리거)
//   - variant 'primary': teal 단색 (일반 저장/생성)
//   - variant 'secondary': 흰바탕 + 회색 테두리 (취소/뒤로)
import styled, { css } from 'styled-components';

type Variant = 'ai' | 'primary' | 'secondary';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export default function ModalActionButton({ variant = 'secondary', type = 'button', children, ...rest }: Props) {
  return (
    <Btn $variant={variant} type={type} {...rest}>
      {variant === 'ai' && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8 5.8 21.3l2.4-7.4L2 9.4h7.6L12 2z"/></svg>
      )}
      {children}
    </Btn>
  );
}

const Btn = styled.button<{ $variant: Variant }>`
  display: inline-flex; align-items: center;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  ${p => p.$variant === 'ai' ? css`
    padding: 9px 18px;
    font-weight: 700;
    color: #fff;
    background: linear-gradient(135deg, #F43F5E 0%, #BE185D 100%);
    border: none;
    transition: transform 0.15s;
    &:hover:not(:disabled) { transform: translateY(-1px); }
    &:disabled { background: #CBD5E1; cursor: not-allowed; }
  ` : p.$variant === 'primary' ? css`
    padding: 9px 18px;
    font-weight: 700;
    color: #FFF;
    background: #14B8A6;
    border: none;
    transition: background 0.15s;
    &:hover:not(:disabled) { background: #0D9488; }
    &:disabled { background: #CBD5E1; cursor: not-allowed; }
  ` : css`
    padding: 9px 16px;
    font-weight: 600;
    color: #334155;
    background: #FFF;
    border: 1px solid #E2E8F0;
    transition: background 0.15s, border-color 0.15s;
    &:hover:not(:disabled) { border-color: #CBD5E1; background: #F8FAFC; }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
  `}
`;
