// 근태 지각·조퇴·미출근 판정 — 한 벌 (docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §3)
//
// ★ 저장하지 않고 조회 때 계산한다(D3). 원장 정정·휴가 뒤늦은 승인·휴일 변경은 판정에 바로 반영된다(의도).
//   지난 판정이 일정 변경으로 바뀌지 않는 것은 일정이 이력(effective_from)이라서다 — services/attendanceSchedule.
// ★ 미출근은 행이 없다(D4) — 근무 달력 − 근태 행 − 승인 휴가로 계산한다. 빈 행을 만들지 않는다.
// ★ 결과는 본인·관리자 응답에만 싣는다. 소켓 방송(attendanceTransition.broadcast — 워크스페이스 전원)에는 절대 싣지 않는다(§6).
// 모든 시각은 워크스페이스 tz 벽시계 분(초 버림 — 09:00:59 = 09:00).
const { Op } = require('sequelize');
const {
  AttendanceDay, AttendanceEvent, AttendanceException, AttendanceFixRequest, BusinessMember, LeaveRequest, WorkspaceHoliday,
} = require('../models');
const S = require('./attendanceSchedule');
const { ymd, addDaysStr, dateStrInTz, startOfDayInTz } = require('../utils/datetime');

const MAX_RANGE_DAYS = 62;

const _fmt = new Map();
/** tz 벽시계 {date:'YYYY-MM-DD', min: 0~1439}. */
function wallOf(at, tz) {
  let f = _fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    _fmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(at)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}
