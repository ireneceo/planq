// 표 문서(kind='table') 칸 서식 · 행 끼워넣기 메뉴 (2026-10-11)
//   Irene: "표에는 에디터가 왜 안돼? 글자들 색상 굵기 크기 조정이 안되는데? 그리고 행사이에 행을 추가하거나
//           열 사이에 열을 추가하고 싶은 건 어떻게 해? 문서 안의 표, 표 형식 문서의 표. 어느 것이든 다 같이"
//
// ★ 칸 서식은 행 값의 예약 키 `_fmt` 에 둔다 — { [열 id]: { b?, color?, bg?, size? } } (값은 팔레트 key).
//   열 id 는 'c…' 로 시작해 겹치지 않고, 값을 읽는 곳(통계·검색·AI·설문)은 전부 열 id 로 읽으므로 섞이지 않는다.
//   색 값을 그대로 저장하지 않고 key 로 두는 이유: 문서 편집기와 같은 팔레트(textStylePalette)를 쓰고,
//   팔레트를 고치면 이미 칠한 칸도 같이 따라온다.
import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import TextStyleButton from './TextStyleButton';
import { colorOf, highlightOf, sizeOf, type PaletteItem } from './textStylePalette';

export const CELL_FMT_KEY = '_fmt';
export interface CellFmt { b?: boolean; color?: string; bg?: string; size?: string }
export type RowFmt = Record<string, CellFmt>;

export const rowFmtOf = (values: Record<string, unknown> | undefined): RowFmt => {
  const f = values?.[CELL_FMT_KEY];
  return f && typeof f === 'object' && !Array.isArray(f) ? (f as RowFmt) : {};
};

/** 칸(td)에 입힐 스타일 — 없는 key 는 무시(기본값) */
export const cellFmtStyle = (f?: CellFmt): React.CSSProperties | undefined => {
  if (!f) return undefined;
  const st: React.CSSProperties = {};
  if (f.b) st.fontWeight = 700;
  const c = colorOf(f.color); if (c) st.color = c;
  const bg = highlightOf(f.bg); if (bg) st.backgroundColor = bg;
  const sz = sizeOf(f.size); if (sz) st.fontSize = sz;
  return Object.keys(st).length ? st : undefined;
};

/** 고른 칸에 바꾼 서식을 얹은 새 _fmt — 기본값으로 돌리면 그 칸 항목을 지운다 */
export const nextRowFmt = (row: RowFmt, colId: string, patch: Partial<CellFmt>): RowFmt => {
  const cur: CellFmt = { ...(row[colId] || {}), ...patch };
  (Object.keys(cur) as (keyof CellFmt)[]).forEach((k) => {
    const v = cur[k];
    if (!v || v === 'default' || v === 'none' || v === 'normal') delete cur[k];
  });
  const out = { ...row };
  if (Object.keys(cur).length) out[colId] = cur; else delete out[colId];
  return out;
};

// ─── 서식 줄: [B] [A▾] + 안내 ───
export const TableFormatBar: React.FC<{
  fmt: CellFmt | null;        // 고른 칸이 없으면 null(버튼 비활성)
  onChange: (patch: Partial<CellFmt>) => void;
}> = ({ fmt, onChange }) => {
  const { t } = useTranslation('qdocs');
  const off = !fmt;
  const boldLabel = t('editor.bold', { defaultValue: '굵게' }) as string;
  return (
    <Bar data-testid="table-format-bar">
      <BoldBtn type="button" data-testid="table-format-bold" disabled={off} $on={!!fmt?.b}
        aria-pressed={!!fmt?.b} title={boldLabel} aria-label={boldLabel}
        onMouseDown={(e) => { e.preventDefault(); if (fmt) onChange({ b: !fmt.b }); }}>B</BoldBtn>
      <TextStyleButton testid="table-format" size="md" disabled={off}
        current={{ color: fmt?.color, bg: fmt?.bg, size: fmt?.size }}
        onPick={(kind: 'color' | 'bg' | 'size', item: PaletteItem) => onChange({ [kind]: item.key })} />
      <Hint>{off
        ? t('editor.style.tablePick', { defaultValue: '칸을 누르고 서식을 고르세요' })
        : t('editor.style.tablePicked', { defaultValue: '고른 칸에 적용됩니다' })}</Hint>
    </Bar>
  );
};

