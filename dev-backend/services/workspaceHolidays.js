// 워크스페이스 근무 달력 (#424) — 근무 요일 · 휴일 · 근무일 계수의 **단일 원천**.
// 설계 docs/WORKDAY_HOLIDAY_DESIGN.md §2 · §3
//
// 이 파일을 쓰는 곳: 가용시간(memberCapacity) · 휴가 차감일(leaveTransition) · 상담 예약 슬롯(booking) ·
//   휴일 설정 라우트(business_holidays). 넷이 "근무일" 을 각자 세면 화면·보고서·잔여가 갈라진다.
//
// ★ 근무 요일은 새 컬럼이 아니다 — `businesses.work_hours`(예약이 이미 쓰는 요일별 시간)에서 파생한다.
// ★ 휴일·휴가는 **근무 요일에 떨어진 날만** 센다. 토요일 공휴일은 가용시간을 줄이지 않는다.
// ★ 계산 경로는 읽기만 한다. 국가 행을 채우는 것(ensureNationalRows)은 설정 저장·설정 조회·cron 만 한다.
const { Op } = require('sequelize');
const { WorkspaceHoliday, Business } = require('../models');
const { ymd, addDaysStr, todayInTz, dateStrInTz } = require('../utils/datetime');

// config/holidays/<CC>.json 전부 — KR 은 손으로 대조한 정본, 나머지는 scripts/gen-holiday-datasets.js 생성물.
//   ★ CN·TW·VN 은 두지 않는다(Fable 2026-10-08 FAIL) — 라이브러리가 부분휴일(여성·청년·아동·군인)을 전원 휴일로 싣고,
//     2025 개정·Tết 연휴·대체휴일·조휴(주말 근무일)를 못 담는다. 손으로 대조한 정본이 생기기 전까지 선택지에서 뺀다.
//   파일을 넣으면 선택지에 자동으로 뜬다(화면 이름은 settings.json holidays.country<CC>).
const HOLIDAY_DIR = require('path').join(__dirname, '..', 'config', 'holidays');
const DATASETS = Object.fromEntries(require('fs').readdirSync(HOLIDAY_DIR)
  .filter((f) => /^[A-Z]{2}\.json$/.test(f))
  .map((f) => [f.slice(0, 2), require(require('path').join(HOLIDAY_DIR, f))]));
/** `holiday_country` 허용값 = 데이터셋 키. 코드와 데이터가 한 곳이다. */
const SUPPORTED_COUNTRIES = Object.keys(DATASETS);

function isSupportedCountry(cc) {
  return typeof cc === 'string' && SUPPORTED_COUNTRIES.includes(cc);
}

function datasetYear(cc, year) {
  const ds = DATASETS[cc];
  return (ds && Array.isArray(ds[String(year)])) ? ds[String(year)] : [];
}

const dowOf = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** 근무 요일 집합(0=일). booking.workHoursOf 와 같은 해석 — 거기 null 인 요일은 쉬는 날이다. */
function workWeekdaysOf(biz) {
  const { workHoursOf } = require('./booking');   // 지연 require — booking 이 이 파일을 부른다
  const hours = workHoursOf(biz || {});
  const set = new Set();
  hours.forEach((h, i) => { if (h) set.add(i); });
  return set;
}

async function loadBiz(businessId, transaction) {
  return Business.findByPk(businessId, { attributes: ['id', 'work_hours', 'timezone', 'holiday_country'], transaction });
}

/**
 * 기간 [from,to] 의 근무 달력.
 *  - weekdays: 근무 요일 집합
 *  - holidays: is_off=1 이고 **근무 요일에 떨어진** 휴일 [{date,name,name_en}] (날짜 오름차순)
 *  - holidaySet: 위 날짜 집합
 * 휴일 행이 하나도 없으면 holidays=[] — 그 워크스페이스의 숫자는 종전과 같다(불변 조건 §3.3-1).
 */
async function getWorkCalendar(businessId, fromYmd, toYmd, { biz = null, transaction } = {}) {
  const b = biz || await loadBiz(businessId, transaction);
  const weekdays = workWeekdaysOf(b);
  const rows = await WorkspaceHoliday.findAll({
    where: { business_id: businessId, is_off: true, date: { [Op.between]: [fromYmd, toYmd] } },
    attributes: ['date', 'name', 'name_en'],
    order: [['date', 'ASC']],
    transaction,
  });
  const holidays = [];
  for (const r of rows) {
    const d = ymd(r.date);
    if (!weekdays.has(dowOf(d))) continue;
    holidays.push({ date: d, name: r.name, name_en: r.name_en || null });
  }
  return { weekdays, holidays, holidaySet: new Set(holidays.map((h) => h.date)) };
}

/** [from,to] 안에서 근무 요일이면서 휴일이 아닌 날짜 수. */
function countWorkdays(fromYmd, toYmd, cal) {
  if (!fromYmd || !toYmd || fromYmd > toYmd) return 0;
  let n = 0;
  for (let d = fromYmd; d <= toYmd; d = addDaysStr(d, 1)) {
    if (cal.weekdays.has(dowOf(d)) && !cal.holidaySet.has(d)) n += 1;
  }
  return n;
}

/** 그 날이 근무일인가(근무 요일 ∧ 휴일 아님). */
function isWorkday(d, cal) {
  return cal.weekdays.has(dowOf(d)) && !cal.holidaySet.has(d);
}

/**
 * 국가 공휴일 행을 그 해의 fromDate 이후만큼 채운다 — **없는 날짜만** INSERT. 있는 행(꺼진 행·직접 추가 행 포함)은 건드리지 않는다.
 * 멱등. 반환: 새로 넣은 건수.
 */
