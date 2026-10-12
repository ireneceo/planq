// 그 날 일정 전체 목록 카드 — 월 보기의 «+N 더보기» 창과 날짜 호버 카드가 **같은 것**을 쓴다 (2026-10-12).
//   Irene: *"캘린더 해당 날짜에 마우스 오버하면 그 날 일정 좀 크게 확대해서 보이면 어때? 그리고 클릭할 수 있게 하고."*
//   목록 모양을 두 벌로 두면 한쪽만 고쳐진다(CLAUDE.md «껍데기는 빼서 같이 쓴다»). 머리줄 날짜를 누르면 그 날(일) 보기로 간다.
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent, CalendarItem } from './types';
import { getEventColors } from './categoryColors';
import { bookingAttr, bookingCss, BookingTag } from './bookingLook';
import { pastAttr, pastCss } from './pastLook';
import { isTaskEvent } from './taskToEvent';
import { linkLine } from './linkLine';

export const formatChipTime = (iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string => {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  if (m === 0) return t('chipTimeHour', { defaultValue: '{{hour}}시', hour: h });
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

interface Props {
  title: string;
  events: CalendarItem[];
  now: Date;
  onSelectEvent: (e: CalendarItem) => void;
  /** 머리줄 날짜 → 그 날 보기 */
  onOpenDay?: () => void;
  /** 그 날 새 일정 */
  onCreate?: () => void;
  onClose?: () => void;
}

export const DayEventsBody: React.FC<Props> = ({ title, events, now, onSelectEvent, onOpenDay, onCreate, onClose }) => {
  const { t } = useTranslation('qcalendar');
  return (
    <>
      <CardHead>
        {onOpenDay ? (
          <TitleBtn type="button" onClick={onOpenDay} data-testid="calendar-day-card-open-day"
            title={t('month.openDay', '이 날 보기로') as string}>{title}</TitleBtn>
        ) : <Title>{title}</Title>}
        <HeadActions>
          {onCreate && (
            <IconBtn type="button" onClick={onCreate} aria-label={t('month.createOn', '이 날짜에 일정 추가') as string}
              title={t('month.createOn', '이 날짜에 일정 추가') as string}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </IconBtn>
          )}
          {onClose && (
            <IconBtn type="button" onClick={onClose} aria-label={t('close', '닫기') as string}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </IconBtn>
          )}
        </HeadActions>
      </CardHead>
      <List>
        {events.map((e) => {
          const c = getEventColors(e as CalendarEvent);
          const isTask = isTaskEvent(e);
          return (
            <Item
              key={`pop-${isTask ? 't' : 'e'}-${e.id}`}
              $bg={c.bg} $fg={c.fg} $border={c.border}
              data-testid={isTask ? 'calendar-task' : 'calendar-event'}
              data-booking={bookingAttr(e as CalendarEvent)}
              data-past={pastAttr(e, now)}
              onClick={() => onSelectEvent(e)}
            >
              <ItemTime>{e.all_day ? t('allDay') : formatChipTime(e.start_at, t)}</ItemTime>
              <ItemTitle>
                <BookingTag e={e as CalendarEvent} />
                {isTask && (
                  <TaskIcon viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </TaskIcon>
                )}
                <ItemText>{e.title}</ItemText>
                {linkLine(e, t) && <ItemLink>{linkLine(e, t)}</ItemLink>}
              </ItemTitle>
            </Item>
          );
        })}
      </List>
    </>
  );
};

// 카드 껍데기 — 더보기(가운데)와 호버(칸 옆)가 모양을 나눈다. 자리만 다르다.
export const CardShell = styled.div`
  position: fixed;
  width: 400px; max-width: calc(100vw - 32px); max-height: 70vh;
  background: #fff; border: 1px solid #E2E8F0; border-radius: 12px;
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.16);
  display: flex; flex-direction: column; overflow: hidden;
  z-index: 60;
`;
const CardHead = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px 10px 16px; border-bottom: 1px solid #E2E8F0;
`;
const Title = styled.div`
  font-size: 0.875rem; font-weight: 700; color: #0F172A;
`;
const TitleBtn = styled.button`
  font-size: 0.875rem; font-weight: 700; color: #0F172A; font-family: inherit;
  border: none; background: transparent; padding: 4px 6px; margin-left: -6px; border-radius: 6px; cursor: pointer;
  &:hover { background: #F0FDFA; color: #0F766E; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const HeadActions = styled.div` display: inline-flex; align-items: center; gap: 2px; `;
const IconBtn = styled.button`
  width: 28px; height: 28px; border: none; background: transparent; color: #64748B;
  border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover { background: #F1F5F9; color: #0F172A; }
`;
const List = styled.div`
  flex: 1; overflow-y: auto; padding: 8px;
  display: flex; flex-direction: column; gap: 4px;
`;
const Item = styled.div<{ $bg: string; $fg: string; $border: string }>`
  ${bookingCss}
  ${pastCss}
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 6px;
  background: ${({ $bg }) => $bg}; color: ${({ $fg }) => $fg};
  border-left: 3px solid ${({ $border }) => $border};
  cursor: pointer; font-size: 0.8125rem;
  transition: filter 0.12s ease;
  &:hover { filter: brightness(0.96); }
`;
const ItemTime = styled.div`
  flex-shrink: 0; font-size: 0.71875rem; font-weight: 600; opacity: 0.85;
  font-variant-numeric: tabular-nums; min-width: 48px;
`;
const ItemTitle = styled.div`
  display: flex; align-items: center; gap: 6px;
  font-weight: 600; overflow: hidden; min-width: 0;
  flex: 1;
`;
const ItemText = styled.span` overflow: hidden; text-overflow: ellipsis; white-space: nowrap; `;
export const TaskIcon = styled.svg` width: 11px; height: 11px; flex-shrink: 0; `;
const ItemLink = styled.span`margin-left: 6px; font-size: 0.6875rem; font-weight: 400; color: #64748B; flex-shrink: 0;`;
