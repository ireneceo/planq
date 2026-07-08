// #133 — 모바일 아젠다(리스트) 뷰. 폰에서 월/주 그리드 칩이 판독 불가한 문제 해소.
//   anchor 월의 이벤트 있는 날만 날짜별 그룹으로 세로 나열. 오늘 자동 스크롤. 빈 월 빈 상태.
//   데이터는 QCalendarPage 의 filteredEvents(events+tasks+personal 병합, RRULE 전개) 그대로 재사용.
import React, { useMemo, useRef, useLayoutEffect } from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, CalendarItem, PersonalCalendarEvent } from './types';
import { toDateKey, isSameDay, isSameMonth, startOfMonth, startOfDay, addMonths } from './dateUtils';
import { getEventColors } from './categoryColors';
import { isTaskEvent } from './taskToEvent';

interface Props {
  anchor: Date;
  today: Date;
  events: CalendarItem[];
  onSelectEvent: (id: number | string, instanceDate?: string) => void;
  onSelectDate: (date: Date) => void;
  onCreateAt: (d: Date) => void;
  loading: boolean;
}

const isPersonal = (e: CalendarItem): e is PersonalCalendarEvent =>
  (e as PersonalCalendarEvent)._source === 'personal_google';

// 날짜 키별 인덱스 — 멀티데이는 걸친 모든 날에 등장. 일자 내 정렬: 종일/task 먼저 → 시간 오름차순.
const indexByDayKey = (events: CalendarItem[]): Record<string, CalendarItem[]> => {
  const map: Record<string, CalendarItem[]> = {};
  events.forEach((e) => {
    const s = new Date(e.start_at);
    const en = new Date(e.end_at);
    const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    while (cur <= en) {
      const key = toDateKey(cur);
      (map[key] || (map[key] = [])).push(e);
      cur.setDate(cur.getDate() + 1);
    }
  });
  Object.values(map).forEach((list) => list.sort((a, b) => {
    const aAllDay = a.all_day || isTaskEvent(a);
    const bAllDay = b.all_day || isTaskEvent(b);
    if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
    return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
  }));
  return map;
};

