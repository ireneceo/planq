// 출근 묻기 · 어제 퇴근 확인 · 그날 첫 진입/마지막 활동 — 판정 한 곳 (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §3·§4)
//
// 화면은 GET /api/attendance/today 가 주는 prompt·close_check 가 있을 때만 묻는다(조건을 다시 계산하지 않는다).
// ★ first_seen_at·last_act_at 은 **본인 전용**이다 — 팀·통계·presence 응답에 싣지 않는다(FocusSession 과 같은 선).
//   본인이 받아들여 출근 시각이 된 뒤에만 근태 기록으로 보인다.
const { Op } = require('sequelize');
const {
  AttendanceActivity, AttendanceDay, Business, User, LeaveRequest,
} = require('../models');
const { ymd, addDaysStr, startOfDayInTz, dateStrInTz } = require('../utils/datetime');

const SNOOZE_MS = 60 * 60 * 1000;      // «아직이에요» 뒤 1시간 조용
const MAX_PROMPTS = 3;                  // 하루 최대 3번 — 3번째 «아직» 은 «오늘은 안 해요»
const CLOSE_CHECK_DAYS = 14;            // 본인 정정 창과 같은 14일
const DEFAULT_WINDOW = [7 * 60, 20 * 60]; // work_hours 가 비어 있으면 07:00~20:00

async function tzOf(businessId) {
  const biz = await Business.findByPk(businessId, { attributes: ['timezone'] });
  return biz?.timezone || 'Asia/Seoul';
}

async function findOrCreateRow({ businessId, userId, workDate }) {
  const where = { business_id: businessId, user_id: userId, work_date: workDate };
  let row = await AttendanceActivity.findOne({ where });
  if (row) return row;
  try {
    row = await AttendanceActivity.create(where);
  } catch (e) {
    // 동시에 두 요청(위젯·카드)이 만들려 했다 — 상대가 이겼으니 다시 읽는다.
    if (e && e.name === 'SequelizeUniqueConstraintError') row = await AttendanceActivity.findOne({ where });
    else throw e;
  }
  return row;
}

/** 보이는 상태로 /today 를 부른 순간 — 그날 첫 진입 시각을 한 번만 남긴다. */
async function markSeen({ businessId, userId, now = new Date() }) {
  const tz = await tzOf(businessId);
  const workDate = dateStrInTz(now, tz);
  const row = await findOrCreateRow({ businessId, userId, workDate });
  if (!row.first_seen_at || new Date(row.first_seen_at) > now) await row.update({ first_seen_at: now });
  return row;
}

// ─── 사람이 직접 한 쓰기 = 활동 (§4.2) ───────────────────────────
// 각 라우트가 워크스페이스 확인을 끝낸 자리에서 touch() 한 줄. **전역 훅 금지** — 숨은 탭 주기 호출·
//   토큰 갱신·heartbeat 가 활동으로 잡혀 퇴근 추정이 자정으로 밀린다. AI 앱·cron 쓰기도 부르지 않는다.
// (워크스페이스·사람)당 5분에 한 번만 DB 에 쓰고, 실패해도 던지지 않는다(근태가 본 기능을 막으면 안 된다).
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const lastTouch = new Map();
function touch(businessId, userId, now = new Date()) {
  const b = Number(businessId); const u = Number(userId);
  if (!b || !u) return;
  const key = `${b}:${u}`;
  const prev = lastTouch.get(key) || 0;
  if (now.getTime() - prev < TOUCH_EVERY_MS) return;
  lastTouch.set(key, now.getTime());
  if (lastTouch.size > 20000) lastTouch.clear();   // 프로세스 메모리 상한(드문 일)
  (async () => {
    const { moduleOnFor } = require('./modules');
    if (!(await moduleOnFor(b, 'attendance'))) return;
    if (!(await require('./attendanceTracking').isTracked(b, u))) return;   // 출퇴근 안 함 — 활동 흔적도 남기지 않는다(Fable 판정 4)
    const tz = await tzOf(b);
    const workDate = dateStrInTz(now, tz);
    const row = await findOrCreateRow({ businessId: b, userId: u, workDate });
    const patch = { last_act_at: now };
    if (!row.first_seen_at) patch.first_seen_at = now;
    await row.update(patch);
  })().catch((e) => console.warn('[attendance touch]', e.message));
}

/** 자동 마감 추정용 — 그날 마지막으로 뭔가 한 시각(없으면 null). 노출하지 않는다. */
async function lastActAt({ businessId, userId, workDate }) {
  const row = await AttendanceActivity.findOne({
    where: { business_id: businessId, user_id: userId, work_date: workDate },
    attributes: ['last_act_at'],
  });
  return row?.last_act_at ? new Date(row.last_act_at) : null;
}

