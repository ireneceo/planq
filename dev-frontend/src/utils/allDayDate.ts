// 종일 일정의 날짜 — 화면 쪽 단일 원천 (2026-10-07 · 설계 docs/ALLDAY_EVENT_DATE_DESIGN.md, Fable 판정 U)
//   서버 dev-backend/utils/allDayDate.js 와 **같은 규칙**이다(서버가 쓰기 때 한 번 더 정규화한다).
//   종일 = 날짜. 저장은 UTC 자정: start = <첫날>T00:00:00Z · end = <마지막 날>T23:59:59Z.
//   옛 값(기기 자정 instant)은 가장 가까운 UTC 자정으로 읽는다(반올림) — 기기·워크스페이스 시간대와 무관하게 같은 날짜.
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const PLAIN_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;   // 오프셋 없는 날짜·벽시계 문자열

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (dateStr: string) => {
  const m = DATE_RE.exec(dateStr);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

/** 시작 값 → 날짜 'YYYY-MM-DD' */
export function allDayDateOf(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string' && PLAIN_RE.test(v)) return v.slice(0, 10);
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  if (Number.isNaN(ms)) return null;
  return ymd(Math.round(ms / DAY_MS) * DAY_MS);
}

/** 끝 값 → 마지막 날(포함). 첫날보다 앞이면 첫날 */
export function allDayLastDateOf(end: string | Date | null | undefined, firstDate?: string | null): string | null {
  let last: string | null = null;
  if (end != null) {
    if (typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end)) last = end;
    else if (typeof end === 'string' && PLAIN_RE.test(end)) last = end.slice(0, 10);
    else {
      const ms = end instanceof Date ? end.getTime() : new Date(end).getTime();
      if (!Number.isNaN(ms)) last = ymd(Math.round((ms + 60 * 1000) / DAY_MS) * DAY_MS - DAY_MS);
    }
  }
  if (!last) return firstDate ?? null;
  if (firstDate && last < firstDate) return firstDate;
  return last;
}

/** 날짜 두 개 → 저장할 ISO 쌍 */
export function allDayIsoRange(firstDate: string, lastDate?: string | null): { start_at: string; end_at: string } {
  const s = dayMs(firstDate);
  const e = dayMs(lastDate || firstDate);
  return {
    start_at: new Date(s).toISOString(),
    end_at: new Date((Number.isNaN(e) ? s : Math.max(e, s)) + DAY_MS - 1000).toISOString(),
  };
}

/** 저장된 종일 → 날짜 두 개 */
export function allDayDates(ev: { start_at: string; end_at: string }): { date: string | null; last: string | null } {
  const date = allDayDateOf(ev.start_at);
  return { date, last: allDayLastDateOf(ev.end_at, date) };
}

/** 'YYYY-MM-DD' → 그 날짜 **기기 로컬** 자정 Date (격자·편집칸이 로컬 필드를 읽는다). end=true 면 23:59:59 */
export function localDateOf(dateStr: string, end = false): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return end ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
}
