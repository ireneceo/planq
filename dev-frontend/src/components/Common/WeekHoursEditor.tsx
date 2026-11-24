// 요일별 시작~끝 시각 편집기 — 예약 받는 시간(BookingSettings)과 근태 근무 일정(AttendanceScheduleSection)이 같이 쓴다.
//   값 모양은 서버 services/booking serializeWorkHours 와 같다: { mon:[9,18], …, sat:null } (0.5시간 단위).
//   ★ 두 화면이 같은 편집기를 쓰지만 저장하는 칸은 다르다(work_hours ≠ attendance_schedules — docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md D1).
import React from 'react';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import PlanQSelect from './PlanQSelect';

export type WeekHours = Record<string, [number, number] | null>;
export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const DEFAULT_WEEK_HOURS: WeekHours = { mon: [9, 18], tue: [9, 18], wed: [9, 18], thu: [9, 18], fri: [9, 18], sat: null, sun: null };
const HOUR_OPTS = Array.from({ length: 49 }, (_, i) => i / 2).map((h) => ({
  value: String(h), label: `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`,
}));

/** 서버가 정한 모양이 아니면 기본값 — 서버 normalizeWorkHours 와 같은 규칙. */
export function readWeekHours(raw: unknown): WeekHours {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_WEEK_HOURS;
  const src = raw as Record<string, unknown>;
  const out: WeekHours = {};
  let any = false;
  for (const d of WEEK_DAYS) {
    const v = src[d];
    if (Array.isArray(v) && v.length === 2 && Number(v[0]) < Number(v[1])) { out[d] = [Number(v[0]), Number(v[1])]; any = true; } else out[d] = null;
  }
  return any ? out : DEFAULT_WEEK_HOURS;
}

interface Props {
  hours: WeekHours;
  onChange: (fn: (p: WeekHours) => WeekHours) => void;
  disabled?: boolean;
  /** 꺼진 요일에 보일 말 — 예약 «받지 않음» · 근태 «쉬는 날» */
  closedLabel: string;
  testIdPrefix: string;
}

const WeekHoursEditor: React.FC<Props> = ({ hours, onChange, disabled, closedLabel, testIdPrefix }) => {
  const { t } = useTranslation('settings');
  return (
    <HoursList>
      {WEEK_DAYS.map((d) => {
        const v = hours[d];
        return (
          <HourRow key={d} data-testid={`${testIdPrefix}-${d}`}>
            <DayToggle type="button" aria-pressed={!!v} $on={!!v} disabled={disabled}
              onClick={() => onChange((p) => ({ ...p, [d]: p[d] ? null : [9, 18] }))}>
              {t(`entry.booking.day.${d}`)}
            </DayToggle>
            {v ? (
              <>
                <Sel><PlanQSelect size="sm" isDisabled={disabled} options={HOUR_OPTS} value={HOUR_OPTS.find((o) => Number(o.value) === v[0]) || null}
                  onChange={(o) => { const n = Number((o as { value: string }).value); if (n < v[1]) onChange((p) => ({ ...p, [d]: [n, v[1]] })); }} /></Sel>
                <Dash>–</Dash>
                <Sel><PlanQSelect size="sm" isDisabled={disabled} options={HOUR_OPTS} value={HOUR_OPTS.find((o) => Number(o.value) === v[1]) || null}
                  onChange={(o) => { const n = Number((o as { value: string }).value); if (n > v[0]) onChange((p) => ({ ...p, [d]: [v[0], n] })); }} /></Sel>
              </>
            ) : <Closed>{closedLabel}</Closed>}
          </HourRow>
        );
      })}
    </HoursList>
  );
};
export default WeekHoursEditor;

const HoursList = styled.div`display:flex;flex-direction:column;gap:6px;`;
const HourRow = styled.div`display:flex;align-items:center;gap:8px;flex-wrap:wrap;`;
const DayToggle = styled.button<{ $on: boolean }>`
  flex:0 0 56px;height:36px;border-radius:8px;cursor:pointer;font-size:0.8125rem;font-weight:600;
  background:${p => (p.$on ? '#F0FDFA' : '#fff')};color:${p => (p.$on ? '#0F766E' : '#94A3B8')};
  border:1px solid ${p => (p.$on ? '#14B8A6' : '#E2E8F0')};
  &:disabled{cursor:default;}
  &:focus-visible{outline:2px solid #14B8A6;outline-offset:2px;}
  @media (max-width:640px){ height:40px; }
`;
const Sel = styled.div`flex:0 1 120px;min-width:96px;`;
const Dash = styled.span`color:#94A3B8;font-size:0.8125rem;`;
const Closed = styled.span`font-size:0.75rem;color:#94A3B8;`;
