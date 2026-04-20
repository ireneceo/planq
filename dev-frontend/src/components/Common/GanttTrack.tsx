// 업무/프로젝트 공용 간트 트랙 프리미티브.
// ─── 목적 ───
// - 동일한 날짜 범위 위에 여러 행의 가로 스크롤을 한 번에 동기화
// - 스크롤바는 헤더(또는 지정한 마스터)에만 보이고 각 행은 숨김
// - 소비처: ProjectTaskList 인라인 타임라인 열, TasksTab 타임라인 뷰, 기타
//
// ─── 사용법 ───
// 1) 부모에서 useGanttScrollSync() 훅으로 registry 생성
// 2) <GanttHeader registry={registry} range={{ from, to }}> 로 눈금 + 마스터 스크롤바
// 3) <GanttRowTrack registry={registry} range={{ from, to }}> 로 각 행의 트랙
// 4) 범위는 부모에서 계산 (행별 start/end 모아서 최소/최대) 하여 일관되게 주입
import React, { useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';

export interface GanttRange { from: string; to: string; }

export interface GanttRegistry {
  register: (el: HTMLDivElement | null) => void;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
}

// 여러 스크롤 컨테이너의 scrollLeft 를 하나로 동기화.
export function useGanttScrollSync(): GanttRegistry {
  const setRef = useRef<Set<HTMLDivElement>>(new Set());
  const lastXRef = useRef(0);

  const register = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    setRef.current.add(el);
    if (el.scrollLeft !== lastXRef.current) el.scrollLeft = lastXRef.current;
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const src = e.currentTarget;
    const x = src.scrollLeft;
    if (Math.abs(lastXRef.current - x) < 1) return;
    lastXRef.current = x;
    setRef.current.forEach((el) => {
      if (el !== src && Math.abs(el.scrollLeft - x) > 0.5) el.scrollLeft = x;
    });
  }, []);

  useEffect(() => {
    const all = setRef.current;
    return () => { all.clear(); };
  }, []);

  return { register, onScroll };
}

// 날짜 범위 -> 스크롤 영역 총 너비 (px). 하루당 dayPx 로 보장.
export function ganttRangeMeta(range: GanttRange, dayPx = 30) {
  const a = new Date(range.from + 'T00:00:00Z').getTime();
  const b = new Date(range.to + 'T00:00:00Z').getTime();
  const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
  const pxWidth = Math.max(300, days * dayPx);
  const pctOfDate = (iso: string) => {
    const t = new Date(iso.slice(0, 10) + 'T00:00:00Z').getTime();
    return ((t - a) / 86400000 / days) * 100;
  };
  return { days, pxWidth, pctOfDate };
}