const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const AgendaView: React.FC<Props> = ({ anchor, today, events, onSelectEvent, onSelectDate, onCreateAt, loading }) => {
  const { t, i18n } = useTranslation('qcalendar');
  const locale = i18n.language === 'en' ? 'en-US' : 'ko-KR';
  const eventMap = useMemo(() => indexByDayKey(events), [events]);

  // anchor 월의 1일~말일 순회, 이벤트 있는 날 + 오늘(이 달이면)만 그룹으로.
  const groups = useMemo(() => {
    const first = startOfMonth(anchor);
    const next = startOfMonth(addMonths(anchor, 1));
    const todayInMonth = isSameMonth(today, anchor);
    const todayKey = toDateKey(today);
    const out: Array<{ key: string; date: Date; items: CalendarItem[]; isToday: boolean }> = [];
    const cur = new Date(first);
    while (cur < next) {
      const key = toDateKey(cur);
      const items = eventMap[key] || [];
      const isToday = todayInMonth && key === todayKey;
      if (items.length > 0 || isToday) out.push({ key, date: new Date(cur), items, isToday });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [anchor, today, eventMap]);

  // 오늘로 자동 스크롤 — 월 바뀔 때 1회. useLayoutEffect 즉시(RAF 지연 금지 박제).
  const todayRef = useRef<HTMLDivElement>(null);
  const monthKey = toDateKey(startOfMonth(anchor));
  const scrolledFor = useRef<string>('');
  useLayoutEffect(() => {
    if (groups.length === 0) return;
    if (scrolledFor.current === monthKey) return;
    scrolledFor.current = monthKey;
    todayRef.current?.scrollIntoView({ block: 'start' });
  }, [monthKey, groups.length]);

  if (!loading && groups.length === 0) {
    return (
      <Empty>
        <EmptyIcon aria-hidden>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </EmptyIcon>
        <EmptyTitle>{t('agenda.empty', '이 달에는 일정이 없습니다')}</EmptyTitle>
        <EmptyHint>{t('agenda.emptyHint', '새 일정 버튼으로 일정을 추가해 보세요')}</EmptyHint>
      </Empty>
    );
  }

  return (
    <Wrap>
      {groups.map((g) => (
        <Group key={g.key} ref={g.isToday ? todayRef : undefined}>
          <DayHeader onClick={() => onSelectDate(g.date)}>
            <DateBadge $today={g.isToday} $isSaturday={g.date.getDay() === 6} $isSunday={g.date.getDay() === 0}>
              {g.date.getDate()}
            </DateBadge>
            <Weekday $isSaturday={g.date.getDay() === 6} $isSunday={g.date.getDay() === 0}>
              {new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(g.date)}
            </Weekday>
            {g.isToday && <TodayTag>{t('agenda.todayDivider', '오늘')}</TodayTag>}
            <MonthLabel>{new Intl.DateTimeFormat(locale, { month: 'short' }).format(g.date)}</MonthLabel>
            <AddBtn
              type="button"
              onClick={(e) => { e.stopPropagation(); const d = startOfDay(g.date); d.setHours(9, 0, 0, 0); onCreateAt(d); }}
              aria-label={t('agenda.addOnDay', '이 날짜에 일정 추가') as string}
              title={t('agenda.addOnDay', '이 날짜에 일정 추가') as string}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </AddBtn>
          </DayHeader>

          {g.items.length === 0 ? (
            <NoItems>{t('agenda.noneToday', '일정 없음')}</NoItems>
          ) : g.items.map((e) => {
            const c = getEventColors(e as CalendarEvent);
            const task = isTaskEvent(e);
            const personal = isPersonal(e);
            const isStartDay = isSameDay(new Date(e.start_at), g.date);
            const timeLabel = (e.all_day || task || !isStartDay)
              ? t('allDay', '종일')
              : `${fmtTime(e.start_at)} – ${fmtTime(e.end_at)}`;
            return (
              <Card
                key={`${task ? 't' : personal ? 'p' : 'e'}-${e.id}-${g.key}`}
                $border={c.border}
                onClick={() => onSelectEvent(e.id, e.start_at?.slice(0, 10))}
              >
                <CardTime>{timeLabel}</CardTime>
                <CardMain>
                  <CardTitle>
                    {task && (
                      <TaskIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></TaskIcon>
                    )}
                    {(e as CalendarEvent).visibility === 'personal' && (
                      <LockIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></LockIcon>
                    )}
                    <TitleText>{e.title}</TitleText>
                    {(e as { _is_exception?: boolean })._is_exception && (
                      <ExceptionMark title={t('exceptionMark', { defaultValue: '변경된 회차' }) as string}>✎</ExceptionMark>
                    )}
                    {personal && (
                      <ExtLink viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></ExtLink>
                    )}
                  </CardTitle>
                  {personal && (e as PersonalCalendarEvent).account_email && (
                    <CardSub>{(e as PersonalCalendarEvent).account_email}</CardSub>
                  )}
                  {!personal && (e as CalendarEvent).location && (
                    <CardSub>{(e as CalendarEvent).location}</CardSub>
                  )}
                </CardMain>
                <ColorBar $color={c.border} />
              </Card>
            );
          })}
        </Group>
      ))}
    </Wrap>
  );
};

export default AgendaView;

// ── styled ──
const Wrap = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  padding: 4px 0 calc(20px + env(safe-area-inset-bottom));
  max-width: 720px; width: 100%; margin: 0 auto;
`;
const Group = styled.div`
  scroll-margin-top: 8px;
`;
const DayHeader = styled.div`
  display: flex; align-items: center; gap: 8px;
  padding: 12px 8px 6px; cursor: pointer;
  border-bottom: 1px solid #F1F5F9;
`;
const DateBadge = styled.div<{ $today: boolean; $isSaturday: boolean; $isSunday: boolean }>`
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 26px; padding: 0 7px; border-radius: 999px;
  font-size: 14px; font-weight: 700;
  background: ${({ $today }) => $today ? '#14B8A6' : 'transparent'};
  color: ${({ $today, $isSunday, $isSaturday }) => $today ? '#fff' : $isSunday ? '#BE123C' : $isSaturday ? '#1D4ED8' : '#0F172A'};
`;
const Weekday = styled.span<{ $isSaturday: boolean; $isSunday: boolean }>`
  font-size: 13px; font-weight: 600;
  color: ${({ $isSunday, $isSaturday }) => $isSunday ? '#BE123C' : $isSaturday ? '#1D4ED8' : '#475569'};
`;
const TodayTag = styled.span`
  font-size: 11px; font-weight: 700; color: #0F766E;
  background: #F0FDFA; border: 1px solid #99F6E4; border-radius: 999px; padding: 1px 8px;
`;
const MonthLabel = styled.span`font-size: 12px; color: #94A3B8; margin-left: 2px;`;
const AddBtn = styled.button`
  margin-left: auto; width: 36px; height: 36px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid #E2E8F0; border-radius: 8px; color: #64748B; cursor: pointer;
  &:hover { background: #F0FDFA; border-color: #5EEAD4; color: #0F766E; }
`;
const NoItems = styled.div`font-size: 12px; color: #CBD5E1; padding: 8px 12px 10px;`;
const Card = styled.div<{ $border: string }>`
  position: relative; display: flex; align-items: flex-start; gap: 12px;
  min-height: 44px; padding: 10px 12px; margin: 4px 0;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; cursor: pointer;
  transition: background 0.1s ease, border-color 0.1s ease;
  &:hover { background: #F8FAFC; border-color: #CBD5E1; }
`;
const ColorBar = styled.span<{ $color: string }>`
  position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px; border-radius: 0 4px 4px 0;
  background: ${({ $color }) => $color};
`;
const CardTime = styled.div`
  flex-shrink: 0; min-width: 84px; padding-left: 6px;
  font-size: 12px; font-weight: 600; color: #475569; font-variant-numeric: tabular-nums;
  line-height: 1.5;
`;
const CardMain = styled.div`flex: 1; min-width: 0;`;
const CardTitle = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-size: 14px; font-weight: 600; color: #0F172A; line-height: 1.4;
`;
const TitleText = styled.span`overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;`;
const CardSub = styled.div`font-size: 12px; color: #94A3B8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const TaskIcon = styled.svg`width: 13px; height: 13px; flex-shrink: 0; color: #0F766E;`;
const LockIcon = styled.svg`width: 12px; height: 12px; flex-shrink: 0; color: #94A3B8;`;
const ExtLink = styled.svg`width: 12px; height: 12px; flex-shrink: 0; color: #7C3AED;`;
const ExceptionMark = styled.span`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 4px; min-width: 14px; height: 14px; flex-shrink: 0;
  background: #FEF3C7; color: #92400E; border-radius: 4px; font-size: 10px; font-weight: 700; line-height: 1;
`;
const Empty = styled.div`
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 64px 20px; text-align: center; color: #94A3B8;
`;
const EmptyIcon = styled.div`color: #CBD5E1;`;
const EmptyTitle = styled.div`font-size: 15px; font-weight: 600; color: #475569;`;
const EmptyHint = styled.div`font-size: 13px; color: #94A3B8;`;
