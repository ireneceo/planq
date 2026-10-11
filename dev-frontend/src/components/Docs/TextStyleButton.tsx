// 글자 서식 버튼 + 팝오버(글자색 · 배경색 · 크기) — 문서 편집기 툴바와 표 문서 서식 줄이 **같은 것**을 쓴다 (2026-10-11)
//   ★ 버튼·칸은 mousedown 에서 preventDefault — 누르는 순간 편집기의 선택(고른 글자)이 풀리면 서식이 엉뚱한 곳에 걸린다.
//   ★ 팝오버는 body 로 포털한다 — 편집기 툴바는 sticky + z-index 로 **층을 만든다.** 그 안에서는 z 를 아무리 올려도
//     표 안 커서일 때 뜨는 검은 표 버블(--pq-z-editor-bubble)에 덮여, 색을 누르면 버블이 클릭을 먹었다(2026-10-11 실측).
//     바깥 클릭 판정은 버튼(wrap)과 팝오버(pop) **둘 다**를 안쪽으로 본다.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { TEXT_COLORS, HIGHLIGHTS, FONT_SIZES, type PaletteItem } from './textStylePalette';

export interface TextStyleKeys { color?: string | null; bg?: string | null; size?: string | null }

interface Props {
  current: TextStyleKeys;
  onPick: (kind: 'color' | 'bg' | 'size', item: PaletteItem) => void;
  disabled?: boolean;
  testid?: string;
  /** 툴바 버튼 모양 — 편집기 툴바(28px) / 표 서식 줄(32px) */
  size?: 'sm' | 'md';
}

