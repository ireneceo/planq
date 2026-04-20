import React, { useEffect, useMemo, useRef } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, CalendarItem } from './types';
import { clipEventToDay, eventOverlapsDay, formatTime, isSameDay, startOfDay } from './dateUtils';
import { getEventColors } from './categoryColors';
import { isTaskEvent } from './taskToEvent';

interface Props {
  anchor: Date; // 주 뷰면 주의 시작일, 일 뷰면 그 날짜
  today: Date;
  days: Date[]; // 1 (day) or 7 (week)
  events: CalendarItem[];
  onSelectEvent: (id: number) => void;
  onSelectDate: (date: Date) => void;
}

const HOUR_HEIGHT = 48; // 1 hour = 48px
const TIME_COL_WIDTH = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const TimeGridView: React.FC<Props> = ({ today, days, events, onSelectEvent, onSelectDate }) => {
  const { t } = useTranslation('qcalendar');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 처음 렌더 시 08:00 위치로 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT;
    }
  }, []);

  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // 전일 이벤트와 시간 이벤트 분리
  const dayBuckets = useMemo(() => {
    return days.map((day) => {
      const allDay: CalendarItem[] = [];
      const timed: CalendarItem[] = [];
      events.forEach((e) => {
        if (!eventOverlapsDay(e.start_at, e.end_at, day)) return;
        const s = new Date(e.start_at);
        const en = new Date(e.end_at);
        const sameDay = isSameDay(s, en);
        if (e.all_day || !sameDay) allDay.push(e);
        else timed.push(e);
      });
      return { day, allDay, timed };
    });
  }, [days, events]);

  const maxAllDayRows = Math.max(1, ...dayBuckets.map((b) => b.allDay.length));

  // 현재 시각 라인 (오늘 컬럼에만)
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nowTop = (nowMinutes / 60) * HOUR_HEIGHT;

  return (
    <Wrap>
      {/* Header row: empty corner + day labels */}
      <HeaderRow>
        <CornerCell />
        <DayHeaders $cols={days.length}>
          {days.map((d) => {
            const isToday = isSameDay(d, today);
            const wd = weekdayKeys[d.getDay()];
            return (
              <DayHeaderCell
                key={d.toISOString()}
                $today={isToday}
                $isSaturday={d.getDay() === 6}
                $isSunday={d.getDay() === 0}
                onClick={() => onSelectDate(d)}
              >
                <DayLabel $today={isToday}>{t(`weekday.${wd}`)}</DayLabel>
                <DateNumber $today={isToday}>{d.getDate()}</DateNumber>
              </DayHeaderCell>
            );
          })}
        </DayHeaders>
      </HeaderRow>

      {/* All-day band */}
      <AllDayRow>
        <AllDayLabel>{t('allDay')}</AllDayLabel>
        <AllDayCells $cols={days.length}>
          {dayBuckets.map(({ day, allDay }) => (
            <AllDayCell key={day.toISOString()}>
              {allDay.map((e) => {
                const c = getEventColors(e as CalendarEvent);
                const isTask = isTaskEvent(e);
                return (
                  <AllDayChip
                    key={`${isTask ? 't' : 'e'}-${e.id}`}
                    $bg={c.bg}
                    $fg={c.fg}
                    $border={c.border}
                    onClick={() => onSelectEvent(e.id)}
                  >
                    {isTask && '✓ '}{e.title}
                  </AllDayChip>
                );
              })}
              {Array.from({ length: Math.max(0, maxAllDayRows - allDay.length) }).map((_, i) => (
                <AllDayChipPlaceholder key={`ph-${i}`} />
              ))}
            </AllDayCell>
          ))}
        </AllDayCells>
      </AllDayRow>

      {/* Scrollable time grid */}
      <ScrollArea ref={scrollRef}>
        <GridBody>
          <TimeColumn>
            {HOURS.map((h) => (
              <TimeSlot key={h}>
                <TimeLabel>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</TimeLabel>
              </TimeSlot>
            ))}
          </TimeColumn>
          <DayColumns $cols={days.length}>
            {dayBuckets.map(({ day, timed }) => {
              const isToday = isSameDay(day, today);
              return (
                <DayColumn key={day.toISOString()}>
                  {/* hour grid lines */}
                  {HOURS.map((h) => (
                    <HourLine key={h} $hour={h} />
                  ))}
                  {/* now indicator */}
                  {isToday && (
                    <NowLine style={{ top: nowTop }}>
                      <NowDot />
                    </NowLine>
                  )}
                  {/* events */}
                  {timed.map((e) => {
                    const { start, end } = clipEventToDay(e.start_at, e.end_at, day);
                    const dayStart = startOfDay(day).getTime();
                    const topMin = (start.getTime() - dayStart) / 60000;
                    const durMin = Math.max(20, (end.getTime() - start.getTime()) / 60000);
                    const c = getEventColors(e as CalendarEvent);
                    const isTask = isTaskEvent(e);
                    return (
                      <TimeEvent
                        key={`${isTask ? 't' : 'e'}-${e.id}`}
                        style={{
                          top: (topMin / 60) * HOUR_HEIGHT,
                          height: (durMin / 60) * HOUR_HEIGHT,
                        }}
                        $bg={c.bg}
                        $fg={c.fg}
                        $border={c.border}
                        onClick={() => onSelectEvent(e.id)}
                      >
                        <EventHeader>
                          <EventTitle>{e.title}</EventTitle>
                        </EventHeader>
                        <EventMeta>{formatTime(start)} – {formatTime(end)}</EventMeta>
                        {e.location && <EventMeta>· {e.location}</EventMeta>}
                      </TimeEvent>
                    );
                  })}
                </DayColumn>
              );
            })}
          </DayColumns>
        </GridBody>
      </ScrollArea>
    </Wrap>
  );
};

