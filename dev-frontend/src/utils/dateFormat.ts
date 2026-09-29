import i18n from '../i18n';

// 워크스페이스 타임존 기준 날짜/시간 표시 포맷터.
// DB 는 UTC 저장, 모든 사용자 대면 표시는 워크스페이스 tz 로 변환한다.
// useTimeFormat 훅을 통해 컴포넌트에서 사용한다.

// ─── 사용자 날짜·시간 형식 (2026-09-28, Irene 승인 09-27) ─────────────────────────────
//   users.date_format / time_format / week_start. **null = 화면 언어별 자동** — 자동일 때의 결과는
//   이 설정이 생기기 전과 한 글자도 같다(날짜 = 'M월 d일'/'Sep 27', 다른 해면 연도).
//   단 시각은 자동일 때 **언어를 따른다**(ko 24시간 / en 12시간) — 영어 화면에 «14:30» 만 나오던 것.
//   값은 AuthContext.setUser 한 곳이 넣는다(요청 헤더 사본과 같은 자리 — 렌더보다 먼저).
//   ★ 백엔드 ENUM(models/User.js)과 값이 같아야 한다.
export type DateFormatPref = 'ymd' | 'mdy' | 'dmy';
export type TimeFormatPref = '24h' | '12h';
export type WeekStartPref = 'sun' | 'mon';
export interface DatePrefs { date_format: DateFormatPref | null; time_format: TimeFormatPref | null; week_start: WeekStartPref | null }
let prefs: DatePrefs = { date_format: null, time_format: null, week_start: null };
export function setDatePrefs(next: DatePrefs): void { prefs = { ...next }; }
export function getDatePrefs(): DatePrefs { return prefs; }

/** 주의 시작 요일 (0=일, 1=월). 자동 = 일요일(ko·en 공통). 달력 격자·주간 범위가 이것을 읽는다. */
export function weekStartDay(): 0 | 1 { return prefs.week_start === 'mon' ? 1 : 0; }

/** 12시간제 여부 — 설정 > 자동이면 언어(en = 12시간). */
export function uses12h(locale: string): boolean {
  if (prefs.time_format) return prefs.time_format === '12h';
  return locale.startsWith('en');
}

// 숫자형 날짜 — 설정한 순서로. 연도는 늘 붙인다(숫자만 있으면 몇 년도인지가 더 헷갈린다).
function numericDate(d: Date, tz: string, fmt: DateFormatPref): string {
  const [y, m, day] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('-');
  if (fmt === 'mdy') return `${m}/${day}/${y}`;
  if (fmt === 'dmy') return `${day}/${m}/${y}`;
  return `${y}-${m}-${day}`;
}

function safeDate(iso: string | Date): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// 'M월 d일' — 단, **올해가 아니면 연도를 붙인다** ('2025년 9월 6일').
//   Irene 2026-09-06: "문서 날짜 년도가 안나와도 되는 거야?"
//   연도를 늘 붙이면 최근 항목이 시끄럽고, 아예 안 붙이면 **옛 문서가 언제 건지 알 수 없다**.
//   같은 해면 생략하고 다른 해에만 붙이는 것이 표준(메일·문서 앱 공통)이라 양쪽을 다 만족한다.
//   ★ 공용 포맷터다 — 목록·상세·카드가 모두 이걸 쓰므로 한 곳만 고치면 전부 일관된다.
export function formatDate(iso: string | Date, tz: string, locale = 'ko-KR'): string {
  const d = safeDate(iso);
  if (!d) return '';
  if (prefs.date_format) return numericDate(d, tz, prefs.date_format);
  // '올해' 판정도 워크스페이스 tz 기준이어야 한다 — 로컬 연도로 비교하면 연말에 어긋난다.
  const yearIn = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(x);
  const sameYear = yearIn(d) === yearIn(new Date());
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(d);
}

// 'HH:mm' (tz 기준) — 12/24시간은 uses12h()
export function formatTime(iso: string | Date, tz: string, locale = 'ko-KR'): string {
  const d = safeDate(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: uses12h(locale) }).format(d);
}

// 'YYYY-MM-DD HH:mm' (tz 기준) — 날짜 순서는 설정을 따르고, 자동이면 종전 그대로 YYYY-MM-DD
export function formatDateTime(iso: string | Date, tz: string, locale = 'ko-KR'): string {
  const d = safeDate(iso);
  if (!d) return '';
  const date = numericDate(d, tz, prefs.date_format || 'ymd');
  const time = formatTime(d, tz, locale);
  return `${date} ${time}`;
}

// ─── 날짜 한 개 · 시각 한 개 — 화면이 직접 부르지 않게 (2차, 2026-09-29) ─────────────────────
//   화면이 toLocaleDateString()·new Intl.DateTimeFormat 을 직접 부르면 **설정이 안 먹는다**(1차 뒤 실측
//   60여 곳). 모양이 조금씩 다른 자리(요일 붙임·연도 늘 붙임·긴 달 이름)도 이 두 함수의 옵션으로 받는다.
//   · tz 를 안 주면 기기 시간대 — 옛 코드(toLocaleDateString())와 같은 기준이라 그 자리들은 결과가 안 바뀐다.
//   · 'YYYY-MM-DD'(날짜만)는 그날 자정(기기)으로 읽는다 — UTC 로 읽으면 서쪽 시간대에서 하루 밀린다.
//   · 로케일은 화면 언어(publicLocale 과 같은 규칙).
//   ★ 설정이 «자동» 이면 종전 모양 그대로, 숫자형을 골랐으면 연도까지 숫자로(요일은 괄호로 뒤에).
export interface DayOpts { tz?: string; locale?: string; weekday?: boolean; year?: 'auto' | 'always'; month?: 'short' | 'long' }

function dayDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return safeDate(`${v}T00:00:00`);
  return safeDate(v);
}
function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function formatDay(v: string | Date | null | undefined, o: DayOpts = {}): string {
  const d = dayDate(v);
  if (!d) return '';
  const locale = o.locale || publicLocale();
  const dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const tz = dateOnly ? undefined : o.tz;
  if (prefs.date_format) {
    const s = numericDate(d, tz || deviceTz(), prefs.date_format);
    if (!o.weekday) return s;
    return `${s} (${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short' }).format(d)})`;
  }
  const yearIn = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(x);
  const withYear = o.year === 'always' || yearIn(d) !== yearIn(new Date());
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    ...(withYear ? { year: 'numeric' } : {}),
    month: o.month || 'short',
    day: 'numeric',
    ...(o.weekday ? { weekday: 'short' } : {}),
  }).format(d);
}

export function formatClock(v: string | Date | null | undefined, o: { tz?: string; locale?: string } = {}): string {
  const d = safeDate(v as string | Date);
  if (!d) return '';
  const locale = o.locale || publicLocale();
  return new Intl.DateTimeFormat(locale, { timeZone: o.tz, hour: '2-digit', minute: '2-digit', hour12: uses12h(locale) }).format(d);
}

export function formatDayTime(v: string | Date | null | undefined, o: DayOpts = {}): string {
  const day = formatDay(v, o);
  const clock = formatClock(v, o);
  return day && clock ? `${day} ${clock}` : day;
}

// "방금"/"5분 전"/"3시간 전"/"어제"/"M월 d일" — tz 는 하루 경계 판단에 사용
export function formatTimeAgo(iso: string | Date, tz: string, locale = 'ko-KR', t?: (key: string, opts?: Record<string, unknown>) => string): string {
  const d = safeDate(iso);
  if (!d) return '';
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  const hour = Math.floor(diff / 3600000);

  const tr = t || ((k: string, o?: Record<string, unknown>) => {
    // fallback — 번역 없이 쓸 때
    if (k === 'time.justNow') return '방금';
    if (k === 'time.minutesAgo') return `${(o as { n: number }).n}분 전`;
    if (k === 'time.hoursAgo') return `${(o as { n: number }).n}시간 전`;
    if (k === 'time.yesterday') return '어제';
    return '';
  });

  if (min < 1) return tr('time.justNow');
  if (min < 60) return tr('time.minutesAgo', { n: min });
  if (hour < 24) return tr('time.hoursAgo', { n: hour });

  // 하루 경계 비교 — tz 기준
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const target = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const todayDt = new Date(today + 'T00:00:00Z');
  const targetDt = new Date(target + 'T00:00:00Z');
  const dayDiff = Math.round((todayDt.getTime() - targetDt.getTime()) / 86400000);
  if (dayDiff === 1) return tr('time.yesterday');
  return formatDate(d, tz, locale);
}

/**
 * 공개(무로그인) 화면의 **날짜 한 개** — 보는 사람의 로케일로.
 *
 * ★ 왜 여기 있나: 같은 함수가 pages/Public/PublicTaskPage.tsx 안에 지역 선언돼 있었고,
 *   게스트 화면(pages/Guest)은 그 수리를 못 받아 `String(d).slice(0,10)` 로 **ISO 원문**을
 *   그대로 내보내고 있었다(#99b 와 같은 회귀, 2026-09-10 재발). 베껴 두면 또 갈라진다.
 *
 * 워크스페이스 타임존을 쓰지 않는다 — 공개 화면에는 그 맥락이 없고, 날짜만 보여주므로
 * 기기 로케일이면 충분하다. 시각까지 필요하면 formatDateTime(tz) 을 쓸 것.
 */
/** 공개 화면의 로케일 — **화면 글자와 같은 언어**(i18n). 여기 한 곳에서만 고른다(2026-09-22).
 *  ★ 2026-09-27 — 기기 언어(navigator)를 따로 읽었더니, 한국어로 쓰는 사람의 기기 언어가 영어면
 *    글자는 한국어인데 요일만 «Mon» 이 됐다(공유 일정 링크, Irene 신고). i18n 도 처음 방문자는
 *    기기 언어로 정해지므로 외부 방문자에게는 결과가 같고, 언어를 고른 사람에게는 그 언어를 따른다. */
export function publicLocale(): string {
  const lang = i18n.language || (typeof navigator !== 'undefined' ? navigator.language : '') || 'ko';
  return lang.startsWith('en') ? 'en-US' : 'ko-KR';
}

export function formatPublicDate(v?: string | Date | null): string {
  if (!v) return '';
  const raw = typeof v === 'string' ? `${v.slice(0, 10)}T00:00:00` : v;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat(publicLocale(), { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

/**
 * 공개 화면의 **날짜+시각**.
 *
 * ★ 2026-09-22 — 공개 서명 완료 화면이 `toLocaleString('ko-KR')` 를 못 박고 있어,
 *   영어 화면에 «Signed at 2026. 9. 22. 오후 6:21» 처럼 **글자는 영어인데 시각만 한국어**로 섞였다.
 *   서명은 링크를 받은 외부 사람이 보는 화면이다 — 기기 언어를 따른다.
 */
export function formatPublicDateTime(v?: string | Date | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat(publicLocale(), {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}
