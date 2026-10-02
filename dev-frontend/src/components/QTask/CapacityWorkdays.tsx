// Q task 「주간 가용시간」 — 이번 주 근무일 내역 (#424). 설계 docs/WORKDAY_HOLIDAY_DESIGN.md §4.2
//
// ★ 근무일 수는 **서버가 센다**(`/api/tasks/my-week` → capacity.work_days). 여기는 그 내역을 보여주기만 한다.
//   전에는 화면이 `daily × (days − 휴일칸) × rate` 를 다시 계산해, 서버가 빼고 있던 **휴가가 화면에 안 보였다**
//   (서버 weekly_effective 를 읽는 곳이 0곳이었다 — memory feedback_backend_done_ui_missing).
// ★ 「이번 주 휴일」 수동 입력칸은 없앴다(Irene 결정 2026-10-02). 공휴일은 설정 > 근태 관리에서,
//   개인 휴가는 근태 > 휴가에서 들어온다. 옛 수동값이 남아 있으면 칩으로 보여주고 ✕ 로 지운다.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import styled from 'styled-components';
import ChromeLink from '../Tab/ChromeLink';
import { formatDay } from '../../utils/dateFormat';

export interface CapacityInfo {
  daily: number; days: number; rate: number; weekly: number;
  holidays?: number;                 // 옛 수동 휴일(business_members.weekly_holidays)
  holiday_days?: number; holiday_list?: { date: string; name: string; name_en: string | null }[];
  leave_days?: number;
  work_days?: number;                // 서버 정본: max(0, days − 수동 − 공휴일 − 휴가)
  work_weekdays?: number[];
  weekly_effective?: number;
}

interface Props {
  capacity: CapacityInfo;
  canManageHolidays: boolean;
  onClearManual: () => Promise<void>;
}

export default function CapacityWorkdays({ capacity, canManageHolidays, onClearManual }: Props) {
  const { t, i18n } = useTranslation('qtask');
  const [clearing, setClearing] = useState(false);
  const manual = Number(capacity.holidays) || 0;
  const holidayList = capacity.holiday_list || [];
  const leave = Number(capacity.leave_days) || 0;
  const workDays = capacity.work_days ?? Math.max(0, (capacity.days || 5) - manual);
  const en = i18n.language?.startsWith('en');

  return (
    <Box data-testid="capacity-workdays">
      <Line>
        <Label>{t('capacity.workDays', '이번 주 근무일') as string}</Label>
        <Value data-testid="capacity-workdays-value">{t('capacity.workDaysValue', { n: workDays, defaultValue: '{{n}}일' }) as string}</Value>
      </Line>
      {(holidayList.length > 0 || leave > 0 || manual > 0) && (
        <Formula>
          {t('capacity.workDaysFormula', {
            base: capacity.days || 5, holiday: holidayList.length, leave, defaultValue: '업무일수 {{base}} − 공휴일 {{holiday}} − 휴가 {{leave}}',
          }) as string}
        </Formula>
      )}
      {holidayList.length > 0 && (
        <Items>
          {holidayList.map((h) => (
            <Item key={h.date}>· {formatDay(h.date, { weekday: true })} {en && h.name_en ? h.name_en : h.name}</Item>
          ))}
        </Items>
      )}
      {manual > 0 && (
        <ManualChip data-testid="capacity-manual-holiday">
          {t('capacity.manualHoliday', { n: manual, defaultValue: '수동 휴일 +{{n}}' }) as string}
          {/* autosave-exempt: 지우기는 액션이다(한 번 누르면 끝난다) */}
          <ChipX type="button" disabled={clearing} data-testid="capacity-manual-holiday-clear"
            aria-label={t('capacity.manualHolidayClear', '수동 휴일 지우기') as string}
            title={t('capacity.manualHolidayClear', '수동 휴일 지우기') as string}
            onClick={async () => { setClearing(true); try { await onClearManual(); } finally { setClearing(false); } }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </ChipX>
        </ManualChip>
      )}
      <Links>
        <ChromeLink to="/attendance" newTab>{t('capacity.requestLeave', '휴가 신청') as string}</ChromeLink>
        {canManageHolidays && (
          <ChromeLink to="/business/settings/attendance" newTab>{t('capacity.manageHolidays', '휴일 관리') as string}</ChromeLink>
        )}
      </Links>
    </Box>
  );
}

const Box = styled.div`
  margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: #F8FAFC;
  display: flex; flex-direction: column; gap: 4px;
`;
const Line = styled.div` display: flex; align-items: baseline; justify-content: space-between; gap: 8px; `;
const Label = styled.span` font-size: 0.6875rem; color: #64748B; font-weight: 600; `;
const Value = styled.span` font-size: 0.8125rem; color: #0F172A; font-weight: 700; `;
const Formula = styled.div` font-size: 0.6875rem; color: #94A3B8; `;
const Items = styled.div` display: flex; flex-direction: column; gap: 2px; `;
const Item = styled.span` font-size: 0.6875rem; color: #475569; `;
const ManualChip = styled.span`
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 4px 2px 8px; border-radius: 999px; background: #FEF3C7; color: #92400E;
  font-size: 0.6875rem; font-weight: 600;
`;
const ChipX = styled.button`
  width: 28px; height: 28px; margin: -6px -2px -6px 0; display: inline-flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 999px; color: inherit; cursor: pointer;
  &:hover { background: rgba(146, 64, 14, 0.12); }
  &:disabled { opacity: 0.5; cursor: default; }
  &:focus-visible { outline: 2px solid #14B8A6; outline-offset: 1px; }
`;
const Links = styled.div`
  display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.6875rem;
  a { color: #0F766E; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
`;
