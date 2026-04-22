// 카테고리 입력용 Combobox — input + 실시간 필터링 드롭다운
// - 입력 중 기존 옵션 중 일치 항목 추천
// - 클릭/키보드로 선택
// - 새 값 입력 후 blur/enter 시 그 값으로 저장 (자유 입력)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';

interface Props {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
}

const CategoryCombobox: React.FC<Props> = ({ value, onChange, options, placeholder }) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, 20);
    return options.filter(o => o.toLowerCase().includes(q)).slice(0, 20);
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setHighlightIdx(-1);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlightIdx(i => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      if (open && highlightIdx >= 0 && filtered[highlightIdx]) {
        e.preventDefault();
        pick(filtered[highlightIdx]);
      } else {
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showEmptyHint = open && filtered.length === 0 && value.trim().length > 0;
  const showExistingMatch = open && filtered.some(o => o === value.trim());
  const showCreateHint = open && value.trim() && !showExistingMatch;

  return (
    <Wrap ref={wrapRef}>
      <Row>
        <Hash>#</Hash>
        <Input
          ref={inputRef}
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); setHighlightIdx(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={40}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="category-combobox-list"
        />
      </Row>
      {open && (filtered.length > 0 || showCreateHint || showEmptyHint) && (
        <Menu id="category-combobox-list" role="listbox">
          {filtered.map((o, i) => (
            <Item
              key={o}
              role="option"
              aria-selected={i === highlightIdx || o === value.trim()}
              $active={i === highlightIdx || o === value.trim()}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={e => { e.preventDefault(); pick(o); }}
            >
              <ItemText>#{o}</ItemText>
              {o === value.trim() && <CurrentMark>✓</CurrentMark>}
            </Item>
          ))}
          {showCreateHint && (
            <CreateHint onMouseDown={e => { e.preventDefault(); pick(value.trim()); }}>
              <ItemText>{t('combobox.createNew', { value: value.trim() })}</ItemText>
            </CreateHint>
          )}
          {showEmptyHint && <EmptyHint>{t('combobox.noCategory')}</EmptyHint>}
        </Menu>
      )}
    </Wrap>
  );
};

export default CategoryCombobox;

const Wrap = styled.div`position: relative; width: 100%;`;
const Row = styled.div`display: flex; align-items: center; gap: 6px;`;
const Hash = styled.div`font-size: 14px; color: #94A3B8; font-weight: 700; padding-left: 2px;`;
const Input = styled.input`
  flex: 1; height: 34px; padding: 0 12px;
  background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px;
  font-size: 13px; color: #0F172A;
  &::placeholder { color: #94A3B8; }
  &:focus { outline: none; border-color: #14B8A6; background: #fff; box-shadow: 0 0 0 2px rgba(20,184,166,0.15); }
`;
const Menu = styled.div`
  position: absolute; top: calc(100% + 4px); left: 16px; right: 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  z-index: 50; padding: 4px; max-height: 240px; overflow-y: auto;
`;
const Item = styled.div<{ $active: boolean }>`
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  background: ${p => p.$active ? '#F0FDFA' : 'transparent'};
  color: ${p => p.$active ? '#0F766E' : '#334155'};
  font-size: 13px;
  &:hover { background: #F0FDFA; color: #0F766E; }
`;
const ItemText = styled.span`font-weight: 600;`;
const CurrentMark = styled.span`color: #14B8A6; font-weight: 700;`;
const CreateHint = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px; border-radius: 6px; cursor: pointer;
  border-top: 1px solid #F1F5F9; margin-top: 4px;
  color: #0F766E; font-size: 13px;
  &:hover { background: #F0FDFA; }
`;
const EmptyHint = styled.div`padding: 10px; font-size: 12px; color: #94A3B8; text-align: center;`;