// ─── 묻는 조건 (§3.2) ────────────────────────────────────────────
/** 그날 묻는 시간대 [시작, 끝](Date) — 쉬는 날·공휴일이면 null. */
async function workWindow({ businessId, userId = null, workDate, tz }) {
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'work_hours', 'timezone', 'holiday_country'] });
  const { workHoursOf, normalizeWorkHours } = require('./booking');
  const { getWorkCalendar, isWorkday } = require('./workspaceHolidays');
  const dow = new Date(`${workDate}T00:00:00Z`).getUTCDay();
  // 고정 근무(docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §4 «같이 고치는 한 곳») — 그 사람 그날 일정이 fixed 면
  //   예약 받는 시간(work_hours) 대신 근태 일정으로 창을 잡는다. 그 요일에 일정이 없으면 쉬는 날. 유연이면 아래 종전 그대로.
  if (userId) {
    const sched = await require('./attendanceSchedule').resolveSchedule(businessId, userId, workDate);
    if (sched.mode === 'fixed' && sched.row?.hours) {
      const h = sched.row.hours[dow];
      if (!h) return null;
      const { WorkspaceHoliday } = require('../models');
      const off = await WorkspaceHoliday.findOne({ where: { business_id: businessId, is_off: true, date: workDate }, attributes: ['id'] });
      if (off) return null;
      const base0 = startOfDayInTz(workDate, tz).getTime();
      return [new Date(base0 + Math.max(0, h[0] - 120) * 60000), new Date(base0 + h[1] * 60000)];
    }
  }
  const cal = await getWorkCalendar(businessId, workDate, workDate, { biz });
  if (!isWorkday(workDate, cal)) return null;
  let win;
  if (normalizeWorkHours(biz?.work_hours)) {
    const h = workHoursOf(biz)[dow];
    if (!h) return null;
    win = [Math.max(0, h[0] - 120), h[1]];
  } else {
    win = DEFAULT_WINDOW;
  }
  const base = startOfDayInTz(workDate, tz).getTime();
  return [new Date(base + win[0] * 60000), new Date(base + win[1] * 60000)];
}

/**
 * 묻는 창이 제안하는 출근 시각 = 그날 첫 진입. 단 **묻는 시간대 시작보다 이르면 쓰지 않는다** —
 *   새벽에 폰을 잠깐 연 것을 «01:00 부터 출근» 으로 제안하면 안 된다. 그때는 null(= 지금).
 *   clock-in {observed:true} 도 이 값 하나를 쓴다(묻는 창이 보여 준 시각과 찍히는 시각이 같아야 한다).
 */
async function observedStart({ businessId, userId, now = new Date() }) {
  const tz = await tzOf(businessId);
  const workDate = dateStrInTz(now, tz);
  const row = await AttendanceActivity.findOne({
    where: { business_id: businessId, user_id: userId, work_date: workDate },
    attributes: ['first_seen_at'],
  });
  const seen = row?.first_seen_at ? new Date(row.first_seen_at) : null;
  if (!seen || seen > now) return null;
  const win = await workWindow({ businessId, userId, workDate, tz });
  if (win && seen < win[0]) return null;
  return seen;
}

async function onFullDayLeave({ businessId, userId, workDate }) {
  const l = await LeaveRequest.findOne({
    where: {
      business_id: businessId, user_id: userId, status: 'approved', unit: 'full_day',
      start_date: { [Op.lte]: workDate }, end_date: { [Op.gte]: workDate },
    },
    attributes: ['id'],
  });
  return !!l;
}

function snoozed(row, now) {
  if (!row) return false;
  if (row.prompt_answer === 'not_today') return true;
  return !!(row.prompt_snooze_until && new Date(row.prompt_snooze_until) > now);
}

/**
 * /today 가 부르는 판정. 돌려주는 값: { prompt, close_check } (각 null 가능).
 *   prompt      = { kind:'check_in', proposed_at, first_seen_at }
 *   close_check = { day_id, work_date, clock_out_at }
 * day = 오늘 근태 행(없으면 null). 근태 기능 켜짐·멤버 확인은 라우트가 이미 했다.
 */
