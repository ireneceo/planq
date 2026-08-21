// 정기업무 (recurring task) RRULE 빌더 + 표시 헬퍼.
//
// 백엔드는 `recurrence_rule` 을 RRULE 문자열로 받아 rrule npm 으로 파싱·검증·next_occurrence 계산.
// 프론트엔드는 5 프리셋 + Custom 모달에서 받은 옵션 → RRULE 문자열 만들기 + 표시용 라벨 변환.

import type { TFunction } from 'i18next';

export type RecurEndType = 'never' | 'count' | 'until';
// 운영 #347 — 프리셋 4종 추가 + 'advanced' 신설.
//   weekdays            평일 매일        FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
//   quarterly           분기마다          FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=<anchor>
//   monthlyLastWeekday  매월 마지막 평일  FREQ=MONTHLY;BYDAY=MO..FR;BYSETPOS=-1
//   monthlyNthWeekday   매월 n번째 X요일  FREQ=MONTHLY;BYDAY=<day>;BYSETPOS=<n>
//   advanced            화면이 표현하지 못하는 규칙 — **원문 그대로 보존**만 한다(아래 rawRule).
export type RecurPreset =
  | 'daily' | 'weekly' | 'weekdays' | 'biweekly'
  | 'monthly' | 'monthlyNthWeekday' | 'monthlyLastWeekday' | 'quarterly'
  | 'yearly' | 'custom' | 'advanced';
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
export const WEEKDAYS_ONLY = 'MO,TU,WE,TH,FR';

