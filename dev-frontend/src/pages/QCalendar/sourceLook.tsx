// 이 일정이 **어디서 왔나** — 구글에서 온 일정 칩 앞의 작은 점 한 벌 (docs/TEAM_CALENDAR_PICK_DESIGN.md §3).
//
//   색이 아니라 **모양**으로 가른다 — 구글 캘린더 색과 PlanQ 분류 색이 같은 계열(틸)이면 색만으론 섞인다.
//   PlanQ 일정 칩에는 이 점이 없다. 월간 칸·팝오버·종일·시간표·목록 **다섯 곳**이 같은 조각을 쓴다(bookingLook 과 같은 이유).
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import type { CalendarItem } from './types';
import { isPersonalEvent } from './taskToEvent';

// 구글 일정의 캘린더 이름 — 필터줄 칩(calendarLayers nameOf)과 같은 규칙. 기본 캘린더의 구글 이름은 이메일이라 «기본 캘린더».
export function googleCalName(e: { calendar_primary?: boolean; calendar_name?: string | null }, t: ReturnType<typeof useTranslation>['t']): string {
  return (!e.calendar_primary && e.calendar_name) ? e.calendar_name : (t('layer.googleDefault', '기본 캘린더') as string);
}

export function SourceDot({ e }: { e: CalendarItem }) {
  const { t } = useTranslation('qcalendar');
  if (!isPersonalEvent(e)) return null;
  const name = googleCalName(e, t);
  const label = t('layer.sourceGoogle', { name, defaultValue: 'Google · {{name}}' }) as string;
  return <Dot $color={e.color} role="img" aria-label={label} title={label} data-testid="calendar-source-google" />;
}

// 10px 점 + 흰 테두리 — 칩 배경(같은 색의 옅은 톤) 위에서도 «점» 으로 읽힌다. 월간 시간 점(6px)과 크기·테두리로 다르다.
const Dot = styled.span<{ $color: string }>`
  display: inline-block; flex-shrink: 0; vertical-align: -1px;
  width: 10px; height: 10px; border-radius: 50%; margin-right: 4px;
  background: ${({ $color }) => $color}; box-shadow: 0 0 0 1.5px #fff;
`;