async function ensureNationalRows(businessId, cc, year, { transaction, fromDate } = {}) {
  // ★ fromDate(그 워크스페이스의 오늘)는 **필수** — 모든 문(국가 저장·설정 조회·cron)이 오늘 이후만 넣는다(과거 불변).
  //   한 문만 막으면 설정 화면이 저장 직후 다시 읽는 GET 이나 다음 날 cron 이 지난 날짜를 채워 같은 결과가 하루 늦게 난다
  //   (Fable 2026-10-08 재검증 실측). 빠뜨리면 조용히 과거를 쓰지 않도록 던진다.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromDate || ''))) throw new Error('ensureNationalRows: fromDate (YYYY-MM-DD) required');
  if (!isSupportedCountry(cc)) return 0;
  const list = datasetYear(cc, year).filter((h) => h.date >= fromDate);
  if (!list.length) return 0;
  const existing = await WorkspaceHoliday.findAll({
    where: { business_id: businessId, date: { [Op.in]: list.map((h) => h.date) } },
    attributes: ['date'], transaction,
  });
  const have = new Set(existing.map((r) => ymd(r.date)));
  const add = list.filter((h) => !have.has(h.date)).map((h) => ({
    business_id: businessId, date: h.date, name: h.name, name_en: h.name_en || null,
    source: 'national', is_off: true, created_by: null,
  }));
  if (add.length) await WorkspaceHoliday.bulkCreate(add, { transaction, ignoreDuplicates: true });
  return add.length;
}

/**
 * 국가가 바뀌었을 때 — 오늘 이후의 national 행을 지우고 새 국가로 채운다(올해·내년).
 * 지난 행은 남긴다: 그 주의 보고서가 그 행으로 계산됐다. custom 은 손대지 않는다.
 */
async function applyCountryChange(businessId, nextCc, { transaction, tz, prevCc = null } = {}) {
  const today = todayInTz(tz || 'Asia/Seoul');
  // ★ 국가를 **끄기만** 할 때는 꺼 둔 행(is_off=0, 툼스톤)을 남긴다 — 다시 켜면 관리자가 끈 날이
  //   되살아나면 안 된다(Fable 2026-10-02 실측). 꺼진 행은 계산에 안 들어가므로 남겨도 무해하다.
  //   다른 국가로 **바꿀** 때는 옛 국가 행을 전부 지운다(툼스톤은 그 나라 날짜에만 뜻이 있다).
  //   (한 국가를 끄고 다시 켜는 것은 «바꾸기» 가 아니다 — 그때 남겨 둔 툼스톤이 ensure 를 막아 끈 날이 유지된다.)
  const where = { business_id: businessId, source: 'national', date: { [Op.gte]: today } };
  const switching = isSupportedCountry(prevCc) && isSupportedCountry(nextCc) && prevCc !== nextCc;
  if (!switching) where.is_off = true;
  const removed = await WorkspaceHoliday.destroy({ where, transaction });
  let added = 0;
  if (isSupportedCountry(nextCc)) {
    const y = Number(today.slice(0, 4));
    // ★ 오늘부터만 넣는다 — 과거 불변. 지난 날짜를 넣으면 ①처음 켜는 순간 지난 달 Insights·보고서 숫자가 바뀌고
    //   ②국가를 바꾸면 과거가 두 나라 휴일의 합집합이 된다(Fable 2026-10-08 실측: KR→JP 9월 휴일 5건).
    added += await ensureNationalRows(businessId, nextCc, y, { transaction, fromDate: today });
    added += await ensureNationalRows(businessId, nextCc, y + 1, { transaction, fromDate: today });
  }
  return { removed, added };
}

/** 매일 cron — 국가를 켠 워크스페이스에 올해·(11월 이후면) 내년 행을 채운다. 데이터셋에 해가 없으면 0. */
async function runHolidayYearCron(now = new Date()) {
  const bizs = await Business.findAll({
    where: { holiday_country: { [Op.ne]: null } },
    attributes: ['id', 'holiday_country', 'timezone'],
  });
  let added = 0;
  const missing = new Set();
  for (const b of bizs) {
    const today = dateStrInTz(now, b.timezone || 'Asia/Seoul');   // 인자 now 를 실제로 쓴다(검산에서 날짜를 넣을 수 있게)
    const y = Number(today.slice(0, 4));
    // 데이터셋에 그 해가 없으면 조용히 0 이 된다 — 경고로 남긴다(11월부터는 내년 공백도).
    if (!datasetYear(b.holiday_country, y).length) missing.add(`${b.holiday_country}:${y}`);
    added += await ensureNationalRows(b.id, b.holiday_country, y, { fromDate: today });
    if (Number(today.slice(5, 7)) >= 11) {
      if (!datasetYear(b.holiday_country, y + 1).length) missing.add(`${b.holiday_country}:${y + 1}`);
      added += await ensureNationalRows(b.id, b.holiday_country, y + 1, { fromDate: today });
    }
  }
  if (missing.size) console.warn('[holidays] dataset year missing — run scripts/gen-holiday-datasets.js / update KR.json:', [...missing].join(', '));
  return { businesses: bizs.length, added, missing: [...missing] };
}

module.exports = {
  SUPPORTED_COUNTRIES, isSupportedCountry, datasetYear,
  workWeekdaysOf, getWorkCalendar, countWorkdays, isWorkday,
  ensureNationalRows, applyCountryChange, runHolidayYearCron,
};
