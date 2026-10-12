// 월 보기 날짜 호버 카드 — 일정이 있는 날 위에 마우스를 잠시 두면 칸 옆에 그 날 일정을 크게 보여 준다 (2026-10-12).
//   Irene: *"캘린더 해당 날짜에 마우스 오버하면 그 날 일정 좀 크게 확대해서 보이면 어때? 그리고 클릭할 수 있게 하고."*
//
// - **마우스일 때만**(pointerType === 'mouse'). 폰·태블릿 탭은 지금처럼 칸 = 그 날 보기, +N = 더보기 창.
//   ★ `(hover:none)` 미디어쿼리로 가르지 않는다 — 헤드리스가 hover:none 으로 떠서 그 분기가 영원히 미측정이 된다(CLAUDE.md Q file 절).
// - 지나가는 마우스에 번쩍이지 않게 350ms 뒤에 연다 · 칸을 떠나도 150ms 유예(카드로 옮겨 가는 사이 닫히지 않게).
// - 배경 막·스크롤 잠금 없음(곁 미리보기). 격자·창이 스크롤하면 닫는다(자리가 어긋난 카드를 남기지 않는다). Esc 로 닫힌다.
// - 목록 모양은 «+N 더보기» 창과 같은 `DayEventsBody`.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useEscapeStack } from '../../hooks/useEscapeStack';
import { CardShell, DayEventsBody } from './DayEventsCard';
import type { CalendarItem } from './types';

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
const CARD_W = 320;
const GAP = 8;
const PAD = 12;

export function useDayHoverCard(disabled: boolean) {
  const [hover, setHover] = useState<{ key: string; day: Date; rect: DOMRect } | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const clear = (r: React.MutableRefObject<number | null>) => { if (r.current) { window.clearTimeout(r.current); r.current = null; } };

  const close = useCallback(() => { clear(openTimer); clear(closeTimer); setHover(null); }, []);
  /** 칸에 마우스가 들어왔다 — 일정이 있는 날만 부른다 */
  const enterCell = useCallback((e: React.PointerEvent<HTMLElement>, key: string, day: Date) => {
    if (disabled || e.pointerType !== 'mouse') return;
    clear(closeTimer); clear(openTimer);
    const el = e.currentTarget;
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      setHover({ key, day, rect: el.getBoundingClientRect() });
    }, OPEN_DELAY);
  }, [disabled]);
  const leave = useCallback(() => {
    clear(openTimer);
    clear(closeTimer);
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setHover(null); }, CLOSE_DELAY);
  }, []);
  const keep = useCallback(() => { clear(closeTimer); }, []);

  useEffect(() => { if (disabled) close(); }, [disabled, close]);
  useEffect(() => () => { clear(openTimer); clear(closeTimer); }, []);
  // 스크롤하면 닫는다(캡처 — 격자 안 스크롤도 잡힌다). 카드 안 목록 스크롤은 제외.
  useEffect(() => {
    if (!hover) return;
    const onScroll = (ev: Event) => {
      const tgt = ev.target as Element | null;
      if (tgt && tgt instanceof Element && tgt.closest('[data-testid="calendar-day-hovercard"]')) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
  }, [hover, close]);
  useEscapeStack(!!hover, close);

  return { hover, enterCell, leave, keep, close };
}

interface CardProps {
  rect: DOMRect;
  title: string;
  events: CalendarItem[];
  now: Date;
  onSelectEvent: (e: CalendarItem) => void;
  onOpenDay: () => void;
  onCreate?: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

export const DayHoverCard: React.FC<CardProps> = ({ rect, onPointerEnter, onPointerLeave, ...body }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // 측정은 커밋 직후 바로(운영 안정성 12 — RAF 지연 금지). 칸 오른쪽, 자리가 없으면 왼쪽. 아래로 넘치면 위로 접는다.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(CARD_W, vw - PAD * 2);
    let left = rect.right + GAP;
    if (left + w > vw - PAD) left = rect.left - GAP - w;
    left = Math.max(PAD, Math.min(left, vw - PAD - w));
    const top = Math.max(PAD, Math.min(rect.top, vh - PAD - h));
    setPos({ top, left });
  }, [rect, body.events.length]);
  return (
    <Card ref={ref} role="dialog" aria-label={body.title} data-testid="calendar-day-hovercard"
      style={{ top: pos?.top ?? rect.top, left: pos?.left ?? rect.right + GAP, visibility: pos ? 'visible' : 'hidden' }}
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <DayEventsBody {...body} />
    </Card>
  );
};

const Card = styled(CardShell)`
  width: ${CARD_W}px; max-height: 60vh;
`;
