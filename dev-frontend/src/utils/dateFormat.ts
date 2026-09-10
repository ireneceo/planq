// 워크스페이스 타임존 기준 날짜/시간 표시 포맷터.
// DB 는 UTC 저장, 모든 사용자 대면 표시는 워크스페이스 tz 로 변환한다.
// useTimeFormat 훅을 통해 컴포넌트에서 사용한다.

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

// 'HH:mm' 24h (tz 기준)
export function formatTime(iso: string | Date, tz: string, locale = 'ko-KR'): string {
  const d = safeDate(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

// 'YYYY-MM-DD HH:mm' (tz 기준)
export function formatDateTime(iso: string | Date, tz: string, locale = 'ko-KR'): string {
  const d = safeDate(iso);
  if (!d) return '';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = formatTime(d, tz, locale);
  return `${date} ${time}`;
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
export function formatPublicDate(v?: string | Date | null): string {
  if (!v) return '';
  const raw = typeof v === 'string' ? `${v.slice(0, 10)}T00:00:00` : v;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(v);
  const locale = typeof navigator !== 'undefined' && navigator.language.startsWith('en') ? 'en-US' : 'ko-KR';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}
