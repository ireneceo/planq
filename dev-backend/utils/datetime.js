// 워크스페이스 타임존 기준 날짜 유틸.
// Q Task 마감·주간·월간 집계처럼 "오늘/이번 주"의 경계가 워크스페이스 타임존에 의존하는
// 계산은 전부 이 유틸을 거쳐야 한다. 서버 로컬 시간 기준 `new Date()` 직접 사용 금지.

// 'YYYY-MM-DD' (주어진 tz 기준)
function dateStrInTz(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  if (!tz) return d.toISOString().slice(0, 10);
  // en-CA 는 YYYY-MM-DD 포맷 보장
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(d);
}

// 'YYYY-MM-DD' 오늘
function todayInTz(tz) {
  return dateStrInTz(new Date(), tz);
}

// 주어진 'YYYY-MM-DD' 문자열을 기준으로 해당 주의 월요일 'YYYY-MM-DD' 반환
// (요일 계산은 tz 와 무관 — 이미 해당 tz 에서 산출된 로컬 날짜 문자열이라고 가정)
function mondayOfDateStr(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  // UTC Date 로 생성해서 요일/덧셈이 tz 영향을 받지 않게 한다
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Sun .. 6=Sat
  const diff = dt.getUTCDate() - day + (day === 0 ? -6 : 1);
  dt.setUTCDate(diff);
  return dt.toISOString().slice(0, 10);
}

function addDaysStr(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// ISO week 'YYYY-Www' → 해당 주 월요일 'YYYY-MM-DD'
function mondayOfIsoWeek(isoWeek) {
  const [y, w] = isoWeek.split('-W').map(Number);
  // ISO week 1 = 1월 4일을 포함하는 주
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  mondayOfWeek1.setUTCDate(mondayOfWeek1.getUTCDate() + (w - 1) * 7);
  return mondayOfWeek1.toISOString().slice(0, 10);
}

/**
 * DATEONLY 값을 'YYYY-MM-DD' 문자열로 통일한다.
 *
 * ★ 함정: Sequelize DATEONLY 는 이 프로젝트에서 **Date 객체**로 돌아온다(전역 toJSON override 영향).
 *   그래서 `new Date(`${row.start_date}T00:00:00Z`)` 같은 관용구가 조용히 NaN 이 되고,
 *   날짜 계산 결과가 0 으로 나온다 — 에러도 안 나고 화면엔 그냥 "0일" 로 찍힌다(#208 실측).
 *   DATEONLY 는 UTC 자정으로 들고 있으므로 ISO 앞 10자가 그 날짜다.
 */
function ymd(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

module.exports = {
  dateStrInTz,
  ymd,
  todayInTz,
  mondayOfDateStr,
  addDaysStr,
  mondayOfIsoWeek,
};