// ─── 행 번호 칸 메뉴: 위에 행 추가 · 아래에 행 추가 · 행 삭제 ───
export const RowMenuButton: React.FC<{
  index: number;
  onInsert: (side: 'above' | 'below') => void;
  onDelete: () => void;
}> = ({ index, onInsert, onDelete }) => {
  const { t } = useTranslation('qtable');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = !!pos;
  useEscapeStack(open, () => setPos(null));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (!menuRef.current?.contains(tg) && !btnRef.current?.contains(tg)) setPos(null);
    };
    // 스크롤에 닫지 않고 버튼을 따라간다 — 메뉴를 여는 순간의 포커스 스크롤로 곧장 닫히던 것(1440 실측)
    const follow = () => { const p = placeOf(); if (p) setPos(p); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);
  function placeOf() {
    const r = btnRef.current?.getBoundingClientRect();
    return r ? { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 188)) } : null;
  }
  const toggle = () => {
    if (open) { setPos(null); return; }
    setPos(placeOf());
  };
  const run = (fn: () => void) => () => { setPos(null); fn(); };
  const label = t('row.menu', { defaultValue: '행 메뉴' }) as string;
  return (
    <>
      <NumBtn ref={btnRef} type="button" data-testid="table-row-menu" onClick={toggle}
        aria-haspopup="menu" aria-expanded={open} title={label} aria-label={`${label} ${index}`}>{index}</NumBtn>
      {pos && (
        <Menu ref={menuRef} role="menu" style={{ top: pos.top, left: pos.left }} data-testid="table-row-menu-pop">
          <MenuItem type="button" role="menuitem" data-testid="table-row-insert-above" onClick={run(() => onInsert('above'))}>
            {t('row.insertAbove', { defaultValue: '위에 행 추가' })}
          </MenuItem>
          <MenuItem type="button" role="menuitem" data-testid="table-row-insert-below" onClick={run(() => onInsert('below'))}>
            {t('row.insertBelow', { defaultValue: '아래에 행 추가' })}
          </MenuItem>
          <MenuSep />
          <MenuItem type="button" role="menuitem" $danger onClick={run(onDelete)}>
            {t('row.deleteHint', { defaultValue: '행 삭제' })}
          </MenuItem>
        </Menu>
      )}
    </>
  );
};

const Bar = styled.div`display: inline-flex; align-items: center; gap: 4px; min-width: 0;`;
const BoldBtn = styled.button<{ $on?: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box; flex-shrink: 0;
  width: 32px; height: 32px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 0.8125rem; font-weight: 800;
  color: ${(p) => (p.$on ? '#0F766E' : '#475569')};
  background: ${(p) => (p.$on ? '#F0FDFA' : 'transparent')};
  &:hover:not(:disabled) { background: #E2E8F0; color: #0F172A; }
  &:disabled { opacity: 0.4; cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const Hint = styled.span`
  font-size: 0.75rem; color: #94A3B8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
  @media (max-width: 640px) { display: none; }
`;
const NumBtn = styled.button`
  all: unset; cursor: pointer; box-sizing: border-box;
  width: 100%; min-height: 32px; display: flex; align-items: center; justify-content: center;
  color: #94A3B8; font-size: 0.6875rem; border-radius: 4px;
  &:hover { background: #E2E8F0; color: #0F172A; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const Menu = styled.div`
  position: fixed; z-index: 1200; width: 180px; box-sizing: border-box; padding: 4px;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
`;
const MenuItem = styled.button<{ $danger?: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box; display: block; width: 100%;
  min-height: 36px; padding: 8px 10px; border-radius: 6px; font-size: 0.8125rem;
  color: ${(p) => (p.$danger ? '#DC2626' : '#0F172A')};
  &:hover { background: ${(p) => (p.$danger ? '#FEF2F2' : '#F1F5F9')}; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: -2px; }
`;
const MenuSep = styled.div`height: 1px; background: #F1F5F9; margin: 4px 0;`;
