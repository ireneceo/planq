// 종일 일정의 날짜 — 단일 원천 (2026-10-07 · 설계 docs/ALLDAY_EVENT_DATE_DESIGN.md, Fable 판정 U)
//
// 종일 일정은 «날짜» 다. 저장은 **UTC 자정**으로 부호화한다:
//   start_at = <첫날>T00:00:00Z · end_at = <마지막 날>T23:59:59Z · 날짜 = iso 앞 10자.
// 그래야 기기 시간대·워크스페이스 시간대(나중에 바꿔도)·rrule(UTC 라이브러리 → BYDAY 가 고른 요일 그대로)·
// 회차 식별자(toISOString().slice(0,10))·구글 {date} 가 **같은 날짜**를 말한다.
//
// 옛 행(기기 자정 instant — 서울 저장 = 전날 15:00Z)과 옛 화면·AI 가 보내는 값은 **가장 가까운 UTC 자정**으로
//   읽는다(반올림). 한 함수가 서버 쓰기 정규화·관용 읽기·백필을 다 한다 — 분기를 따로 두면 두 벌이 된다.
//   |시간대 오프셋| < 12시간이면 정확하다(NZ 서머타임 +13 만 예외 — 사용자 없음).
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (dateStr) => {
  const m = DATE_RE.exec(String(dateStr));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};

/** 시작 값 → 날짜(YYYY-MM-DD). 'YYYY-MM-DD…' 문자열이면 앞 10자(오프셋·시각 무시), 아니면 가장 가까운 UTC 자정. */
function allDayDateOf(v) {
  if (v == null) return null;
  if (typeof v === 'string' && DATE_RE.test(v) && !/T|\s/.test(v.slice(10, 11))) return v.slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) return v.slice(0, 10); // 오프셋 없는 벽시계 문자열
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  if (Number.isNaN(ms)) return null;
  return ymd(Math.round(ms / DAY_MS) * DAY_MS);
}

/** 끝 값 → 마지막 날(포함). 23:59(:59) 를 다음 자정으로 올려 하루 뺀다. 첫날보다 앞이면 첫날. */
function allDayLastDateOf(end, firstDate) {
  let last = null;
  if (end != null) {
    if (typeof end === 'string' && DATE_RE.test(end) && end.length === 10) last = end;
    else {
      const ms = end instanceof Date ? end.getTime() : new Date(end).getTime();
      if (!Number.isNaN(ms)) last = ymd(Math.round((ms + 60 * 1000) / DAY_MS) * DAY_MS - DAY_MS);
    }
  }
  if (!last) return firstDate || null;
  if (firstDate && last < firstDate) return firstDate;
  return last;
}

/** 날짜 두 개 → 저장할 instant 쌍 */
function allDayRange(firstDate, lastDate) {
  const s = dayMs(firstDate);
  const e = dayMs(lastDate || firstDate);
  return { start_at: new Date(s), end_at: new Date((Number.isNaN(e) ? s : Math.max(e, s)) + DAY_MS - 1000) };
}

/** 어떤 start/end 든 U 부호화로 — 서버 쓰기 정규화. 못 읽으면 null */
function normalizeAllDay(start, end) {
  const first = allDayDateOf(start);
  if (!first) return null;
  return allDayRange(first, allDayLastDateOf(end, first));
}

/** 저장된 행 → { date, last_date } */
function allDayDates(ev) {
  const date = allDayDateOf(ev.start_at);
  return { date, last_date: allDayLastDateOf(ev.end_at, date) };
}

/** 이미 U 부호화인가 (백필·헬스체크) */
function isUtcEncoded(start, end) {
  const s = new Date(start).getTime(), e = new Date(end).getTime();
  return s % DAY_MS === 0 && (e + 1000) % DAY_MS === 0;
}

/** 'YYYY-MM-DD' + n 일 */
function addDays(dateStr, n) { return ymd(dayMs(dateStr) + n * DAY_MS); }

module.exports = { allDayDateOf, allDayLastDateOf, allDayRange, normalizeAllDay, allDayDates, isUtcEncoded, addDays, DAY_MS };
