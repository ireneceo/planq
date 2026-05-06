// 단일 날짜 입력 — PlanQ CalendarPicker singleMode 기반.
//
// 30년차 시각:
//   - <input type="date"> 는 OS/브라우저별 디자인 제각각 + iOS 자동 줌 + i18n 일관성 깨짐.
//   - PlanQ 의 모든 단일 날짜 입력 UI 는 이 컴포넌트로 통일 (range 는 CalendarPicker 직접 사용).
//
// API:
//   value:        'YYYY-MM-DD' 또는 빈 문자열 (미입력)
//   onChange:     선택 시 'YYYY-MM-DD' (또는 빈 문자열로 clear)
//   minDate?:     'YYYY-MM-DD' — 이 날짜 이전 비활성 (CalendarPicker 자체엔 min 제약 없으므로 onChange 게이트만)
//   placeholder?: 빈 상태 라벨
//   disabled?:    비활성
//   width?:       trigger button 폭
//   size?:        'sm' (32px, 기본) / 'md' (38px, PlanQSelect md 와 동일)

import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import CalendarPicker from './CalendarPicker';

interface Props {
  value: string;
  onChange: (date: string) => void;
  minDate?: string;
  placeholder?: string;
  disabled?: boolean;
  width?: number | string;
  size?: 'sm' | 'md';
  className?: string;
}

const SingleDateField: React.FC<Props> = ({
  value, onChange, minDate, placeholder, disabled, width, size = 'sm', className,
}) => {
  const { t } = useTranslation('common');
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const label = value
    ? `${value.slice(0, 4)}.${value.slice(5, 7)}.${value.slice(8, 10)}`
    : (placeholder || (t('singleDate.placeholder', '날짜 선택') as string));

  const handleSelect = (d: string) => {
    if (!d) return;
    if (minDate && d < minDate) return; // min 게이트
    onChange(d);
    setOpen(false);
  };

  return (
    <>
      <Trigger
        ref={ref}
        type="button"
        disabled={disabled}
        $empty={!value}
        $size={size}
        $width={width}
        className={className}
        onClick={() => !disabled && setOpen(true)}
      >
        {label}
      </Trigger>
      {open && (
        <CalendarPicker
          isOpen
          singleMode
          anchorRef={ref}
          startDate={value}
          endDate={value}
          onRangeSelect={(s) => handleSelect(s)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

export default SingleDateField;

// PlanQSelect SIZE_HEIGHT 와 정확 동일 (sm 36 / md 44) — 같은 행에 놓일 때 정렬 일치
const Trigger = styled.button<{ $empty?: boolean; $size: 'sm' | 'md'; $width?: number | string }>`
  height: ${(p) => (p.$size === 'md' ? '44px' : '36px')};
  padding: 0 10px;
  ${(p) => p.$width !== undefined && `width: ${typeof p.$width === 'number' ? `${p.$width}px` : p.$width};`}
  border: 1px solid #E2E8F0;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  color: ${(p) => (p.$empty ? '#94A3B8' : '#0F172A')};
  background: #FFF;
  cursor: pointer;
  text-align: left;
  display: inline-flex;
  align-items: center;
  transition: border-color 0.15s;
  &:hover { border-color: #CBD5E1; }
  &:focus { outline: none; border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  &:disabled { background: #F1F5F9; color: #94A3B8; cursor: not-allowed; }
`;
