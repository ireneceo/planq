// 워크스페이스 타임존 기준 날짜/시간 표시 포맷터.
// DB 는 UTC 저장, 모든 사용자 대면 표시는 워크스페이스 tz 로 변환한다.
// useTimeFormat 훅을 통해 컴포넌트에서 사용한다.

function safeDate(iso: string | Date): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// 'YYYY-MM-DD' 또는 ISO 문자열을 받아 'M월 d일' 혹은 'MM/DD' 형태로 표시 (tz 기준)
export function formatDate(iso: string | Date, tz: string, locale = 'ko-KR'): string {
  const d = safeDate(iso);
  if (!d) return '';
  return new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'short', day: 'numeric' }).format(d);
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