/** 그날(workDate) 기준 분 — 다음 날로 넘어간 시각(자정 분할 24:00 퇴근)은 1440 이상. */
function minuteOnDay(at, workDate, tz) {
  const w = wallOf(at, tz);
  if (w.date === workDate) return w.min;
  if (w.date > workDate) return 1440 + (w.date === addDaysStr(workDate, 1) ? w.min : 1440);
  return 0;
}
const hhmm = (m) => (m === null || m === undefined ? null
  : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const dowOf = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** «사람 출근» — 유효 출근 중 자정 이어받기(auto_midnight)가 아닌 첫 것. /stats 평균 출근과 같은 술어. */
function firstHumanClockIn(events) {
  const ins = (events || []).filter((e) => e.kind === 'clock_in' && !e.superseded_at);
  return {
    first: ins.find((e) => e.source !== 'auto_midnight') || null,
    onlyMidnight: ins.length > 0 && ins.every((e) => e.source === 'auto_midnight'),
  };
}

/** 반차 경계(분) — half_day_at, 비면 시작 + (끝−시작)/2 + 30분, 일정 안쪽으로 자름. */
function halfBoundary(sched, h) {
  const raw = sched.half_day_at !== null && sched.half_day_at !== undefined
    ? Math.round(sched.half_day_at * 60)
    : h[0] + Math.round((h[1] - h[0]) / 2) + 30;
  return Math.min(h[1], Math.max(h[0], raw));
}

/**
 * 하루 판정 — 순수 함수(검증 사례 §8 를 DB 없이 돌릴 수 있게).
 *   ctx: { date, today, nowMin, tz, sched(view|null), mode, holiday, fullLeave, halfKind, leaveHoursMin, member{from,until},
 *          day(AttendanceDay|null), events[], exception, selfFixStatus }
 *   반환 null = 유연(판정 없음) · { applicable:false, why } · 판정 값
 */
function judgeOne(ctx) {
  if (ctx.mode !== 'fixed' || !ctx.sched) return null;
  const { date, today } = ctx;
  if (date > today) return null;
  const h = ctx.sched.hours ? ctx.sched.hours[dowOf(date)] : null;
  const base = { applicable: false, grace_min: ctx.sched.grace_min };
  if (!h) return { ...base, why: 'day_off' };
  if (ctx.holiday) return { ...base, why: 'holiday' };
  if (ctx.fullLeave) return { ...base, why: 'leave' };
  if (ctx.member && ((ctx.member.from && date < ctx.member.from) || (ctx.member.until && date >= ctx.member.until))) {
    return { ...base, why: 'not_member' };
  }
  let expIn = h[0]; let expOut = h[1];
  if (ctx.halfKind === 'am') expIn = halfBoundary(ctx.sched, h);
  if (ctx.halfKind === 'pm') expOut = halfBoundary(ctx.sched, h);
  const grace = ctx.sched.grace_min || 0;
  const out = {
    applicable: true, expected_in: hhmm(expIn), expected_out: hhmm(expOut), grace_min: grace,
    in_status: null, out_status: null, late_min: 0, early_min: 0,
    excused: !!ctx.exception?.excused, reason: ctx.exception?.reason || null,
    excuse_note: ctx.exception?.excuse_note || null,
    flags: { self_fix_unconfirmed: ctx.selfFixStatus === 'applied', self_fix_pending: ctx.selfFixStatus === 'pending', midnight_tail: false },
  };
  const { first, onlyMidnight } = firstHumanClockIn(ctx.events);
  if (!ctx.day || !first) {
    if (date === today) out.in_status = ctx.nowMin < expIn + grace + 1 ? 'not_yet' : 'missing';
    else out.in_status = 'no_show';
    if (onlyMidnight) out.flags.midnight_tail = true;
    return out;
  }
  const inMin = minuteOnDay(first.at, date, ctx.tz);
  let late = inMin > expIn + grace ? inMin - expIn : 0;
  // 퇴근
  let early = 0;
  if (ctx.day.state !== 'done' || !ctx.day.clock_out_at) out.out_status = 'open';
  else if (ctx.day.auto_closed && !ctx.day.close_confirmed_at) out.out_status = 'unverified';
  else {
    const outMin = minuteOnDay(ctx.day.clock_out_at, date, ctx.tz);
    early = outMin < expOut ? expOut - outMin : 0;
  }
  // 시간 단위 휴가(시작 시각 칸이 없다) — 승인 시간 합을 지각에서 먼저, 남으면 조퇴에서 뺀다(§3.4).
  let H = ctx.leaveHoursMin || 0;
  if (H > 0 && late > 0) { const d = Math.min(H, late); late -= d; H -= d; }
  if (H > 0 && early > 0) { const d = Math.min(H, early); early -= d; H -= d; }
  out.in_status = late > 0 ? 'late' : 'on_time';
  out.late_min = late;
  if (out.out_status === null) out.out_status = early > 0 ? 'early' : 'ok';
  out.early_min = early;
  return out;
}

/** 문제 있는 날인가 — /punctuality 가 이것만 돌려준다. */
function hasIssue(p) {
  if (!p || !p.applicable) return false;
  return p.in_status === 'late' || p.in_status === 'missing' || p.in_status === 'no_show'
    || p.out_status === 'early' || p.out_status === 'unverified';
}

/**
 * 여러 사람 × 여러 날 판정.
 *   userIds null = 활동 멤버 전원(대표·관리자·멤버 — 고객·AI 제외).
 *   반환 { mode_any_fixed, results: Map<`${uid}|${date}`, punct|null>, dayIdOf: Map<key, dayId> }
 */
async function judgeDays({ businessId, userIds = null, from, to, now = new Date() }) {
  const tz = await S.tzOf(businessId);
  const today = dateStrInTz(now, tz);
  const nowMin = wallOf(now, tz).min;
  const rows = await S.loadAll(businessId);
  const results = new Map(); const dayIdOf = new Map();
  if (!rows.some((r) => r.mode === 'fixed')) return { anyFixed: false, results, dayIdOf, tz, today };
  if (from > to) return { anyFixed: true, results, dayIdOf, tz, today };

  // ★ 빠진 멤버도 «빠지기 전날까지» 판정한다(§3.1) — defaultScope(removed_at NULL)를 풀고, 기간 시작 전에 빠진 사람만 뺀다.
  //   (Fable 완료 검증 비차단 2: defaultScope 탓에 퇴사자의 지난 지각·미출근이 통계에서 통째로 사라졌다)
  const memberWhere = {
    business_id: businessId, role: { [Op.in]: ['owner', 'admin', 'member'] }, user_id: { [Op.ne]: null },
    [Op.or]: [{ removed_at: null }, { removed_at: { [Op.gte]: startOfDayInTz(from, tz) } }],
  };
  if (userIds) memberWhere.user_id = { [Op.in]: userIds };
  const members = await BusinessMember.unscoped().findAll({
    where: memberWhere, attributes: ['user_id', 'joined_at', 'created_at', 'removed_at'],
  });
  const uids = members.map((m) => m.user_id);
  if (!uids.length) return { anyFixed: true, results, dayIdOf, tz, today };
  const memberSpan = new Map(members.map((m) => {
    const joined = m.joined_at || m.created_at || m.get?.('created_at');
    return [m.user_id, {
      // 합류한 다음 날부터 판정(합류 당일은 시작 시각을 알 수 없다 · §3.1)
      from: joined ? addDaysStr(dateStrInTz(joined, tz), 1) : null,
      until: m.removed_at ? dateStrInTz(m.removed_at, tz) : null,
    }];
  }));

  const [days, holidays, leaves, exceptions] = await Promise.all([
    AttendanceDay.findAll({ where: { business_id: businessId, user_id: { [Op.in]: uids }, work_date: { [Op.between]: [from, to] } } }),
    WorkspaceHoliday.findAll({ where: { business_id: businessId, is_off: true, date: { [Op.between]: [from, to] } }, attributes: ['date'] }),
    LeaveRequest.findAll({
      where: { business_id: businessId, user_id: { [Op.in]: uids }, status: 'approved', start_date: { [Op.lte]: to }, end_date: { [Op.gte]: from } },
      attributes: ['user_id', 'unit', 'half_kind', 'hours', 'start_date', 'end_date'],
    }),
    AttendanceException.findAll({ where: { business_id: businessId, user_id: { [Op.in]: uids }, work_date: { [Op.between]: [from, to] } } }),
  ]);
  const dayIds = days.map((d) => d.id);
  const [events, fixes] = dayIds.length ? await Promise.all([
    AttendanceEvent.findAll({
      // 스코프: attendance_day_id 는 위에서 business_id 로 고른 하루들이다.
      where: { attendance_day_id: { [Op.in]: dayIds }, superseded_at: null, kind: 'clock_in' },
      attributes: ['attendance_day_id', 'kind', 'at', 'source', 'superseded_at'],
      order: [['at', 'ASC'], ['id', 'ASC']],
    }),
    AttendanceFixRequest.findAll({
      where: { attendance_day_id: { [Op.in]: dayIds }, status: { [Op.ne]: 'withdrawn' } },
      attributes: ['attendance_day_id', 'status', 'created_at', 'id'],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    }),
  ]) : [[], []];
  const evByDay = new Map();
  for (const e of events) { if (!evByDay.has(e.attendance_day_id)) evByDay.set(e.attendance_day_id, []); evByDay.get(e.attendance_day_id).push(e); }
  const fixByDay = new Map();
  for (const f of fixes) if (!fixByDay.has(f.attendance_day_id)) fixByDay.set(f.attendance_day_id, f.status);
  const dayByKey = new Map(days.map((d) => [`${d.user_id}|${ymd(d.work_date)}`, d]));
  const holidaySet = new Set(holidays.map((h) => ymd(h.date)));
  const excByKey = new Map(exceptions.map((x) => [`${x.user_id}|${ymd(x.work_date)}`, x]));
  const leaveOf = (uid, date) => {
    let full = false; let half = null; let hoursMin = 0;
    for (const l of leaves) {
      if (l.user_id !== uid || ymd(l.start_date) > date || ymd(l.end_date) < date) continue;
      if (l.unit === 'full_day') full = true;
      else if (l.unit === 'half_day') half = half && half !== l.half_kind ? 'both' : l.half_kind;
      else if (l.unit === 'hours') hoursMin += Math.round(Number(l.hours || 0) * 60);
    }
    if (half === 'both') full = true;   // 오전·오후 반차를 다 쓰면 종일
    return { full, half: half === 'both' ? null : half, hoursMin };
  };

  for (const uid of uids) {
    for (let date = from; date <= to; date = addDaysStr(date, 1)) {
      const key = `${uid}|${date}`;
      const r = S.resolveFrom(rows, uid, date);
      const day = dayByKey.get(key) || null;
      if (day) dayIdOf.set(key, day.id);
      const lv = leaveOf(uid, date);
      results.set(key, judgeOne({
        date, today, nowMin, tz, sched: r.row, mode: r.mode,
        holiday: holidaySet.has(date), fullLeave: lv.full, halfKind: lv.half, leaveHoursMin: lv.hoursMin,
        member: memberSpan.get(uid), day, events: day ? (evByDay.get(day.id) || []) : [],
        exception: excByKey.get(key) || null, selfFixStatus: day ? fixByDay.get(day.id) || null : null,
      }));
    }
  }
  return { anyFixed: true, results, dayIdOf, tz, today };
}

/** 근태 행 목록(본인·팀 응답)에 punct 를 붙인다 — 유연 워크스페이스면 전부 null(기존 칸 그대로). */
async function attachToDays(businessId, serializedDays) {
  if (!serializedDays.length) return serializedDays;
  const dates = serializedDays.map((d) => d.work_date).sort();
  const uids = [...new Set(serializedDays.map((d) => d.user_id))];
  const { results } = await judgeDays({ businessId, userIds: uids, from: dates[0], to: dates[dates.length - 1] });
  return serializedDays.map((d) => ({ ...d, punct: results.get(`${d.user_id}|${d.work_date}`) || null }));
}

/** 월 통계 칸(§4) — 인정된 날은 횟수·분에서 빼고 excused_count 로만. 유연이면 칸이 null. */
function statsOf(results, userId, from, to) {
  let any = false;
  const s = { applicable_days: 0, late_count: 0, late_minutes: 0, early_count: 0, early_minutes: 0, no_show_count: 0, excused_count: 0 };
  for (let date = from; date <= to; date = addDaysStr(date, 1)) {
    const p = results.get(`${userId}|${date}`);
    if (p === undefined || p === null) continue;
    any = true;
    if (!p.applicable) continue;
    s.applicable_days += 1;
    if (!hasIssue(p)) continue;
    if (p.excused) { s.excused_count += 1; continue; }
    if (p.in_status === 'late') { s.late_count += 1; s.late_minutes += p.late_min; }
    if (p.in_status === 'no_show') s.no_show_count += 1;
    if (p.out_status === 'early') { s.early_count += 1; s.early_minutes += p.early_min; }
  }
  if (!any) return { applicable_days: null, late_count: null, late_minutes: null, early_count: null, early_minutes: null, no_show_count: null, excused_count: null };
  return s;
}

module.exports = {
  MAX_RANGE_DAYS, judgeOne, judgeDays, attachToDays, statsOf, hasIssue, firstHumanClockIn, wallOf, minuteOnDay, hhmm,
};

/** /today 용 — 내 오늘 기준 시각 + 판정. 유연이면 둘 다 null. */
async function todayView(businessId, userId) {
  const tz = await S.tzOf(businessId);
  const today = dateStrInTz(new Date(), tz);
  const r = S.resolveFrom(await S.loadAll(businessId), userId, today);
  if (r.mode !== 'fixed' || !r.row) return { schedule: null, punct: null };
  const { results } = await judgeDays({ businessId, userIds: [userId], from: today, to: today });
  const punct = results.get(`${userId}|${today}`) || null;
  const h = r.row.hours ? r.row.hours[dowOf(today)] : null;
  return {
    schedule: { mode: 'fixed', source: r.source, expected_in: punct?.expected_in || (h ? hhmm(h[0]) : null),
      expected_out: punct?.expected_out || (h ? hhmm(h[1]) : null), grace_min: r.row.grace_min, day_off: !h },
    punct,
  };
}

/** /presence 관리자용 — 오늘 지각·미출근만 user_id → 'late'|'missing'. 유연·문제없음은 칸 없음(null). */
async function todayFlags(businessId) {
  const tz = await S.tzOf(businessId);
  const today = dateStrInTz(new Date(), tz);
  const { anyFixed, results } = await judgeDays({ businessId, from: today, to: today });
  const out = new Map();
  if (!anyFixed) return out;
  for (const [key, p] of results) {
    if (!p || !p.applicable || p.excused) continue;
    const uid = Number(key.split('|')[0]);
    if (p.in_status === 'late') out.set(uid, 'late');
    else if (p.in_status === 'missing') out.set(uid, 'missing');
  }
  return out;
}

module.exports.todayView = todayView;
module.exports.todayFlags = todayFlags;

/**
 * 정정 요청 목록에 «이 정정으로 판정이 어떻게 바뀌나» 를 붙인다(§5.4) — punct_after = 지금 원장 판정,
 *   punct_before = 요청 전 스냅숏(before.clock_in_at·clock_out_at)을 같은 기준 시각에 댄 값. 유연이면 둘 다 null.
 */
async function attachToFixRequests(businessId, list) {
  if (!list.length) return list;
  const dates = list.map((r) => r.work_date).sort();
  const uids = [...new Set(list.map((r) => r.user_id))];
  const { anyFixed, results, tz } = await judgeDays({ businessId, userIds: uids, from: dates[0], to: dates[dates.length - 1] });
  if (!anyFixed) return list.map((r) => ({ ...r, punct_before: null, punct_after: null }));
  const toMin = (s) => { const m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  return list.map((r) => {
    const after = results.get(`${r.user_id}|${r.work_date}`) || null;
    let before = null;
    if (after && after.applicable && r.before) {
      const expIn = toMin(after.expected_in); const expOut = toMin(after.expected_out);
      const inMin = r.before.clock_in_at ? minuteOnDay(r.before.clock_in_at, r.work_date, tz) : null;
      const outMin = r.before.clock_out_at ? minuteOnDay(r.before.clock_out_at, r.work_date, tz) : null;
      const late = inMin !== null && inMin > expIn + after.grace_min ? inMin - expIn : 0;
      const early = outMin !== null && outMin < expOut ? expOut - outMin : 0;
      before = { applicable: true, in_status: inMin === null ? 'no_show' : (late ? 'late' : 'on_time'), late_min: late,
        out_status: outMin === null ? null : (early ? 'early' : 'ok'), early_min: early };
    }
    return { ...r, punct_before: before, punct_after: after };
  });
}
module.exports.attachToFixRequests = attachToFixRequests;
