// 정기업무 (recurring task) RRULE 빌더 + 표시 헬퍼.
//
// 백엔드는 `recurrence_rule` 을 RRULE 문자열로 받아 rrule npm 으로 파싱·검증·next_occurrence 계산.
// 프론트엔드는 5 프리셋 + Custom 모달에서 받은 옵션 → RRULE 문자열 만들기 + 표시용 라벨 변환.

import type { TFunction } from 'i18next';

export type RecurEndType = 'never' | 'count' | 'until';
export type RecurPreset = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type RecurCustomUnit = 'day' | 'week' | 'month' | 'year';

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
type WeekdayCode = typeof WEEKDAY_CODES[number];

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

// 'YYYY-MM-DD' → UTC midnight Date
function dateOnlyToUTC(dateStr: string): Date {
  return new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
}

// UNTIL 직렬화 — RRULE 표준은 'YYYYMMDDTHHmmssZ' UTC. DATEONLY 입력 → 23:59:59Z 끝.
function serializeUntil(dateStr: string): string {
  const d = dateOnlyToUTC(dateStr);
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${y}${m}${day}T235959Z`;
}

function endSuffix(end: { type: RecurEndType; count?: number; until?: string }): string {
  if (end.type === 'count' && end.count && end.count > 0) return `;COUNT=${Math.floor(end.count)}`;
  if (end.type === 'until' && end.until) return `;UNTIL=${serializeUntil(end.until)}`;
  return '';
}

// 5 프리셋 RRULE 빌더. dueDate 가 첫 occurrence (parent.due_date).
// daily: 매일
// weekly: 마감일 요일 매주
// monthly: 마감일의 일자 매월 (29~31 은 RRULE 가 자동 처리 — 그달 없으면 skip)
// yearly: 마감일의 월/일 매년
// custom: 별도 빌더 사용
export function buildPresetRRule(
  preset: Exclude<RecurPreset, 'custom'>,
  dueDate: string,
  end: { type: RecurEndType; count?: number; until?: string },
): string {
  const d = dateOnlyToUTC(dueDate);
  const dayCode: WeekdayCode = WEEKDAY_CODES[d.getUTCDay()];
  let base = '';
  switch (preset) {
    case 'daily':
      base = 'FREQ=DAILY';
      break;
    case 'weekly':
      base = `FREQ=WEEKLY;BYDAY=${dayCode}`;
      break;
    case 'monthly':
      base = `FREQ=MONTHLY;BYMONTHDAY=${d.getUTCDate()}`;
      break;
    case 'yearly':
      base = `FREQ=YEARLY;BYMONTH=${d.getUTCMonth() + 1};BYMONTHDAY=${d.getUTCDate()}`;
      break;
  }
  return base + endSuffix(end);
}

// Custom RRULE 빌더 — every N + unit + 종료 조건.
// 1.x 에서 BYDAY 다중 선택 추가 예정.
export function buildCustomRRule(
  every: number,
  unit: RecurCustomUnit,
  end: { type: RecurEndType; count?: number; until?: string },
): string {
  const freqMap: Record<RecurCustomUnit, string> = {
    day: 'DAILY',
    week: 'WEEKLY',
    month: 'MONTHLY',
    year: 'YEARLY',
  };
  const interval = Math.max(1, Math.floor(every));
  const base = `FREQ=${freqMap[unit]}${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
  return base + endSuffix(end);
}

// 표시용 라벨 — task 카드/상세에서 "매주 월요일" 같은 짧은 텍스트.
// dueDate 는 parent 의 due_date (요일/일자 정보 추출용).
export function formatRRuleLabel(
  rule: string | null | undefined,
  dueDate: string | null | undefined,
  t: TFunction,
): string {
  if (!rule) return '';
  const parts = rule.split(';').reduce<Record<string, string>>((acc, seg) => {
    const [k, v] = seg.split('=');
    if (k && v != null) acc[k.trim().toUpperCase()] = v.trim();
    return acc;
  }, {});
  const freq = parts.FREQ;
  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
  const due = dueDate ? dateOnlyToUTC(dueDate) : null;

  if (freq === 'DAILY') {
    if (interval > 1) {
      return `${t('recur.customEvery', 'Repeat every')} ${interval} ${t('recur.customUnitDay', 'day')}`;
    }
    return t('recur.presetDaily', '매일');
  }
  if (freq === 'WEEKLY') {
    const dayCode = parts.BYDAY || (due ? WEEKDAY_CODES[due.getUTCDay()] : '');
    const dayLabel = dayCode ? t(`recur.weekday.${dayCode.split(',')[0]}`, dayCode) : '';
    if (interval > 1) {
      return `${t('recur.customEvery', 'Repeat every')} ${interval} ${t('recur.customUnitWeek', 'week')}`;
    }
    return t('recur.presetWeekly', { day: dayLabel, defaultValue: `매주 ${dayLabel}` });
  }
  if (freq === 'MONTHLY') {
    const day = parts.BYMONTHDAY || (due ? String(due.getUTCDate()) : '');
    if (interval > 1) {
      return `${t('recur.customEvery', 'Repeat every')} ${interval} ${t('recur.customUnitMonth', 'month')}`;
    }
    return t('recur.presetMonthly', { day, defaultValue: `매월 ${day}일` });
  }
  if (freq === 'YEARLY') {
    const month = parts.BYMONTH || (due ? String(due.getUTCMonth() + 1) : '');
    const day = parts.BYMONTHDAY || (due ? String(due.getUTCDate()) : '');
    return t('recur.presetYearly', { month, day, defaultValue: `매년 ${month}월 ${day}일` });
  }
  return rule;
}