export default TimeGridView;

// ── styled ──
const Wrap = styled.div`
  display: flex; flex-direction: column; height: 100%; width: 100%; flex: 1; min-width: 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden;
`;
const HeaderRow = styled.div`
  display: flex; border-bottom: 1px solid #E2E8F0; background: #fff;
`;
const CornerCell = styled.div`
  width: ${TIME_COL_WIDTH}px; flex-shrink: 0;
  border-right: 1px solid #EEF2F6;
`;
const DayHeaders = styled.div<{ $cols: number }>`
  display: grid; flex: 1;
  grid-template-columns: repeat(${({ $cols }) => $cols}, 1fr);
`;
const DayHeaderCell = styled.div<{ $today: boolean; $isSaturday: boolean; $isSunday: boolean }>`
  padding: 10px 8px; text-align: center; cursor: pointer;
  border-right: 1px solid #EEF2F6;
  &:last-child { border-right: none; }
  &:hover { background: #F8FAFC; }
`;
const DayLabel = styled.div<{ $today: boolean }>`
  font-size: 11px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
  color: ${({ $today }) => $today ? '#14B8A6' : '#64748B'};
  margin-bottom: 4px;
`;
const DateNumber = styled.div<{ $today: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 28px; height: 28px; border-radius: 999px;
  font-size: 16px; font-weight: 700;
  background: ${({ $today }) => $today ? '#14B8A6' : 'transparent'};
  color: ${({ $today }) => $today ? '#fff' : '#0F172A'};
`;

const AllDayRow = styled.div`
  display: flex; border-bottom: 1px solid #E2E8F0; background: #FAFBFC;
  min-height: 34px;
`;
const AllDayLabel = styled.div`
  width: ${TIME_COL_WIDTH}px; flex-shrink: 0; border-right: 1px solid #EEF2F6;
  font-size: 10px; font-weight: 500; color: #94A3B8; letter-spacing: 0.3px;
  display: flex; align-items: center; justify-content: center;
  text-transform: uppercase;
`;
const AllDayCells = styled.div<{ $cols: number }>`
  display: grid; flex: 1;
  grid-template-columns: repeat(${({ $cols }) => $cols}, 1fr);
`;
const AllDayCell = styled.div`
  padding: 4px 4px; display: flex; flex-direction: column; gap: 2px;
  border-right: 1px solid #EEF2F6; min-height: 30px;
  &:last-child { border-right: none; }
`;
const AllDayChip = styled.div<{ $bg: string; $fg: string; $border: string }>`
  padding: 3px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 500;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  border-left: 3px solid ${({ $border }) => $border};
  cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
`;
const AllDayChipPlaceholder = styled.div` height: 22px; `;

const ScrollArea = styled.div`
  flex: 1; overflow-y: auto; overflow-x: hidden; min-height: 0;
`;
const GridBody = styled.div`
  display: flex; position: relative;
`;
const TimeColumn = styled.div`
  width: ${TIME_COL_WIDTH}px; flex-shrink: 0;
  border-right: 1px solid #EEF2F6; background: #fff;
`;
const TimeSlot = styled.div`
  height: ${HOUR_HEIGHT}px; position: relative;
`;
const TimeLabel = styled.div`
  position: absolute; top: -7px; right: 6px;
  font-size: 10.5px; font-weight: 500; color: #94A3B8;
  font-variant-numeric: tabular-nums;
`;
const DayColumns = styled.div<{ $cols: number }>`
  display: grid; flex: 1;
  grid-template-columns: repeat(${({ $cols }) => $cols}, 1fr);
`;
const DayColumn = styled.div`
  position: relative; border-right: 1px solid #EEF2F6;
  &:last-child { border-right: none; }
`;
const HourLine = styled.div<{ $hour: number }>`
  position: absolute; left: 0; right: 0;
  top: ${({ $hour }) => $hour * HOUR_HEIGHT}px;
  height: ${HOUR_HEIGHT}px;
  border-top: 1px solid #F1F5F9;
`;
const NowLine = styled.div`
  position: absolute; left: 0; right: 0; height: 0; z-index: 5;
  border-top: 1.5px solid #F43F5E;
  pointer-events: none;
`;
const NowDot = styled.div`
  position: absolute; left: -5px; top: -4.5px;
  width: 9px; height: 9px; border-radius: 50%;
  background: #F43F5E;
`;
const TimeEvent = styled.div<{ $bg: string; $fg: string; $border: string }>`
  position: absolute; left: 2px; right: 2px;
  padding: 4px 7px; border-radius: 6px;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  border-left: 3px solid ${({ $border }) => $border};
  font-size: 11.5px; line-height: 1.35;
  cursor: pointer; overflow: hidden;
  transition: filter 0.1s ease;
  &:hover { filter: brightness(0.97); }
`;
const EventHeader = styled.div` display: flex; align-items: center; `;
const EventTitle = styled.div`
  font-weight: 600; font-size: 12px; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis;
`;
const EventMeta = styled.div`
  opacity: 0.85; font-size: 11px; overflow: hidden;
  white-space: nowrap; text-overflow: ellipsis;
`;
