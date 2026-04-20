import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, CalendarItem } from './types';
import { getMonthGridDays, isSameMonth, isSameDay, toDateKey } from './dateUtils';
import { getEventColors } from './categoryColors';
import { isTaskEvent } from './taskToEvent';

// 날짜 키 별 인덱스 — 멀티데이 이벤트는 걸친 모든 날짜에 등장
const indexByDayKey = (events: CalendarItem[]): Record<string, CalendarItem[]> => {
  const map: Record<string, CalendarItem[]> = {};
  events.forEach((e) => {
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    while (cur <= en) {
      const key = toDateKey(cur);
      if (!map[key]) map[key] = [];
      map[key].push(e);
      cur.setDate(cur.getDate() + 1);
    }
  });
  Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()));
  return map;
};

interface Props {
  anchor: Date;
  today: Date;
  events: CalendarItem[];
  onSelectEvent: (id: number) => void;
  onSelectDate: (date: Date) => void;
}

const MAX_VISIBLE = 3;

const MonthView: React.FC<Props> = ({ anchor, today, events, onSelectEvent, onSelectDate }) => {
  const { t, i18n } = useTranslation('qcalendar');
  const days = useMemo(() => getMonthGridDays(anchor, 0), [anchor]);
  const eventMap = useMemo(() => indexByDayKey(events), [events]);
  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // "+N 더보기" 팝오버 — 해당 날짜 전체 이벤트 리스트
  const [popoverDay, setPopoverDay] = useState<Date | null>(null);
  const popoverEvents = popoverDay ? eventMap[toDateKey(popoverDay)] || [] : [];
  const popoverTitle = popoverDay
    ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-US' : 'ko-KR', {
        month: 'long', day: 'numeric', weekday: 'short',
      }).format(popoverDay)
    : '';

  return (
    <Wrap>
      <Weekdays>
        {weekdayKeys.map((k, i) => (
          <WeekdayCell key={k} $isSaturday={i === 6} $isSunday={i === 0}>
            {t(`weekday.${k}`)}
          </WeekdayCell>
        ))}
      </Weekdays>
      <Grid>
        {days.map((day, idx) => {
          const key = toDateKey(day);
          const list = eventMap[key] || [];
          const inMonth = isSameMonth(day, anchor);
          const isToday = isSameDay(day, today);
          const visible = list.slice(0, MAX_VISIBLE);
          const hidden = list.length - visible.length;

          return (
            <Cell
              key={idx}
              $outMonth={!inMonth}
              $today={isToday}
              onClick={() => onSelectDate(day)}
            >
              <DateBadge $today={isToday} $isSaturday={day.getDay() === 6} $isSunday={day.getDay() === 0}>
                {day.getDate()}
              </DateBadge>
              <EventList>
                {visible.map((e) => {
                  const c = getEventColors(e as CalendarEvent);
                  const isStart = isSameDay(new Date(e.start_at), day);
                  const isTask = isTaskEvent(e);
                  return (
                    <EventChip
                      key={`${isTask ? 't' : 'e'}-${e.id}-${key}`}
                      $bg={c.bg}
                      $fg={c.fg}
                      $border={c.border}
                      $allDay={e.all_day || !isSameDay(new Date(e.start_at), new Date(e.end_at))}
                      onClick={(ev) => { ev.stopPropagation(); onSelectEvent(e.id); }}
                      title={e.title}
                    >
                      {isTask && (
                        <TaskIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="9 11 12 14 22 4" />
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </TaskIcon>
                      )}
                      {!isTask && !e.all_day && isStart && <Dot $color={c.fg} />}
                      <ChipTitle>
                        {!isTask && !e.all_day && isStart && (
                          <ChipTime>{formatChipTime(e.start_at)}</ChipTime>
                        )}
                        {e.title}
                      </ChipTitle>
                    </EventChip>
                  );
                })}
              </EventList>
              {hidden > 0 && (
                <MoreLinkWrap>
                  <MoreLink
                    onClick={(ev) => { ev.stopPropagation(); setPopoverDay(day); }}
                  >
                    {t('more', { count: hidden })}
                  </MoreLink>
                </MoreLinkWrap>
              )}
            </Cell>
          );
        })}
      </Grid>

      {popoverDay && (
        <>
          <PopoverBackdrop onClick={() => setPopoverDay(null)} />
          <PopoverCard role="dialog" aria-label={popoverTitle}>
            <PopoverHeader>
              <PopoverTitle>{popoverTitle}</PopoverTitle>
              <PopoverClose onClick={() => setPopoverDay(null)} aria-label="close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </PopoverClose>
            </PopoverHeader>
            <PopoverList>
              {popoverEvents.map((e) => {
                const c = getEventColors(e as CalendarEvent);
                const isTask = isTaskEvent(e);
                return (
                  <PopoverItem
                    key={`pop-${isTask ? 't' : 'e'}-${e.id}`}
                    $bg={c.bg}
                    $fg={c.fg}
                    $border={c.border}
                    onClick={() => { onSelectEvent(e.id); setPopoverDay(null); }}
                  >
                    <PopoverItemTime>
                      {e.all_day ? t('allDay') : formatChipTime(e.start_at)}
                    </PopoverItemTime>
                    <PopoverItemTitle>
                      {isTask && (
                        <TaskIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="9 11 12 14 22 4" />
                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                        </TaskIcon>
                      )}
                      {e.title}
                    </PopoverItemTitle>
                  </PopoverItem>
                );
              })}
            </PopoverList>
          </PopoverCard>
        </>
      )}
    </Wrap>
  );
};