// 눈금 계산 — 'auto' 는 범위 길이에 따라 day/week/month 자동 선택.
export function computeTicks(range: GanttRange, mode: 'day' | 'week' | 'month' | 'auto' = 'auto') {
  const fromTime = new Date(range.from + 'T00:00:00Z').getTime();
  const toTime = new Date(range.to + 'T00:00:00Z').getTime();
  const days = Math.max(1, Math.round((toTime - fromTime) / 86400000) + 1);

  // auto 규칙: 14일 이하 = day, 60일 이하 = week, 그 외 = month
  const effective: 'day' | 'week' | 'month' = mode === 'auto'
    ? (days <= 14 ? 'day' : days <= 60 ? 'week' : 'month')
    : mode;

  const ticks: { date: string; label: string }[] = [];

  if (effective === 'month') {
    const [fy, fm] = range.from.split('-').map(Number);
    let cy = fy, cm = fm - 1;
    for (let i = 0; i < 48; i++) {
      const d = new Date(Date.UTC(cy, cm, 1));
      const iso = d.toISOString().slice(0, 10);
      if (d.getTime() > toTime + 86400000) break;
      if (iso >= range.from) ticks.push({ date: iso, label: `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}` });
      cm += 1; if (cm > 11) { cm = 0; cy += 1; }
    }
  } else {
    const step = effective === 'week' ? 7 : Math.max(1, Math.ceil(days / 8));
    for (let i = 0; i <= days - 1; i += step) {
      const d = new Date(fromTime + i * 86400000);
      ticks.push({ date: d.toISOString().slice(0, 10), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }
  }

  // 범위 시작·끝은 항상 포함 (빈 배열 방지 + 양 끝 라벨 보장)
  const endDate = new Date(toTime).toISOString().slice(0, 10);
  const endLabel = effective === 'month'
    ? `${endDate.slice(0, 7).replace('-', '.')}`
    : `${new Date(toTime).getUTCMonth() + 1}/${new Date(toTime).getUTCDate()}`;
  if (!ticks.some(t => t.date === range.from)) {
    const startLabel = effective === 'month'
      ? `${range.from.slice(0, 7).replace('-', '.')}`
      : `${new Date(fromTime).getUTCMonth() + 1}/${new Date(fromTime).getUTCDate()}`;
    ticks.unshift({ date: range.from, label: startLabel });
  }
  if (!ticks.some(t => t.date === endDate)) ticks.push({ date: endDate, label: endLabel });
  return ticks;
}

// 눈금 헤더 — 마스터 스크롤바 (보이는 스크롤바 하나).
interface HeaderProps {
  registry: GanttRegistry;
  range: GanttRange;
  dayPx?: number;
  tickMode?: 'day' | 'week' | 'month' | 'auto';
}
export const GanttHeader: React.FC<HeaderProps> = ({ registry, range, dayPx = 30, tickMode = 'auto' }) => {
  const { pxWidth, pctOfDate } = ganttRangeMeta(range, dayPx);
  const ticks = computeTicks(range, tickMode);
  return (
    <HeaderScroller ref={registry.register} onScroll={registry.onScroll}>
      <HeaderInner style={{ minWidth: pxWidth }}>
        {ticks.map((tk, idx) => {
          const leftPct = pctOfDate(tk.date);
          // 첫 번째 눈금은 왼쪽 정렬, 마지막은 오른쪽 정렬, 중간은 중앙 — 라벨이 잘리지 않게
          const align = idx === 0 ? 'start' : idx === ticks.length - 1 ? 'end' : 'center';
          return (
            <HeaderTick key={tk.date} style={{ left: `${leftPct}%` }} $align={align}>{tk.label}</HeaderTick>
          );
        })}
      </HeaderInner>
    </HeaderScroller>
  );
};

// 행 트랙 — 스크롤바 숨김. 아이들로 `<GanttBar>` 전달.
interface RowTrackProps {
  registry: GanttRegistry;
  range: GanttRange;
  dayPx?: number;
  height?: number;
  children?: React.ReactNode;
  showGrid?: boolean;
  todayStr?: string;
}
export const GanttRowTrack: React.FC<RowTrackProps> = ({ registry, range, dayPx = 30, height = 24, children, showGrid, todayStr }) => {
  const { pxWidth, pctOfDate } = ganttRangeMeta(range, dayPx);
  const ticks = showGrid ? computeTicks(range, 'auto') : [];
  const todayLeft = todayStr && todayStr >= range.from && todayStr <= range.to ? pctOfDate(todayStr) : null;
  return (
    <RowScroller ref={registry.register} onScroll={registry.onScroll}>
      <RowInner style={{ minWidth: pxWidth, height }}>
        {ticks.map((tk) => (<GridLine key={tk.date} style={{ left: `${pctOfDate(tk.date)}%` }} />))}
        {todayLeft != null && <TodayMarker style={{ left: `${todayLeft}%` }} />}
        {children}
      </RowInner>
    </RowScroller>
  );
};

// 바 — range 와 start/end 를 props 로 받아 스스로 position 계산.
interface BarProps {
  range: GanttRange;
  start: string | null;
  end: string | null;
  /** 파스텔 배경 (bg) — 기본 Teal 50 */
  bg?: string;
  /** 강조 색 (fg) — border + 텍스트 */
  fg?: string;
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}
export const GanttBar: React.FC<BarProps> = ({ range, start, end, bg = '#CCFBF1', fg = '#0F766E', label, onClick, title }) => {
  if (!start && !end) return null;
  const { pctOfDate } = ganttRangeMeta(range);
  const s = (start || end!).slice(0, 10);
  const e = (end || start!).slice(0, 10);
  const left = pctOfDate(s);
  const right = pctOfDate(e);
  const width = Math.max(1.5, right - left + (100 / Math.max(1, ganttRangeMeta(range).days)));
  return (
    <Bar style={{ left: `${left}%`, width: `${width}%`, background: bg, borderLeft: `3px solid ${fg}`, color: fg }} onClick={onClick} title={title}>
      {label && <BarLabel style={{ color: fg }}>{label}</BarLabel>}
    </Bar>
  );
};

// ─── styled ───
// `width:0;height:0` 기법으로 Chromium 에서 확실히 숨김.
const hideScrollbar = `
  scrollbar-width:none;
  -ms-overflow-style:none;
  &::-webkit-scrollbar{width:0;height:0;display:none;}
`;

const HeaderScroller = styled.div`
  width:100%;overflow-x:auto;overflow-y:hidden;
  scrollbar-width:thin;
  &::-webkit-scrollbar{height:6px;}
  &::-webkit-scrollbar-track{background:transparent;}
  &::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:3px;}
`;
const HeaderInner = styled.div`position:relative;height:26px;padding:0 2px;`;
const HeaderTick = styled.span<{ $align: 'start'|'center'|'end' }>`
  position:absolute;top:4px;font-size:11px;color:#64748B;font-weight:600;
  transform:translateX(${p => p.$align === 'start' ? '0' : p.$align === 'end' ? '-100%' : '-50%'});
  white-space:nowrap;pointer-events:none;
  &::before{
    content:'';position:absolute;
    left:${p => p.$align === 'start' ? '0' : p.$align === 'end' ? '100%' : '50%'};
    top:16px;width:1px;height:6px;background:#CBD5E1;
    transform:translateX(${p => p.$align === 'end' ? '0' : p.$align === 'start' ? '0' : '-50%'});
  }
`;

const RowScroller = styled.div`
  width:100%;overflow-x:auto;overflow-y:hidden;
  ${hideScrollbar}
`;
const RowInner = styled.div`
  position:relative;background:#F8FAFC;border-radius:4px;
`;
const GridLine = styled.span`
  position:absolute;top:0;bottom:0;width:1px;background:rgba(148,163,184,0.15);
`;
const TodayMarker = styled.span`
  position:absolute;top:0;bottom:0;width:1.5px;background:#F43F5E;
  &::before{content:'';position:absolute;top:-3px;left:-3px;width:7px;height:7px;border-radius:50%;background:#F43F5E;}
`;
const Bar = styled.div`
  position:absolute;top:2px;bottom:2px;border-radius:4px;
  display:flex;align-items:center;padding:0 6px;min-width:6px;overflow:hidden;
  cursor:pointer;transition:box-shadow 0.15s;
  &:hover{box-shadow:0 2px 8px rgba(15,23,42,0.10);}
`;
const BarLabel = styled.span`font-size:10px;font-weight:600;white-space:nowrap;`;
