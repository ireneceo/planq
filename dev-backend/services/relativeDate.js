// 말한 날짜 표현 → 'YYYY-MM-DD' — **계산은 코드가 한다** (2026-10-04).
//
// «말로 추가» 가 날짜 산술을 LLM 에 맡겼더니, 10/4(일) 기준 «다음 주 화요일» 을 10/10(토)로 냈다(실측).
// 착지 폼에서 사람이 고칠 수 있다고 해도 요일조차 틀린 값을 심는 것은 고장이다.
// 그래서 흔한 표현(오늘·내일·모레·글피·N일 뒤·이번/다음/다다음 주 X요일·X요일)은 여기서 결정적으로 푼다.
// 못 푸는 표현(«15일», «월말» 등)은 null — 호출부는 LLM 값을 쓰되 요일이 말과 어긋나면 버린다.
// 주의 정의: 월요일 시작(한국 업무 관례, utils/datetime.mondayOfDateStr 와 같다).
const { addDaysStr, mondayOfDateStr } = require('../utils/datetime');

const KO_DAYS = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 7 };
const EN_DAYS = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

function isoDow(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** 표현에 요일이 있으면 그 요일(1=월..7=일), 없으면 null */
function spokenWeekday(when) {
  const s = String(when || '');
  const ko = /([월화수목금토일])\s*요일/.exec(s);
  if (ko) return KO_DAYS[ko[1]];
  const en = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(s);
  return en ? EN_DAYS[en[1].toLowerCase()] : null;
}

function resolveSpokenDate(when, todayLocal) {
  const s = String(when || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const low = s.toLowerCase();
  // N일 뒤 — «오늘부터 3일 뒤» 처럼 오늘·내일과 같이 나와도 이쪽이 뜻이다(먼저 본다)
  const after = /(\d{1,3})\s*일\s*(뒤|후)|in (\d{1,3}) days?/.exec(low);
  if (after) return addDaysStr(todayLocal, Number(after[1] || after[3]));
  // 날짜를 숫자로 말했으면(«10월 15일 목요일», «15일», «10/15») 코드가 풀지 않는다 — LLM 값 + 요일 대조로 넘긴다.
  //   요일만 보고 풀면 «10월 15일 목요일» 이 가장 가까운 목요일(10/8)로 덮인다(Fable 2026-10-04 실측).
  if (/\d{1,2}\s*월|\d{1,2}\s*일|\d{1,2}\s*[/.]\s*\d{1,2}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d|\d{1,2}(st|nd|rd|th)\b/.test(low)) return null;
  if (/모레|day after tomorrow/.test(low)) return addDaysStr(todayLocal, 2);
  if (/글피/.test(s)) return addDaysStr(todayLocal, 3);
  if (/내일|tomorrow/.test(low)) return addDaysStr(todayLocal, 1);
  if (/오늘|today|tonight/.test(low)) return todayLocal;
  const dow = spokenWeekday(s);
  if (!dow) return null;
  const monday = mondayOfDateStr(todayLocal);
  let weeks = null;
  if (/다다음\s*주|다담주/.test(s)) weeks = 2;
  else if (/다음\s*주|담주|차주|next week|next (mon|tue|wed|thu|fri|sat|sun)/.test(low)) weeks = 1;
  else if (/이번\s*주|금주|this week|this (mon|tue|wed|thu|fri|sat|sun)/.test(low)) weeks = 0;
  if (weeks !== null) return addDaysStr(monday, weeks * 7 + dow - 1);
  // 요일만 — 오늘 이후로 가장 가까운 그 요일(오늘이 그 요일이면 오늘)
  const diff = (dow - isoDow(todayLocal) + 7) % 7;
  return addDaysStr(todayLocal, diff);
}

/** LLM 이 낸 when_start 를 바로잡는다. 코드가 풀 수 있으면 날짜는 코드 값, 시각은 그대로. */
function correctWhenStart(whenStart, when, todayLocal, allDay) {
  const fixed = resolveSpokenDate(when, todayLocal);
  if (fixed) {
    const time = whenStart && /T(\d{2}:\d{2})$/.exec(whenStart);
    return `${fixed}T${time && !allDay ? time[1] : (time ? time[1] : '09:00')}`;
  }
  if (!whenStart) return null;
  // 못 푼 표현인데 요일을 말했고 LLM 날짜의 요일이 다르면 — 틀린 날짜를 심지 않는다
  const dow = spokenWeekday(when);
  if (dow && isoDow(whenStart.slice(0, 10)) !== dow) return null;
  return whenStart;
}

/** 프롬프트에 넣을 달력 — 오늘부터 3주, 요일과 주 구분을 붙인다 */
function calendarHint(todayLocal) {
  const names = ['', '월', '화', '수', '목', '금', '토', '일'];
  const monday = mondayOfDateStr(todayLocal);
  const lines = [];
  for (let w = 0; w < 3; w += 1) {
    const label = ['이번 주', '다음 주', '다다음 주'][w];
    const days = [];
    for (let i = 0; i < 7; i += 1) { const d = addDaysStr(monday, w * 7 + i); days.push(`${d}(${names[i + 1]})`); }
    lines.push(`${label}: ${days.join(' ')}`);
  }
  return lines.join('\n');
}

// ── 업무 마감용 (2026-11-18 — Q task «Cue에게 말하기» 가 «다음주 금요일까지» 를 LLM 산수로 11/24 로 냈다) ──
// 숫자로 말한 날짜도 푼다(«다음달 1일»·«11월 30일»·«11/30»·«15일까지»·«월말»). 없는 날(2월 30일)은 null.
function lastDayOfMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function ymdStr(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function validYmd(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= lastDayOfMonth(y, m) ? ymdStr(y, m, d) : null; }

function resolveExplicitDate(when, todayLocal) {
  const s = String(when || '').replace(/\s+/g, ' ');
  const [ty, tm, td] = todayLocal.split('-').map(Number);
  const nextMonth = () => (tm === 12 ? [ty + 1, 1] : [ty, tm + 1]);
  let m;
  if ((m = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(s))) {
    const mo = Number(m[1]); const d = Number(m[2]);
    const thisYear = validYmd(ty, mo, d);
    if (!thisYear) return null;
    return thisYear < todayLocal ? validYmd(ty + 1, mo, d) : thisYear;
  }
  if ((m = /(?<![\d/.])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/.exec(s))) {
    const mo = Number(m[1]); const d = Number(m[2]);
    const thisYear = validYmd(ty, mo, d);
    if (!thisYear) return null;
    return thisYear < todayLocal ? validYmd(ty + 1, mo, d) : thisYear;
  }
  if ((m = /(다음|담)\s*달\s*(\d{1,2})\s*일/.exec(s))) { const [y, mo] = nextMonth(); return validYmd(y, mo, Number(m[2])); }
  if ((m = /(이번|이)\s*달\s*(\d{1,2})\s*일/.exec(s))) return validYmd(ty, tm, Number(m[2]));
  if (/(다음|담)\s*달\s*(말|말일|마지막\s*날)/.test(s)) { const [y, mo] = nextMonth(); return ymdStr(y, mo, lastDayOfMonth(y, mo)); }
  if (/(이번\s*달\s*(말|말일|마지막\s*날)|월말)/.test(s)) return ymdStr(ty, tm, lastDayOfMonth(ty, tm));
  if ((m = /(?<![\d월])(\d{1,2})\s*일\s*(까지|에|날|마감)/.exec(s))) {
    const d = Number(m[1]);
    if (d >= td) return validYmd(ty, tm, d);
    const [y, mo] = nextMonth(); return validYmd(y, mo, d);
  }
  return null;
}

// 날짜 표현이 몇 개인가 — 둘 이상이면(«월요일부터 금요일까지»·«A 는 내일, B 는 금요일») 마감을 하나로 못 박지 않는다.
const DATE_MENTION_RES = [
  /\d{1,2}\s*월\s*\d{1,2}\s*일/g,
  /(?<![\d/.])\d{1,2}\s*\/\s*\d{1,2}(?![\d/])/g,
  /(다음|담|이번|이)\s*달\s*(\d{1,2}\s*일|말일|말|마지막\s*날)/g,
  /월말/g,
  /\d{1,3}\s*일\s*(뒤|후)|in \d{1,3} days?/gi,
  /(?<![\d월])\d{1,2}\s*일\s*(까지|에|날|마감)/g,
  /[월화수목금토일]\s*요일|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
  /오늘|내일|모레|글피|\btoday\b|\btomorrow\b|\btonight\b/gi,
];
function countDateMentions(text) {
  let s = String(text || '');
  let n = 0;
  for (const re of DATE_MENTION_RES) {
    s = s.replace(re, () => { n += 1; return ' § '; });
  }
  return n;
}

/** 업무 요청 한 문장에서 마감 날짜 하나를 코드로 푼다. 날짜 표현이 정확히 하나일 때만 — 아니면 null(LLM 몫). */
function resolveDeadline(text, todayLocal) {
  if (countDateMentions(text) !== 1) return null;
  return resolveExplicitDate(text, todayLocal) || resolveSpokenDate(text, todayLocal);
}

const KO_DOW_NAMES = ['', '월', '화', '수', '목', '금', '토', '일'];
const EN_DOW_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function dowLabel(dateStr, language = 'en') {
  const d = isoDow(dateStr);
  return language === 'ko' ? KO_DOW_NAMES[d] : EN_DOW_NAMES[d];
}

module.exports = { resolveSpokenDate, correctWhenStart, calendarHint, spokenWeekday, resolveExplicitDate, resolveDeadline, countDateMentions, dowLabel };
