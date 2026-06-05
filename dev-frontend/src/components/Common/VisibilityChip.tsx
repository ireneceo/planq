// VisibilityChip — "공개: 팀" 형태의 공개범위 칩 (N+88 통일).
// Q docs 문서 상세 상단의 VisChip 패턴을 공통화 — Q Note 리뷰·메모, Q docs 가 같은 칩 사용.
// (작은 아이콘 배지는 VisibilityBadge, 클릭형 라벨 칩은 이 컴포넌트)
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { VLevel } from './VisibilityBadge';

interface Props {
  level: VLevel;
  onClick?: () => void;     // 있으면 클릭 가능 (변경 모달 트리거)
  disabled?: boolean;
  className?: string;
}

const VisibilityChip: React.FC<Props> = ({ level, onClick, disabled, className }) => {
  const { t } = useTranslation('common');
  const lv = level || 'L3';
  const label = t(`vault.vis.${lv}`, { defaultValue: { L1: '나만', L2: '팀', L3: '워크스페이스', L4: '외부' }[lv] }) as string;
  const openLabel = t('vault.visOpenLabel', { defaultValue: '공개' }) as string;
  return (
    <Chip type="button" $level={lv} onClick={onClick} disabled={disabled || !onClick}
      title={t('vault.visChangeHint', { defaultValue: '공개 범위 변경' }) as string} className={className}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" /><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      </svg>
      {openLabel}: {label}
    </Chip>
  );
};

export default VisibilityChip;

const Chip = styled.button<{ $level: NonNullable<VLevel> }>`
  display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px;
  background: ${p => p.$level === 'L1' ? '#F1F5F9' : p.$level === 'L2' ? '#FEF3C7' : p.$level === 'L4' ? '#FCE7F3' : '#CCFBF1'};
  color: ${p => p.$level === 'L1' ? '#475569' : p.$level === 'L2' ? '#92400E' : p.$level === 'L4' ? '#9F1239' : '#0F766E'};
  border: 1px solid ${p => p.$level === 'L1' ? '#CBD5E1' : p.$level === 'L2' ? '#FDE68A' : p.$level === 'L4' ? '#FBCFE8' : '#5EEAD4'};
  border-radius: 999px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  transition: filter 0.12s;
  &:hover:not(:disabled) { filter: brightness(0.97); }
  &:disabled { cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
