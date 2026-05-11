// Visibility 배지 (4 단계) — 사이클 N+9, VISIBILITY_VOCABULARY.md §1
//
// L1=개인 (lock, gray) / L2=팀 비공개 (users, teal)
// L3=워크스페이스 (building, blue) / L4=외부 공개 (globe, orange)
//
// 사용:
//   <VisibilityBadge level="L1" onClick={() => openModal()} />
//   <VisibilityBadge level={file.visibility} compact />  // compact: 아이콘만
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';

export type VLevel = 'L1' | 'L2' | 'L3' | 'L4' | null | undefined;

interface Props {
  level: VLevel;
  compact?: boolean;       // 아이콘만 (label 숨김)
  onClick?: () => void;    // 있으면 클릭 가능 (변경 모달 트리거)
  size?: 'sm' | 'md';
  className?: string;
}

const TOKENS: Record<NonNullable<VLevel>, { fg: string; bg: string }> = {
  L1: { fg: '#64748B', bg: '#F1F5F9' },  // gray
  L2: { fg: '#0F766E', bg: '#F0FDFA' },  // teal
  L3: { fg: '#1E40AF', bg: '#EFF6FF' },  // blue
  L4: { fg: '#C2410C', bg: '#FFF7ED' },  // orange
};

const IconLock = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const IconUsers = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IconBuilding = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M8 10h.01"/><path d="M16 10h.01"/><path d="M8 14h.01"/><path d="M16 14h.01"/>
  </svg>
);
const IconGlobe = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const ICONS: Record<NonNullable<VLevel>, React.ReactNode> = {
  L1: <IconLock />, L2: <IconUsers />, L3: <IconBuilding />, L4: <IconGlobe />,
};

const VisibilityBadge: React.FC<Props> = ({ level, compact, onClick, size = 'sm', className }) => {
  const { t } = useTranslation('common');
  if (!level) return null;
  const tk = TOKENS[level];
  const label = t(`vault.vis.${level}`, { defaultValue: { L1: '개인', L2: '팀', L3: '워크스페이스', L4: '외부' }[level] }) as string;
  const fullLabel = t(`vault.visLong.${level}`, {
    defaultValue: { L1: '본인만', L2: '프로젝트 멤버', L3: '워크스페이스 공개', L4: '외부 공개' }[level],
  }) as string;

  if (onClick) {
    return (
      <Btn type="button" $fg={tk.fg} $bg={tk.bg} $size={size} $clickable
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        title={fullLabel} aria-label={fullLabel}
        className={className}>
        {ICONS[level]}{!compact && <Label>{label}</Label>}
      </Btn>
    );
  }
  return (
    <Static $fg={tk.fg} $bg={tk.bg} $size={size} title={fullLabel} aria-label={fullLabel} className={className}>
      {ICONS[level]}{!compact && <Label>{label}</Label>}
    </Static>
  );
};

export default VisibilityBadge;

const baseStyles = `
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px; border-radius: 999px;
  font-size: 10px; font-weight: 600;
  line-height: 1; white-space: nowrap;
`;

const Static = styled.span<{ $fg: string; $bg: string; $size: 'sm' | 'md' }>`
  ${baseStyles}
  color: ${p => p.$fg};
  background: ${p => p.$bg};
  ${p => p.$size === 'md' && 'padding: 3px 8px; font-size: 11px;'}
`;

const Btn = styled.button<{ $fg: string; $bg: string; $size: 'sm' | 'md'; $clickable: boolean }>`
  ${baseStyles}
  color: ${p => p.$fg};
  background: ${p => p.$bg};
  border: none;
  cursor: pointer;
  transition: filter 0.12s;
  ${p => p.$size === 'md' && 'padding: 3px 8px; font-size: 11px;'}
  &:hover { filter: brightness(0.95); }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;

const Label = styled.span``;
