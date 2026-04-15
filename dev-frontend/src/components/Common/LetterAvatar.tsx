import React from 'react';
import styled, { css } from 'styled-components';

/**
 * LetterAvatar — 통일된 첫글자 아바타
 *
 * 원칙:
 *   - 사람 / 프로젝트 / 고객사 / 멤버 모두 **동일한 중성 회색 그라데이션** 사용
 *   - 개별 색상 부여 금지 (시각적 노이즈 유발)
 *   - 활성/강조 variant 만 색상 차별 (예: 현재 선택된 프로젝트)
 *   - 실제 이미지가 있으면 이미지 우선, 없으면 첫글자 자동 생성
 *
 * variant:
 *   - 'neutral' (기본) — 회색 그라데이션, 어느 곳에서도 무난
 *   - 'active'  — 민트 그라데이션, 현재 선택/활성 상태
 *   - 'cue'     — 코랄 그라데이션, Cue(AI 팀원) 표시 전용
 */

type Variant = 'neutral' | 'active' | 'cue';

interface Props {
  name: string;
  size?: number;
  src?: string | null;
  variant?: Variant;
  title?: string;
  className?: string;
}

function initial(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  // 한글이든 영문이든 첫 문자 한 개 (이모지 조합도 첫 코드포인트만)
  return Array.from(trimmed)[0] || '?';
}

const LetterAvatar: React.FC<Props> = ({ name, size = 32, src, variant = 'neutral', title, className }) => {
  const content = src ? (
    <img src={src} alt={name} />
  ) : (
    <span>{initial(name)}</span>
  );
  return (
    <Circle $size={size} $variant={variant} $hasImage={!!src} title={title || name} className={className}>
      {content}
    </Circle>
  );
};

export default LetterAvatar;

const neutralBg = css`
  background: linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%);
  color: #64748B;
`;

const activeBg = css`
  background: linear-gradient(135deg, #CCFBF1 0%, #5EEAD4 100%);
  color: #0F766E;
`;

const cueBg = css`
  background: linear-gradient(135deg, #FECDD3 0%, #FDA4AF 100%);
  color: #9F1239;
`;

const Circle = styled.div<{ $size: number; $variant: Variant; $hasImage: boolean }>`
  width: ${(p) => p.$size}px;
  height: ${(p) => p.$size}px;
  border-radius: ${(p) => Math.round(p.$size * 0.28)}px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-weight: 700;
  font-size: ${(p) => Math.max(10, Math.round(p.$size * 0.42))}px;
  letter-spacing: -0.3px;
  user-select: none;

  ${(p) =>
    p.$hasImage
      ? css`
          background: #F1F5F9;
        `
      : p.$variant === 'active'
      ? activeBg
      : p.$variant === 'cue'
      ? cueBg
      : neutralBg}

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;