async function promptFor({ businessId, userId, day, now = new Date() }) {
  const u = await User.findByPk(userId, { attributes: ['id', 'attendance_prompt_on'] });
  if (!u || u.attendance_prompt_on === false) return { prompt: null, close_check: null, prompt_status: { state: 'off' } };
  // 이 워크스페이스에서 «출퇴근 안 함» — 출근도 어제 퇴근 확인도 묻지 않는다(services/attendanceTracking).
  if (!(await require('./attendanceTracking').isTracked(businessId, userId))) {
    return { prompt: null, close_check: null, prompt_status: { state: 'not_tracked' } };
  }
  const tz = await tzOf(businessId);
  const workDate = dateStrInTz(now, tz);
  const row = await AttendanceActivity.findOne({
    where: { business_id: businessId, user_id: userId, work_date: workDate },
  });
  if (snoozed(row, now)) {
    // 출근 기록이 있으면 미룬 답과 상관없이 «출근 기록 있음» 이 이유다(출근은 어차피 묻지 않는다)
    const status = day ? { state: 'checked_in' } : row.prompt_answer === 'not_today'
      ? { state: 'not_today' }
      : { state: 'snoozed', until: row.prompt_snooze_until };
    return { prompt: null, close_check: null, prompt_status: status };
  }

  // 어제(가장 최근 근무일 하나) 자동 마감 확인 — 근무시간대와 무관하게.
  let closeCheck = null;
  const last = await AttendanceDay.findOne({
    where: { business_id: businessId, user_id: userId, work_date: { [Op.lt]: workDate } },
    order: [['work_date', 'DESC']],
    attributes: ['id', 'work_date', 'clock_out_at', 'auto_closed', 'close_confirmed_at', 'state'],
  });
  if (last && last.auto_closed && !last.close_confirmed_at && last.state === 'done'
      && ymd(last.work_date) >= addDaysStr(workDate, -CLOSE_CHECK_DAYS)) {
    closeCheck = { day_id: last.id, work_date: ymd(last.work_date), clock_out_at: last.clock_out_at };
  }

  let prompt = null;
  // prompt_status — 지금 묻지 않으면 **왜** 안 묻는지(근태 페이지가 그대로 보여 준다 · 2026-11-23 Irene
  //   «안 뜨는 게 맞는 조건이면 그 조건을 화면에 알려 주세요»). 판정은 아래 한 벌 그대로 — 값만 이름 붙여 내보낸다.
  let status;
  const win = day ? null : await workWindow({ businessId, userId, workDate, tz });
  if (day) status = { state: 'checked_in' };
  else if (!win) status = { state: 'day_off' };
  else if (now < win[0]) status = { state: 'before', from: win[0], until: win[1] };
  else if (now > win[1]) status = { state: 'after', from: win[0], until: win[1] };
  else if (await onFullDayLeave({ businessId, userId, workDate })) status = { state: 'leave' };
  else {
    const seen = await observedStart({ businessId, userId, now });
    prompt = { kind: 'check_in', proposed_at: seen || now, first_seen_at: seen };
    status = { state: 'asking', from: win[0], until: win[1] };
  }
  return { prompt, close_check: closeCheck, prompt_status: status };
}

/** «아직이에요»(later) · «오늘은 안 해요»(not_today) · «지금 다시 묻기»(ask_again). 3번째 later 는 not_today. */
async function answerPrompt({ businessId, userId, answer, now = new Date() }) {
  if (!['later', 'not_today', 'ask_again'].includes(answer)) {
    const e = new Error('invalid_answer'); e.code = 'invalid_answer'; e.status = 400; throw e;
  }
  const tz = await tzOf(businessId);
  const workDate = dateStrInTz(now, tz);
  const row = await findOrCreateRow({ businessId, userId, workDate });
  // «지금 다시 묻기»(근태 페이지) — 본인이 오늘 미룬 답을 거둔다. 기록(출근·퇴근 시각)은 건드리지 않는다.
  if (answer === 'ask_again') {
    await row.update({ prompt_answer: null, prompt_count: 0, prompt_snooze_until: null });
    return { answer: null, count: 0 };
  }
  const count = (row.prompt_count || 0) + 1;
  const final = answer === 'not_today' || count >= MAX_PROMPTS ? 'not_today' : 'later';
  await row.update({
    prompt_answer: final,
    prompt_count: count,
    prompt_snooze_until: final === 'later' ? new Date(now.getTime() + SNOOZE_MS) : null,
  });
  return { answer: final, count };
}

/** 오늘 첫 진입 시각(서버가 본 값, 그대로) — 자동 출근 알림의 «먼저 들어와 계셨어요» 가 쓴다. */
async function firstSeenToday({ businessId, userId, now = new Date() }) {
  const tz = await tzOf(businessId);
  const workDate = dateStrInTz(now, tz);
  const row = await AttendanceActivity.findOne({
    where: { business_id: businessId, user_id: userId, work_date: workDate },
    attributes: ['first_seen_at'],
  });
  return row?.first_seen_at ? new Date(row.first_seen_at) : null;
}

/** 90일 지난 활동 행 정리 — 자동마감 cron 이 부른다. */
async function purgeOldActivity(now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  return AttendanceActivity.destroy({ where: { work_date: { [Op.lt]: cutoff } } });
}

module.exports = {
  markSeen, touch, lastActAt, promptFor, observedStart, answerPrompt, firstSeenToday, purgeOldActivity,
  SNOOZE_MS, MAX_PROMPTS,
};