export function buildPresetRRule(
  preset: Exclude<RecurPreset, 'custom' | 'advanced'>,
  anchorDate: string,
  end: { type: RecurEndType; count?: number; until?: string },
  opts?: { nthPos?: number; nthDay?: string },
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
    // 운영 #347 — 평일 데일리 루틴은 실제로 가장 많이 쓰이는데 화면에서 만들 수가 없었다.
    case 'weekdays':
      base = `FREQ=WEEKLY;BYDAY=${WEEKDAYS_ONLY}`;
      break;
    case 'biweekly':
      base = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`;
      break;
    case 'monthly':
      base = `FREQ=MONTHLY;BYMONTHDAY=${d.getUTCDate()}`;
      break;
    case 'monthlyLastWeekday':
      base = `FREQ=MONTHLY;BYDAY=${WEEKDAYS_ONLY};BYSETPOS=-1`;
      break;
    case 'monthlyNthWeekday': {
      // n 은 1~4 또는 -1(마지막). 요일은 지정이 없으면 anchor 의 요일을 따른다.
      const pos = Number.isFinite(opts?.nthPos) ? Number(opts?.nthPos) : 1;
      const day = (opts?.nthDay && WEEKDAY_CODES.includes(opts.nthDay as WeekdayCode)) ? opts.nthDay : dayCode;
      base = `FREQ=MONTHLY;BYDAY=${day};BYSETPOS=${pos}`;
      break;
    }
    case 'quarterly':
      base = `FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=${d.getUTCDate()}`;
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

// 표시용 라벨.
// options.short = true → 일자/요일 빼고 "매월", "매년", "매주" 만 — 리스트/카드 칩용
// options.short 미지정 → "매월 5일", "매년 5월 4일" 등 풀 라벨 — 등록폼/상세 안내용
// 30년차 안전:
//   - anchorDate 가 invalid (빈 문자열, NaN Date) 면 자동 short 폴백 → "매년 NaN월 NaN일" 같은 깨짐 차단
export function formatRRuleLabel(
  rule: string | null | undefined,
  anchorDate: string | null | undefined,
  t: TFunction,
  options?: { short?: boolean },
): string {
  if (!rule) return '';
  const isShort = options?.short === true;
  const parts = rule.replace(/^RRULE:/, '').split(';').reduce<Record<string, string>>((acc, seg) => {
    const [k, v] = seg.split('=');
    if (k && v != null) acc[k.trim().toUpperCase()] = v.trim();
    return acc;
  }, {});
  const freq = parts.FREQ;
  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1;
  // Invalid Date 방어 — getTime NaN 이면 anchor null 처리 (NaN 출력 차단)
  const anchorRaw = anchorDate ? dateOnlyToUTC(anchorDate) : null;
  const anchor = anchorRaw && !Number.isNaN(anchorRaw.getTime()) ? anchorRaw : null;

  // 운영 #347 — 여태 라벨은 BYDAY 를 `split(',')[0]` 로 **첫 요일만** 읽어서, 평일 규칙(MO~FR)이
  //   화면에 '매주 월' 로 잘못 표시됐다. 사용자는 규칙이 축소된 줄 알고 다시 저장하다 진짜로 깨뜨렸다.
  const bydayList = (parts.BYDAY || '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
  const isWeekdaySet = bydayList.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every(d => bydayList.includes(d));
  const setpos = parts.BYSETPOS ? parseInt(parts.BYSETPOS, 10) : null;
  const dayNames = (codes: string[]) => codes.map(c => t(`recur.weekday.${c}`, c)).join('·');

  if (freq === 'MONTHLY' && setpos != null && !Number.isNaN(setpos)) {
    if (isWeekdaySet && setpos === -1) return t('recur.monthlyLastWeekday', '매월 마지막 평일');
    if (bydayList.length >= 1) {
      const dayLabel = dayNames(bydayList);
      if (setpos === -1) return t('recur.monthlyLastNamed', { day: dayLabel, defaultValue: `매월 마지막 ${dayLabel}요일` });
      return t('recur.monthlyNth', { n: setpos, day: dayLabel, defaultValue: `매월 ${setpos}번째 ${dayLabel}요일` });
    }
  }
  if (freq === 'MONTHLY' && interval === 3) return t('recur.quarterly', '분기마다');
  if (freq === 'WEEKLY' && interval === 1 && isWeekdaySet) return t('recur.weekdays', '평일 매일');
  if (freq === 'WEEKLY' && interval === 1 && bydayList.length > 1) {
    const dayLabel = dayNames(bydayList);
    return t('recur.weeklyMulti', { days: dayLabel, defaultValue: `매주 ${dayLabel}` });
  }

  if (freq === 'DAILY') {
    if (interval > 1) {
      return t('recur.everyNDays', { count: interval, defaultValue: `${interval}일마다` });
    }
    return t('recur.presetDaily', '매일');
  }
  if (freq === 'WEEKLY') {
    if (interval === 2) {
      if (isShort || !anchor) {
        return t('recur.presetBiweeklyShort', '격주');
      }
      const dayCode = parts.BYDAY || (anchor ? WEEKDAY_CODES[anchor.getUTCDay()] : '');
      const dayLabel = dayCode ? t(`recur.weekday.${dayCode.split(',')[0]}`, dayCode) : '';
      return t('recur.presetBiweekly', { day: dayLabel, defaultValue: `격주 ${dayLabel}` });
    }
    if (interval > 2) {
      return t('recur.everyNWeeks', { count: interval, defaultValue: `${interval}주마다` });
    }
    if (isShort || !anchor) {
      return t('recur.presetWeeklyShort', '매주');
    }
    const dayCode = parts.BYDAY || WEEKDAY_CODES[anchor.getUTCDay()];
    const dayLabel = dayCode ? t(`recur.weekday.${dayCode.split(',')[0]}`, dayCode) : '';
    return t('recur.presetWeekly', { day: dayLabel, defaultValue: `매주 ${dayLabel}` });
  }
  if (freq === 'MONTHLY') {
    if (interval > 1) {
      return t('recur.everyNMonths', { count: interval, defaultValue: `${interval}개월마다` });
    }
    if (isShort) return t('recur.presetMonthlyShort', '매월');
    // anchor invalid + BYMONTHDAY 도 없으면 short 자동 폴백 (NaN 차단)
    const day = parts.BYMONTHDAY || (anchor ? String(anchor.getUTCDate()) : '');
    if (!day) return t('recur.presetMonthlyShort', '매월');
    return t('recur.presetMonthly', { day, defaultValue: `매월 ${day}일` });
  }
  if (freq === 'YEARLY') {
    if (interval > 1) {
      return t('recur.everyNYears', { count: interval, defaultValue: `${interval}년마다` });
    }
    if (isShort) return t('recur.presetYearlyShort', '매년');
    const month = parts.BYMONTH || (anchor ? String(anchor.getUTCMonth() + 1) : '');
    const day = parts.BYMONTHDAY || (anchor ? String(anchor.getUTCDate()) : '');
    if (!month || !day) return t('recur.presetYearlyShort', '매년');
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
  /** 운영 #347 — 'monthlyNthWeekday' 용. pos: 1~4 또는 -1(마지막), day: 'MO'… */
  nthPos: number;
  nthDay: string;
  /**
   * 운영 #347 — 화면이 표현하지 못하는 규칙의 **원문**.
   *   여태 이런 규칙(BYSETPOS·BYDAY 다중 등)은 'custom' 으로 떨어졌고, custom 빌더는
   *   FREQ+INTERVAL 만 내보냈다. 그래서 사용자가 **반복을 건드리지 않고** 다른 필드만 고쳐
   *   저장해도 평일 규칙이 '매주 월'로 조용히 축소됐다(운영 실측: 루틴 16건 중 9건이 대상).
   *   → 원문을 들고 있다가 그대로 돌려준다. 사용자가 프리셋을 직접 고르기 전까지는 파괴하지 않는다.
   */
  rawRule: string | null;
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
    nthPos: 1,
    nthDay: 'MO',
    rawRule: null,
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

  // 운영 #347 — 역매핑. 여기서 못 알아본 규칙은 'advanced' 로 두고 **원문을 보존**한다.
  //   (옛 코드는 전부 'custom' 으로 떨어뜨렸고, custom 빌더가 FREQ+INTERVAL 만 내보내 규칙을 파괴했다)
  let nthPos = empty.nthPos;
  let nthDay = empty.nthDay;
  let rawRule: string | null = null;

  const byday = parts.BYDAY || '';
  const bydayList = byday ? byday.split(',').map(x => x.trim().toUpperCase()).filter(Boolean) : [];
  const isWeekdaySet = bydayList.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every(d => bydayList.includes(d));
  const setpos = parts.BYSETPOS ? parseInt(parts.BYSETPOS, 10) : null;

  if (freq === 'DAILY') {
    if (interval === 1) preset = 'daily';
    else { customEvery = interval; customUnit = 'day'; preset = 'custom'; }
  } else if (freq === 'WEEKLY') {
    const isSingleDay = bydayList.length === 0
      || (bydayList.length === 1 && WEEKDAY_CODES.includes(bydayList[0] as WeekdayCode));
    if (interval === 1 && isWeekdaySet) preset = 'weekdays';
    else if (interval === 1 && isSingleDay) preset = 'weekly';
    else if (interval === 2 && isSingleDay) preset = 'biweekly';
    else if (bydayList.length > 1) { preset = 'advanced'; rawRule = r; }   // 임의 다중 요일 — 보존
    else { customEvery = interval; customUnit = 'week'; preset = 'custom'; }
  } else if (freq === 'MONTHLY') {
    if (setpos != null && !Number.isNaN(setpos)) {
      if (isWeekdaySet && setpos === -1 && interval === 1) preset = 'monthlyLastWeekday';
      else if (bydayList.length === 1 && interval === 1
               && WEEKDAY_CODES.includes(bydayList[0] as WeekdayCode)
               && [1, 2, 3, 4, -1].includes(setpos)) {
        preset = 'monthlyNthWeekday'; nthPos = setpos; nthDay = bydayList[0];
      } else { preset = 'advanced'; rawRule = r; }
    } else if (interval === 3) preset = 'quarterly';
    else if (interval === 1) preset = 'monthly';
    else { customEvery = interval; customUnit = 'month'; preset = 'custom'; }
  } else if (freq === 'YEARLY') {
    if (interval === 1) preset = 'yearly';
    else { customEvery = interval; customUnit = 'year'; preset = 'custom'; }
  } else {
    preset = 'advanced'; rawRule = r;   // 알 수 없는 FREQ — 손대지 않는다
  }

  return {
    enabled: true,
    preset,
    customEvery,
    customUnit,
    endType,
    endCount,
    endUntil,
    nthPos,
    nthDay,
    rawRule,
  };
}

// 운영 #347 — 프리셋 라벨의 **단일 원천**.
//   여태 같은 목록이 RecurrencePicker · TaskDetailDrawer · QTaskPage(2곳) 에 각각 하드코딩돼 있었다.
//   프리셋을 하나 늘리면 네 곳을 다 고쳐야 하고, 한 곳을 놓치면 그 화면에서만 옵션이 사라진다
//   (실제로 타입 오류로 드러났다). 라벨은 여기서만 만든다.
//
//   'advanced' 는 **사용자가 고르는 값이 아니다** — 화면이 표현 못 하는 규칙을 보존하는 상태다.
//   그래서 selectable 목록에서는 빠지고, 라벨 맵에는 남는다(현재 값 표시용).
export const SELECTABLE_PRESETS: Exclude<RecurPreset, 'advanced'>[] = [
  'daily', 'weekdays', 'weekly', 'biweekly',
  'monthly', 'monthlyNthWeekday', 'monthlyLastWeekday', 'quarterly',
  'yearly', 'custom',
];

export function presetLabelMap(t: TFunction, anchorDate: string | null | undefined): Record<RecurPreset, string> {
  const raw = anchorDate ? dateOnlyToUTC(anchorDate) : null;
  const d = raw && !Number.isNaN(raw.getTime()) ? raw : null;
  const dayLabel = d ? (t(`recur.weekday.${WEEKDAY_CODES[d.getUTCDay()]}`, '') as string) : '';
  const dom = d ? String(d.getUTCDate()) : '';
  const mon = d ? String(d.getUTCMonth() + 1) : '';
  return {
    daily: t('recur.presetDaily', '매일') as string,
    weekdays: t('recur.weekdays', '평일 매일') as string,
    weekly: t('recur.presetWeekly', { day: dayLabel, defaultValue: `매주 ${dayLabel}` }) as string,
    biweekly: t('recur.presetBiweekly', { day: dayLabel, defaultValue: `격주 ${dayLabel}` }) as string,
    monthly: t('recur.presetMonthly', { day: dom, defaultValue: `매월 ${dom}일` }) as string,
    monthlyNthWeekday: t('recur.presetMonthlyNth', '매월 n번째 요일') as string,
    monthlyLastWeekday: t('recur.monthlyLastWeekday', '매월 마지막 평일') as string,
    quarterly: t('recur.quarterly', '분기마다') as string,
    yearly: t('recur.presetYearly', { month: mon, day: dom, defaultValue: `매년 ${mon}월 ${dom}일` }) as string,
    custom: t('recur.presetCustom', '사용자 지정...') as string,
    advanced: t('recur.advancedBadge', '사용자 지정 규칙') as string,
  };
}
