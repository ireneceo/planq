// 공용 검색 박스 — 아이콘 + input + X 클리어 + (옵션) 단축키 힌트
// 모든 페이지 검색 UI 통일 진입점. 독자 styled 금지.
import React, { forwardRef } from 'react';
import styled from 'styled-components';

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  shortcutHint?: string;            // 예: "Ctrl+K" (우측 pill)
  size?: 'sm' | 'md';               // sm=32, md=36
  width?: number | string;          // 고정 폭 또는 "100%"
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  { value, onChange, placeholder, shortcutHint, size = 'sm', width, autoFocus, disabled, className, ariaLabel, onKeyDown }, ref
) {
  const hasValue = value.length > 0;
  return (
    <Wrap className={className} $size={size} $w={width} $disabled={!!disabled}>
      <IconSlot>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </IconSlot>
      <Input
        ref={ref}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        onKeyDown={onKeyDown}
      />
      {hasValue && !disabled && (
        <ClearBtn type="button" tabIndex={-1} aria-label="clear" onClick={() => onChange('')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </ClearBtn>
      )}
      {!hasValue && shortcutHint && <HintPill aria-hidden>{shortcutHint}</HintPill>}
    </Wrap>
  );
});

export default SearchBox;

// ─── styled ───
const Wrap = styled.label<{ $size: 'sm' | 'md'; $w?: number | string; $disabled: boolean }>`
  display:inline-flex;align-items:center;gap:6px;
  height:${p => p.$size === 'md' ? 36 : 32}px;
  padding:0 6px 0 10px;
  ${p => p.$w !== undefined ? `width:${typeof p.$w === 'number' ? `${p.$w}px` : p.$w};` : ''}
  background:#F1F5F9;border:1px solid #E2E8F0;border-radius:8px;
  color:#64748B;opacity:${p => p.$disabled ? 0.5 : 1};
  transition:background .15s, border-color .15s, color .15s;
  &:focus-within{background:#fff;border-color:#14B8A6;color:#0F172A;box-shadow:0 0 0 3px rgba(20,184,166,0.12);}
  &:hover:not(:focus-within){background:#E2E8F0;}
`;
const IconSlot = styled.span`display:inline-flex;align-items:center;color:#94A3B8;flex-shrink:0;`;
const Input = styled.input`
  flex:1;min-width:0;border:none;outline:none;background:transparent;
  font-size:13px;color:#0F172A;
  &::placeholder{color:#94A3B8;}
  &:disabled{cursor:not-allowed;}
`;
const ClearBtn = styled.button`
  width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;border:none;border-radius:50%;cursor:pointer;color:#64748B;flex-shrink:0;
  &:hover{background:#E2E8F0;color:#0F172A;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:1px;}
`;
const HintPill = styled.span`
  padding:2px 6px;background:#fff;border:1px solid #E2E8F0;border-radius:4px;
  font-size:10px;font-weight:600;color:#94A3B8;letter-spacing:.2px;flex-shrink:0;
`;
