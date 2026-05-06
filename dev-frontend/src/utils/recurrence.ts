// 정기업무 (recurring task) RRULE 빌더 + 표시 헬퍼.
//
// 백엔드는 `recurrence_rule` 을 RRULE 문자열로 받아 rrule npm 으로 파싱·검증·next_occurrence 계산.
// 프론트엔드는 5 프리셋 + Custom 모달에서 받은 옵션 → RRULE 문자열 만들기 + 표시용 라벨 변환.

import type { TFunction } from 'i18next';

export type RecurEndType = 'never' | 'count' | 'until';
export type RecurPreset = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';
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

// 6 프리셋 RRULE 빌더. anchorDate (Q Task: due_date / Q Calendar: start_at) 가 첫 occurrence.
// daily: 매일
// weekly: anchorDate 요일 매주
// biweekly: anchorDate 요일 격주 (2주마다)
// monthly: anchorDate 의 일자 매월 (29~31 은 RRULE 가 자동 처리 — 그달 없으면 skip)
// yearly: anchorDate 의 월/일 매년
// custom: 별도 빌더 사용
export function buildPresetRRule(
  preset: Exclude<RecurPreset, 'custom'>,
  anchorDate: string,
  end: { type: RecurEndType; count?: number; until?: string },
): string {
  const d = dateOnlyToUTC(anchorDate);
  const dayCode: WeekdayCode = WEEKDAY_CODES[d.getUTCDay()];
  let base = '';
  switch (preset) {
    case 'daily':
      base = 'FREQ=DAILY';
      break;
    case 'weekly':
      base = `FREQ=WEEKLY;BYDAY=${dayCode}`;
      break;
    case 'biweekly':
      base = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`;
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
// anchorDate 는 entity 의 기준일 (Q Task=due_date / Q Calendar=start_at) — 요일/일자 정보 추출용.
export function formatRRuleLabel(
  rule: string | null | undefined,
  anchorDate: string | null | undefined,
  t: TFunction,
): string {
  if (!rule) return '';
  const parts = rule.replace(/^RRULE:/, '').split(';').reduce<Record<string, string>>((acc, seg) => {
    const [k, v] = seg.split('=');
    if (k && v != null) acc[k.trim().toUpperCase()] = v.trim();
    return acc;
  }, {});
  const freq = parts.FREQ;
  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
  const anchor = anchorDate ? dateOnlyToUTC(anchorDate) : null;

  if (freq === 'DAILY') {
    if (interval > 1) {
      return `${t('recur.customEvery', '매')} ${interval} ${t('recur.customUnitDay', '일')}`;
    }
    return t('recur.presetDaily', '매일');
  }
  if (freq === 'WEEKLY') {
    const dayCode = parts.BYDAY || (anchor ? WEEKDAY_CODES[anchor.getUTCDay()] : '');
    const dayLabel = dayCode ? t(`recur.weekday.${dayCode.split(',')[0]}`, dayCode) : '';
    if (interval === 2) {
      return t('recur.presetBiweekly', { day: dayLabel, defaultValue: `격주 ${dayLabel}` });
    }
    if (interval > 2) {
      return `${interval} ${t('recur.customUnitWeek', '주')}${t('recur.everySuffix', '마다')}`;
    }
    return t('recur.presetWeekly', { day: dayLabel, defaultValue: `매주 ${dayLabel}` });
  }
  if (freq === 'MONTHLY') {
    const day = parts.BYMONTHDAY || (anchor ? String(anchor.getUTCDate()) : '');
    if (interval > 1) {
      return `${interval} ${t('recur.customUnitMonth', '개월')}${t('recur.everySuffix', '마다')}`;
    }
    return t('recur.presetMonthly', { day, defaultValue: `매월 ${day}일` });
  }
  if (freq === 'YEARLY') {
    const month = parts.BYMONTH || (anchor ? String(anchor.getUTCMonth() + 1) : '');
    const day = parts.BYMONTHDAY || (anchor ? String(anchor.getUTCDate()) : '');
    if (interval > 1) {
      return `${interval} ${t('recur.customUnitYear', '년')}${t('recur.everySuffix', '마다')}`;
    }
    return t('recur.presetYearly', { month, day, defaultValue: `매년 ${month}월 ${day}일` });
  }
  return rule;
}

// 저장된 RRULE → 폼 상태로 역직렬화 (편집 UX).
// 미지원 패턴 (BYDAY 다중 등) 은 'custom' 으로 떨어뜨려 안전하게 표시.
export interface RecurState {
  enabled: boolean;
  preset: RecurPreset;
  customEvery: number;
  customUnit: RecurCustomUnit;
  endType: RecurEndType;
  endCount: number;
  endUntil: string; // YYYY-MM-DD
}

export function emptyRecurState(): RecurState {
  return {
    enabled: false,
    preset: 'weekly',
    customEvery: 2,
    customUnit: 'week',
    endType: 'never',
    endCount: 10,
    endUntil: '',
  };
}

export function parseRRule(rule: string | null | undefined): RecurState {
  const empty = emptyRecurState();
  if (!rule) return empty;

  const r = rule.replace(/^RRULE:/, '');
  const parts: Record<string, string> = {};
  r.split(';').forEach(seg => {
    const [k, v] = seg.split('=');
    if (k && v != null) parts[k.trim().toUpperCase()] = v.trim();
  });
  const freq = parts.FREQ;
  if (!freq) return empty;
  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;

  // 종료 조건
  let endType: RecurEndType = 'never';
  let endCount = empty.endCount;
  let endUntil = '';
  if (parts.COUNT) {
    const n = parseInt(parts.COUNT, 10);
    if (n > 0) { endType = 'count'; endCount = n; }
  } else if (parts.UNTIL) {
    const u = parts.UNTIL;
    // 'YYYYMMDDTHHMMSSZ' or 'YYYYMMDD' 둘 다 처리
    if (/^\d{8}/.test(u)) {
      endType = 'until';
      endUntil = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
    }
  }

  // 프리셋 감지 — interval=1 + 표준 패턴이면 프리셋, 아니면 custom
  let preset: RecurPreset = 'custom';
  let customEvery = interval;
  let customUnit: RecurCustomUnit = 'week';

  if (freq === 'DAILY') {
    if (interval === 1) preset = 'daily';
    else { customEvery = interval; customUnit = 'day'; preset = 'custom'; }
  } else if (freq === 'WEEKLY') {
    // BYDAY 가 단일이고 anchor 와 일치하면 표준 weekly/biweekly. 다중 BYDAY 면 custom 으로.
    const byday = parts.BYDAY || '';
    const isSingleDay = byday.length === 0 || (byday.length === 2 && WEEKDAY_CODES.includes(byday as WeekdayCode));
    if (interval === 1 && isSingleDay) preset = 'weekly';
    else if (interval === 2 && isSingleDay) preset = 'biweekly';
    else { customEvery = interval; customUnit = 'week'; preset = 'custom'; }
  } else if (freq === 'MONTHLY') {
    if (interval === 1) preset = 'monthly';
    else { customEvery = interval; customUnit = 'month'; preset = 'custom'; }
  } else if (freq === 'YEARLY') {
    if (interval === 1) preset = 'yearly';
    else { customEvery = interval; customUnit = 'year'; preset = 'custom'; }
  }

  return {
    enabled: true,
    preset,
    customEvery,
    customUnit,
    endType,
    endCount,
    endUntil,
  };
}