const formatChipTime = (iso: string): string => {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  if (m === 0) return `${h}시`;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export default MonthView;

// ── styled ──
const Wrap = styled.div`
  display: flex; flex-direction: column; height: 100%; width: 100%; flex: 1; min-width: 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;
  position: relative;
`;
const Weekdays = styled.div`
  display: grid; grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid #E2E8F0; background: #F8FAFC;
`;
const WeekdayCell = styled.div<{ $isSaturday: boolean; $isSunday: boolean }>`
  padding: 10px 12px; font-size: 12px; font-weight: 600; letter-spacing: -0.1px;
  color: ${({ $isSunday, $isSaturday }) => $isSunday ? '#BE123C' : $isSaturday ? '#1D4ED8' : '#475569'};
  text-align: center;
`;
const Grid = styled.div`
  display: grid; grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: minmax(112px, 1fr);
  flex: 1; min-height: 0; overflow-y: auto;
`;
const Cell = styled.div<{ $outMonth: boolean; $today: boolean }>`
  position: relative; border-right: 1px solid #EEF2F6; border-bottom: 1px solid #EEF2F6;
  padding: 6px 6px 4px; cursor: pointer;
  background: ${({ $today }) => $today ? '#F0FDFA' : '#fff'};
  color: ${({ $outMonth }) => $outMonth ? '#94A3B8' : '#0F172A'};
  overflow: hidden;
  display: flex; flex-direction: column;
  &:nth-child(7n) { border-right: none; }
  &:hover { background: ${({ $today }) => $today ? '#ECFDF5' : '#F8FAFC'}; }
`;
const DateBadge = styled.div<{ $today: boolean; $isSaturday: boolean; $isSunday: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px;
  font-size: 12px; font-weight: 600; margin-bottom: 2px;
  background: ${({ $today }) => $today ? '#14B8A6' : 'transparent'};
  color: ${({ $today, $isSunday, $isSaturday }) =>
    $today ? '#fff' : $isSunday ? '#BE123C' : $isSaturday ? '#1D4ED8' : '#0F172A'};
`;
const EventList = styled.div`
  display: flex; flex-direction: column; gap: 2px;
  flex: 1; min-height: 0;
`;
const MoreLinkWrap = styled.div`
  margin-top: auto; flex-shrink: 0;
`;
const EventChip = styled.div<{ $bg: string; $fg: string; $border: string; $allDay: boolean }>`
  display: flex; align-items: center; gap: 4px;
  padding: 2px 6px; border-radius: 4px;
  font-size: 11.5px; font-weight: 500; line-height: 1.3;
  background: ${({ $bg, $allDay }) => $allDay ? $bg : 'transparent'};
  color: ${({ $fg }) => $fg};
  border-left: ${({ $allDay, $border }) => $allDay ? `3px solid ${$border}` : 'none'};
  cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  transition: background 0.1s ease;
  &:hover { background: ${({ $bg }) => $bg}; }
`;
const Dot = styled.span<{ $color: string }>`
  width: 6px; height: 6px; border-radius: 50%;
  background: ${({ $color }) => $color}; flex-shrink: 0;
`;
const TaskIcon = styled.svg`
  width: 11px; height: 11px; flex-shrink: 0;
`;
const ChipTitle = styled.span`
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
`;
const ChipTime = styled.span`
  opacity: 0.7; margin-right: 4px; font-variant-numeric: tabular-nums;
`;
const MoreLink = styled.div`
  font-size: 11px; font-weight: 600; color: #14B8A6;
  padding: 2px 6px; cursor: pointer;
  &:hover { text-decoration: underline; }
`;

// ── 더보기 팝오버 ──
const PopoverBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.08); z-index: 55;
`;
const PopoverCard = styled.div`
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 400px; max-width: calc(100vw - 32px); max-height: 70vh;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.16);
  display: flex; flex-direction: column; overflow: hidden;
  z-index: 60;
`;
const PopoverHeader = styled.div`
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid #EEF2F6;
`;
const PopoverTitle = styled.div`
  font-size: 14px; font-weight: 700; color: #0F172A;
`;
const PopoverClose = styled.button`
  width: 28px; height: 28px; border: none; background: transparent; color: #64748B;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const PopoverList = styled.div`
  flex: 1; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 4px;
`;
const PopoverItem = styled.div<{ $bg: string; $fg: string; $border: string }>`
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  border-left: 3px solid ${({ $border }) => $border};
  cursor: pointer; font-size: 13px;
  transition: filter 0.12s ease;
  &:hover { filter: brightness(0.96); }
`;
const PopoverItemTime = styled.div`
  flex-shrink: 0; font-size: 11.5px; font-weight: 600; opacity: 0.85;
  font-variant-numeric: tabular-nums; min-width: 48px;
`;
const PopoverItemTitle = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1;
`;
