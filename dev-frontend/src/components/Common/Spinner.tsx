// 표준 spinner — 통일 스타일.
// 사용:
//   <Spinner /> (16×16, Primary)
//   <Spinner size={24} />
//   <Spinner color="white" />  (어두운 배경)
import React from 'react';
import styled, { keyframes } from 'styled-components';

interface Props {
  size?: number;
  color?: 'primary' | 'white' | 'muted';
  className?: string;
}

const Spinner: React.FC<Props> = ({ size = 16, color = 'primary', className }) => (
  <Spin
    $size={size}
    $color={color}
    className={className}
    role="status"
    aria-label="loading"
  />
);

export default Spinner;

const spin = keyframes`to { transform: rotate(360deg); }`;

const COLOR_MAP = {
  primary: { ring: 'rgba(20,184,166,0.3)', top: '#14B8A6' },
  white:   { ring: 'rgba(255,255,255,0.4)', top: '#FFFFFF' },
  muted:   { ring: 'rgba(148,163,184,0.3)', top: '#94A3B8' },
};

const Spin = styled.span<{ $size: number; $color: 'primary' | 'white' | 'muted' }>`
  display: inline-block;
  width: ${p => p.$size}px; height: ${p => p.$size}px;
  border: 2px solid ${p => COLOR_MAP[p.$color].ring};
  border-top-color: ${p => COLOR_MAP[p.$color].top};
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
  flex-shrink: 0;
`;