const TextStyleButton: React.FC<Props> = ({ current, onPick, disabled, testid = 'text-style', size = 'sm' }) => {
  const { t } = useTranslation('qdocs');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const trigRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // 화면 기준(fixed)으로 띄운다 — 메모 팝업의 툴바는 가로 스크롤(overflow)이라 절대 위치면 메뉴가 잘린다
  //   (잘린 메뉴 = 눌러도 아무 일 없는 버튼, memory feedback_clipped_menu_reads_as_dead_button)
  const place = () => {
    const r = trigRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 256;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)) });
  };
  // 스크롤·크기 변경에는 닫지 말고 버튼을 따라간다 — 색을 고르면 편집기가 포커스를 받으며 스크롤해
  //   «색 고르고 이어서 크기» 를 하기도 전에 메뉴가 닫혔다(2026-10-11 실측)
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEscapeStack(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const tg = e.target as Node;
      if (!wrapRef.current?.contains(tg) && !popRef.current?.contains(tg)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const curColor = TEXT_COLORS.find((c) => c.key === (current.color || 'default'))?.value || '#0F172A';
  const label = t('editor.style.open', { defaultValue: '글자 색·크기' }) as string;
  const pick = (kind: 'color' | 'bg' | 'size', item: PaletteItem) => (e: React.MouseEvent) => {
    e.preventDefault();
    onPick(kind, item);
  };

  return (
    <Wrap ref={wrapRef}>
      <Trigger ref={trigRef} type="button" data-testid={`${testid}-open`} $size={size} $active={open} disabled={disabled}
        aria-haspopup="true" aria-expanded={open} title={label} aria-label={label}
        onMouseDown={(e) => { e.preventDefault(); if (disabled) return; if (!open) place(); setOpen((v) => !v); }}>
        <span aria-hidden="true">A</span>
        <ColorBar style={{ background: curColor }} aria-hidden="true" />
      </Trigger>
      {open && pos && createPortal(
        <Pop ref={popRef} style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={label} data-testid={`${testid}-pop`}>
          <Sect>{t('editor.style.colorLabel', { defaultValue: '글자색' })}</Sect>
          <Swatches>
            {TEXT_COLORS.map((c) => {
              const name = t(c.tk) as string;
              return (
                <Swatch key={c.key} type="button" data-testid={`${testid}-color-${c.key}`} title={name} aria-label={name}
                  aria-pressed={(current.color || 'default') === c.key} $on={(current.color || 'default') === c.key}
                  onMouseDown={pick('color', c)}>
                  <SwA style={{ color: c.value || '#0F172A' }}>A</SwA>
                </Swatch>
              );
            })}
          </Swatches>
          <Sect>{t('editor.style.bgLabel', { defaultValue: '배경색' })}</Sect>
          <Swatches>
            {HIGHLIGHTS.map((c) => {
              const name = t(c.tk) as string;
              return (
                <Swatch key={c.key} type="button" data-testid={`${testid}-bg-${c.key}`} title={name} aria-label={name}
                  aria-pressed={(current.bg || 'none') === c.key} $on={(current.bg || 'none') === c.key}
                  onMouseDown={pick('bg', c)}>
                  <SwBg style={{ background: c.value || '#fff' }} $none={!c.value} />
                </Swatch>
              );
            })}
          </Swatches>
          <Sect>{t('editor.style.sizeLabel', { defaultValue: '크기' })}</Sect>
          <Sizes>
            {FONT_SIZES.map((s) => (
              <SizeBtn key={s.key} type="button" data-testid={`${testid}-size-${s.key}`}
                aria-pressed={(current.size || 'normal') === s.key} $on={(current.size || 'normal') === s.key}
                onMouseDown={pick('size', s)}>
                {t(s.tk)}
              </SizeBtn>
            ))}
          </Sizes>
        </Pop>,
        document.body
      )}
    </Wrap>
  );
};

export default TextStyleButton;

const TOOLBAR_BTN = 28;   // PostEditor ToolBtn 높이와 같은 값
const Wrap = styled.div`position: relative; display: inline-flex; flex-shrink: 0;`;
const Trigger = styled.button<{ $size: 'sm' | 'md'; $active?: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  /* 툴바 버튼(ToolBtn)과 같은 높이 — 편집기 툴바 한 줄이 들쭉날쭉하지 않게 */
  min-width: ${(p) => (p.$size === 'md' ? 32 : TOOLBAR_BTN)}px;
  height: ${(p) => (p.$size === 'md' ? 32 : TOOLBAR_BTN)}px;
  padding: 0 6px; border-radius: 6px;
  display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  font-size: 0.8125rem; font-weight: 700; color: #475569; line-height: 1;
  background: ${(p) => (p.$active ? '#E2E8F0' : 'transparent')};
  &:hover:not(:disabled) { background: #E2E8F0; color: #0F172A; }
  &:disabled { opacity: 0.4; cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 2px; }
`;
const ColorBar = styled.span`display: block; width: 14px; height: 3px; border-radius: 2px;`;
const Pop = styled.div`
  position: fixed; z-index: 1200;
  width: 256px; max-width: calc(100vw - 32px); box-sizing: border-box;
  padding: 10px; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  display: flex; flex-direction: column; gap: 6px;
`;
const Sect = styled.div`font-size: 0.6875rem; font-weight: 700; color: #64748B;`;
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
const SwA = styled.span`font-size: 0.875rem; font-weight: 800;`;
const SwBg = styled.span<{ $none?: boolean }>`
  width: 18px; aspect-ratio: 1 / 1; border-radius: 4px; box-sizing: border-box;   /* 장식 견본(컨트롤 아님) */
  border: 1px solid ${(p) => (p.$none ? '#CBD5E1' : 'transparent')};
  ${(p) => (p.$none ? 'background-image: linear-gradient(135deg, transparent 45%, #DC2626 45%, #DC2626 55%, transparent 55%) !important;' : '')}
`;
const Sizes = styled.div`display: flex; gap: 4px; flex-wrap: wrap;`;
const SizeBtn = styled.button<{ $on?: boolean }>`
  all: unset; cursor: pointer; box-sizing: border-box;
  height: 32px; padding: 0 8px; border-radius: 6px; font-size: 0.75rem; font-weight: 600;
  color: ${(p) => (p.$on ? '#0F766E' : '#334155')};
  background: ${(p) => (p.$on ? '#F0FDFA' : '#fff')};
  border: 1px solid ${(p) => (p.$on ? '#14B8A6' : '#E2E8F0')};
  &:hover { border-color: #94A3B8; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
