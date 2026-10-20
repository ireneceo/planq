// 표 채우기 색 (2026-10-12) — 문서 안 표 버블의 [칸 색] 과 표 문서 열 설정의 «열 색» 이 같은 견본(FillSwatches)을 쓴다.
//   Irene: "문서 표에서 열에 색상넣게 기능 넣어줄 수 있어?"
//   ★ 팝오버는 TextStyleButton 과 같은 방식 — body 로 포털(표 버블·툴바 층에 덮이지 않게) · mousedown preventDefault
//     (누르는 순간 편집기의 칸 선택이 풀리면 엉뚱한 칸이 칠해진다) · 스크롤에 닫지 않고 버튼을 따라간다.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { CELL_FILLS, type PaletteItem } from './textStylePalette';
import type { FillScope } from './editorTableCellFill';

export const FillSwatches: React.FC<{
  current: string | null | undefined;   // 팔레트 key
  onPick: (item: PaletteItem) => void;
  testid: string;
}> = ({ current, onPick, testid }) => {
  const { t } = useTranslation('qdocs');
  const cur = current || 'none';
  return (
    <Swatches>
      {CELL_FILLS.map((c) => {
        const name = t(c.tk) as string;
        return (
          <Swatch key={c.key} type="button" data-testid={`${testid}-${c.key}`} title={name} aria-label={name}
            aria-pressed={cur === c.key} $on={cur === c.key}
            onMouseDown={(e) => { e.preventDefault(); onPick(c); }}>
            <SwFill style={{ background: c.value || '#fff' }} $none={!c.value} />
          </Swatch>
        );
      })}
    </Swatches>
  );
};

const SCOPES: FillScope[] = ['cell', 'col', 'row'];

/** 문서 안 표 버블용 — 어두운 버블 버튼 + 범위(칸·열·행) + 견본 */
export const CellFillButton: React.FC<{
  current: string;
  onPick: (scope: FillScope, item: PaletteItem) => void;
}> = ({ current, onPick }) => {
  const { t } = useTranslation('qdocs');
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<FillScope>('col');   // 요청이 «열 색» — 기본은 열 전체
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const place = () => {
    const r = trigRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 248;
    // 아래 자리가 모자라면 버튼 위로 — 폰에서 표 버블이 화면 아래쪽이면 견본이 화면 밖으로 잘렸다(390 실측)
    const H = popRef.current?.offsetHeight || 190;
    const below = r.bottom + 8;
    const top = below + H > window.innerHeight - 8 && r.top - 8 - H >= 8 ? r.top - 8 - H : below;
    setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)) });
  };
  // 처음 열 때는 높이를 모른다 — 그려진 뒤 실제 높이로 한 번 더 맞춘다
  useLayoutEffect(() => { if (open) place(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const onDown = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (!trigRef.current?.contains(tg) && !popRef.current?.contains(tg)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEscapeStack(open, () => setOpen(false));

  const label = t('editor.table.fill', { defaultValue: '칸 색' }) as string;
  const curVal = CELL_FILLS.find((f) => f.key === current)?.value;
  return (
    <>
      <Trigger ref={trigRef} type="button" data-testid="editor-table-fill-open"
        aria-haspopup="true" aria-expanded={open} title={label} aria-label={label}
        onMouseDown={(e) => { e.preventDefault(); if (!open) place(); setOpen((v) => !v); }}>
        <Dot style={{ background: curVal || 'transparent' }} $none={!curVal} aria-hidden="true" />
        {label}
      </Trigger>
      {open && pos && createPortal(
        <Pop ref={popRef} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={label} data-testid="editor-table-fill-pop">
          <Sect>{t('editor.table.fillScope', { defaultValue: '칠할 범위' })}</Sect>
          <Seg role="radiogroup" aria-label={t('editor.table.fillScope', { defaultValue: '칠할 범위' }) as string}>
            {SCOPES.map((s) => (
              <SegBtn key={s} type="button" role="radio" aria-checked={scope === s} $on={scope === s}
                data-testid={`editor-table-fill-scope-${s}`}
                onMouseDown={(e) => { e.preventDefault(); setScope(s); }}>
                {t(`editor.table.fillScope_${s}`, { defaultValue: s === 'cell' ? '고른 칸' : s === 'col' ? '열 전체' : '행 전체' })}
              </SegBtn>
            ))}
          </Seg>
          <Sect>{t('editor.table.fillColor', { defaultValue: '색' })}</Sect>
          <FillSwatches current={current} testid="editor-table-fill" onPick={(item) => onPick(scope, item)} />
        </Pop>,
        document.body
      )}
    </>
  );
};

// 표 버블(어두운 바탕)의 다른 버튼(TableBubbleBtn)과 같은 모양
const Trigger = styled.button`
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: transparent; color: #E2E8F0;
  padding: 4px 8px; border-radius: 5px;
  font-size: 0.6875rem; font-weight: 700; cursor: pointer; white-space: nowrap;
  &:hover { background: #334155; color: #FFF; }
`;
const Dot = styled.span<{ $none?: boolean }>`
  width: 10px; aspect-ratio: 1 / 1; border-radius: 3px; flex-shrink: 0; box-sizing: border-box;   /* 장식 견본 */
  border: 1px solid ${(p) => (p.$none ? '#64748B' : 'rgba(255,255,255,0.6)')};
`;
const Pop = styled.div`
  position: fixed; z-index: 10000;  /* 메모 팝업(2301) 안 편집기에서도 위 — 서명 항목 메뉴와 같은 층 */
  width: 248px; max-width: calc(100vw - 32px); box-sizing: border-box;
  padding: 10px; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  display: flex; flex-direction: column; gap: 6px;
`;
const Sect = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B;`;
const Seg = styled.div`display: flex; gap: 2px; padding: 2px; background: #F1F5F9; border-radius: 8px;`;
const SegBtn = styled.button<{ $on?: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box; flex: 1; text-align: center;
  height: 32px; line-height: 32px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;
  color: ${(p) => (p.$on ? '#0F172A' : '#64748B')};
  background: ${(p) => (p.$on ? '#fff' : 'transparent')};
  box-shadow: ${(p) => (p.$on ? '0 1px 2px rgba(15,23,42,0.12)' : 'none')};
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const Swatches = styled.div`display: flex; flex-wrap: wrap; gap: 4px;`;
const Swatch = styled.button<{ $on?: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  width: 32px; height: 32px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  box-shadow: ${(p) => (p.$on ? '0 0 0 1px #14B8A6' : 'none')};
  &:hover { border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const SwFill = styled.span<{ $none?: boolean }>`
  width: 20px; aspect-ratio: 1 / 1; border-radius: 4px; box-sizing: border-box;   /* 장식 견본(컨트롤 아님) */
  border: 1px solid ${(p) => (p.$none ? '#CBD5E1' : 'rgba(15,23,42,0.08)')};
  ${(p) => (p.$none ? 'background-image: linear-gradient(135deg, transparent 45%, #DC2626 45%, #DC2626 55%, transparent 55%) !important;' : '')}
`;
