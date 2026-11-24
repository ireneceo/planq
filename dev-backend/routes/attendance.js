// /api/attendance — 출퇴근 (#208 · #285). 설계: docs/ATTENDANCE_LEAVE_DESIGN.md §5.1 · §6
//
// 열람 범위(§6)가 이 파일의 핵심이다:
//   · 내 시각·근무시간 → 본인 + owner/admin
//   · 동료 → **상태 뱃지만** (근무중/휴게중/퇴근). 시각·누계는 절대 나가지 않는다.
//   두 용도가 같은 serializer 를 쓰면 언젠가 필드 하나가 새어 나간다 → serializer 를 아예 분리한다.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');

const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../utils/response');
const { parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { AttendanceDay, AttendanceEvent, User, BusinessMember, LeaveRequest } = require('../models');
const A = require('../services/attendanceTransition');
const F = require('../services/attendanceFix');
const PU = require('../services/attendancePunctuality');   // 고정 근무 지각·미출근 판정(유연이면 null) — docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md
const TR = require('../services/attendanceTracking');   // 멤버별 «출퇴근 안 함» — docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md
const { ymd } = require('../utils/datetime');

const clockLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  keyGenerator: (req) => (req.user?.id ? `attn-u${req.user.id}` : `attn-ip${ipKeyGenerator(req.ip)}`),
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: '출퇴근 기록을 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' },
});

const { requireMember, isManager, serializeDay } = require('../services/attendanceAccess');
// 동료용 — 상태 하나뿐. 여기에 필드를 더하려면 §6 을 먼저 고쳐야 한다.
function serializePresence(userId, state, onLeave) {
  return { user_id: userId, state, on_leave_today: !!onLeave };
}

// ─── GET /today ─────────────────────────────────────────────────
router.get('/today', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const workDate = await A.todayFor(businessId);
    // «출퇴근 안 함» — 자정 분할·첫 진입·묻기·판정 전에 끝낸다(활동 흔적도 남기지 않는다 · Fable 판정 4).
    if (!(await TR.isTracked(businessId, req.user.id))) return successResponse(res, TR.notTrackedToday(workDate));
    let day = await AttendanceDay.findOne({
      where: { business_id: businessId, user_id: req.user.id, work_date: workDate },
    });
    // 0시를 넘겨 일하는 중이면 그 자리에서 이어 준다(어제 24:00 퇴근 + 오늘 00:00 출근) — 매시 5분 cron 을
    //   기다리면 00:00~00:05 동안 «미출근» 이 보인다. 아닌 사람은 가벼운 조회 하나로 끝난다.
    if (!day) {
      const split = await A.ensureMidnightSplit({ businessId, userId: req.user.id })
        .catch((e) => { console.warn('[attendance today split]', e.message); return null; });
      if (split) day = split.today;
    }
    // 출근 묻기·어제 퇴근 확인 (docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §3·§4) — 판정은 services/attendancePrompt 한 곳.
    //   visible=1(화면이 보이는 상태로 부름)일 때만 «그날 첫 진입» 을 남긴다 — 숨은 탭이 소켓 신호로 다시 읽은 것은 진입이 아니다.
    const P = require('../services/attendancePrompt');
    if (req.query.visible === '1') await P.markSeen({ businessId, userId: req.user.id }).catch((e) => console.warn('[attendance seen]', e.message));
    const asks = await P.promptFor({ businessId, userId: req.user.id, day })
      .catch((e) => { console.warn('[attendance prompt]', e.message); return { prompt: null, close_check: null, prompt_status: { state: 'error' } }; });
    // 화면이 정정 창 안내 문구(«바로 반영» / «승인 뒤 반영»)를 고르는 값 — 설정 «본인 수정은 승인 후 반영».
    const fixApproval = await require('../services/attendanceFix').approvalOn(businessId);
    const punctView = await PU.todayView(businessId, req.user.id);   // { schedule, punct } — 본인 응답에만
    const tracked = true;   // «출퇴근 안 함» 은 위에서 이미 돌려보냈다
    if (!day) return successResponse(res, { work_date: workDate, state: null, day: null, tracked, fix_approval: fixApproval, ...punctView, ...asks });
    const live = await A.liveTotals(day);
    // #208 — 자동으로 출근 처리된 경우 그 사실을 화면에 알린다.
    //   시스템이 사용자 대신 상태를 바꿨으면 **말없이 두지 않는다** — 나중에 기록을 보고
    //   "내가 언제 출근을 눌렀지?" 가 되면 그 기록 전체를 믿지 못하게 된다.
    //   되돌릴 수 있는 조건(아래 undo-auto)까지 같이 내려서, 화면이 버튼을 띄울지 스스로 정한다.
    const auto = await A.autoClockInNotice(day);
    // 자동 출근보다 10분 넘게 먼저 들어와 있었으면 그 시각을 같이 준다 — 알림 창이 «09:05 부터 들어와 계셨어요» + 시각 고치기를 띄운다(설계 §3.4).
    if (auto) {
      const seen = await P.firstSeenToday({ businessId, userId: req.user.id }).catch(() => null);
      if (seen && new Date(auto.at).getTime() - seen.getTime() > 10 * 60 * 1000) auto.first_seen_at = seen;
    }
    return successResponse(res, {
      work_date: workDate, state: day.state, day: { ...serializeDay(day, live), self_fix: (await F.selfFixOf([day.id])).get(day.id) || null },
      auto_notice: auto, tracked, fix_approval: fixApproval, ...punctView, ...asks,
    });
  } catch (err) { next(err); }
});

// ─── 전이 4종 ───────────────────────────────────────────────────
// «출퇴근 안 함» 은 새 근무를 여는 두 전이(출근·휴게 시작)만 막는다 — 퇴근·휴게 끝은 열린 행을 닫는 길이라 둔다(설계 D6).
const opensWork = (fn) => fn === A.clockIn || fn === A.breakStart;
// 본문은 한 벌이지만 **등록은 네 줄 그대로** 쓴다. 래퍼 안에 경로를 숨기면
//   grep 으로도 정적 검사(scripts/guard-invariants spalink)로도 이 경로가 보이지 않는다.
function clockHandler(fn) {
  return async (req, res, next) => {
    try {
      const businessId = Number(req.body.business_id);
      const scope = await requireMember(req, res, businessId);
      if (!scope) return;
      if (opensWork(fn) && !(await TR.isTracked(businessId, req.user.id))) return errorResponse(res, 'attendance_not_tracked', 403);
      const day = await fn({ businessId, userId: req.user.id, actorUserId: req.user.id });
      const live = await A.liveTotals(day);
      return successResponse(res, serializeDay(day, live));
    } catch (err) {
      if (err instanceof A.AttendanceError) return errorResponse(res, err.code, err.status || 400);
      next(err);
    }
  };
}
// 출근 — 선택 인자(docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §3.5):
//   {observed:true} → 서버가 기록한 오늘 첫 진입 시각으로(화면이 보낸 시각을 믿지 않는다) · 기계 값이라 수정 아님
//   {at}            → 본인이 고친 시각(오늘 0시 ≤ at ≤ 지금+1분) = «본인 수정». 승인 모드면 기계 값으로 출근 + 승인 대기
//   둘 다 없으면 종전대로 지금.
router.post('/clock-in', authenticateToken, clockLimiter, async (req, res, next) => {
  const { observed, at } = req.body || {};
  if (!observed && !at) return clockHandler(A.clockIn)(req, res, next);
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    if (!(await TR.isTracked(businessId, req.user.id))) return errorResponse(res, 'attendance_not_tracked', 403);
    const P = require('../services/attendancePrompt');
    const now = new Date();
    // observed/at 는 **오늘 행이 없을 때만**(묻는 창의 조건) — 퇴근 뒤 재출근에 과거 시각을 붙이면 «원래 값» 이 거짓이 된다(Fable 비차단).
    const todayRow = await AttendanceDay.findOne({
      where: { business_id: businessId, user_id: req.user.id, work_date: await A.todayFor(businessId, now) }, attributes: ['id'],
    });
    if (todayRow) return errorResponse(res, 'already_clocked_in_today', 409);
    // 묻는 창이 보여 준 값과 같은 함수 — 새벽 잠깐 진입은 제안에서 빠진다(services/attendancePrompt.observedStart).
    const seen = await P.observedStart({ businessId, userId: req.user.id, now });
    const machineAt = seen || now;
    let wanted = machineAt;
    if (at) {
      wanted = new Date(at);
      if (Number.isNaN(wanted.getTime())) return errorResponse(res, 'invalid_at', 400);
      if (wanted.getTime() > now.getTime() + 60 * 1000) return errorResponse(res, 'future_time_not_allowed', 400);
      if (wanted > now) wanted = now;
      const today = await A.todayFor(businessId, now);
      if ((await A.todayFor(businessId, wanted)) !== today) return errorResponse(res, 'not_today', 400);
    }
    const isFix = !!at && Math.abs(wanted.getTime() - machineAt.getTime()) >= 60 * 1000;
    const F = require('../services/attendanceFix');
    const pendingMode = isFix && (await F.approvalOn(businessId))
      && req.user.id !== (await require('../models').Business.findByPk(businessId, { attributes: ['owner_id'] }))?.owner_id;
    let day = await A.clockIn({
      businessId, userId: req.user.id, actorUserId: req.user.id, source: 'user', at: pendingMode ? machineAt : wanted,
    });
    let pending = false;
    if (isFix) {
      const iso = (d) => new Date(d).toISOString();
      const r = await F.submit({
        day, userId: req.user.id, origin: 'prompt_in',
        events: [{ kind: 'clock_in', at: iso(wanted) }],
        reason: String(req.body.reason || '').trim() || '출근 확인 때 시각 고침',
        before: { clock_in_at: iso(machineAt), clock_out_at: null, work_total_sec: 0 },
        alreadyApplied: !pendingMode, ioApp: req.app,
      });
      day = r.day; pending = r.pending;
    }
    const live = await A.liveTotals(day);
    return successResponse(res, { ...serializeDay(day, live), pending });
  } catch (err) {
    // AttendanceError · FixError 둘 다 {code, status} — 그 외(DB 등)는 공통 핸들러로.
    if (err && typeof err.code === 'string' && Number.isInteger(err.status)) return errorResponse(res, err.code, err.status);
    next(err);
  }
});
router.post('/break-start', authenticateToken, clockLimiter, clockHandler(A.breakStart));
router.post('/break-end', authenticateToken, clockLimiter, clockHandler(A.breakEnd));
router.post('/clock-out', authenticateToken, clockLimiter, clockHandler(A.clockOut));

// ─── GET /my ────────────────────────────────────────────────────
router.get('/my', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId, user_id: req.user.id };
    if (req.query.from && req.query.to) where.work_date = { [Op.between]: [req.query.from, req.query.to] };
    const { rows, count } = await AttendanceDay.findAndCountAll({
      where, order: [['work_date', 'DESC']], limit, offset,
    });
    const fixes = await F.selfFixOf(rows.map((d) => d.id));   // «본인 수정» 표시(원래 → 고친 값 · 확인 상태)
    const list = await PU.attachToDays(businessId, rows.map((d) => ({ ...serializeDay(d), self_fix: fixes.get(d.id) || null })));
    return paginatedResponse(res, list, count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /team (owner/admin) ────────────────────────────────────
router.get('/team', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const where = { business_id: businessId };
    if (req.query.date) where.work_date = req.query.date;
    else if (req.query.from && req.query.to) where.work_date = { [Op.between]: [req.query.from, req.query.to] };
    const { rows, count } = await AttendanceDay.findAndCountAll({
      where, order: [['work_date', 'DESC'], ['user_id', 'ASC']], limit, offset,
    });
    const fixes = await F.selfFixOf(rows.map((d) => d.id));
    const list = await PU.attachToDays(businessId, rows.map((d) => ({ ...serializeDay(d), self_fix: fixes.get(d.id) || null })));
    return paginatedResponse(res, list, count, { limit, page, offset });
  } catch (err) { next(err); }
});

// ─── GET /presence (멤버 전원 — 뱃지만) ─────────────────────────
router.get('/presence', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const workDate = await A.todayFor(businessId);
    const days = await AttendanceDay.findAll({
      where: { business_id: businessId, work_date: workDate },
      attributes: ['user_id', 'state'],
    });
    // 오늘 승인된 휴가 — 이것도 뱃지 한 칸이다("휴가중인 줄 모르고 컨펌 요청" 방지, §6).
    const leaves = await LeaveRequest.findAll({
      where: {
        business_id: businessId, status: 'approved',
        start_date: { [Op.lte]: workDate }, end_date: { [Op.gte]: workDate },
      },
      attributes: ['user_id'],
    });
    const onLeave = new Set(leaves.map((l) => l.user_id));
    const byUser = new Map(days.map((d) => [d.user_id, d.state]));
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null },
      attributes: ['user_id'],
    });
    // 관리자만 오늘 지각·미출근 표시(§6 — 멤버 응답에는 칸 자체가 없다)
    const flags = isManager(scope) ? await PU.todayFlags(businessId) : null;
    const untracked = await TR.untrackedSet(businessId);   // 행은 남기되 tracked:false(상태·판정 없음, 휴가만) — 빼면 화면이 «미출근» 점(Fable 판정 3)
    const out = members.map((m) => (untracked.has(m.user_id) ? { ...serializePresence(m.user_id, null, onLeave.has(m.user_id)), tracked: false }
      : { ...serializePresence(m.user_id, byUser.get(m.user_id) || null, onLeave.has(m.user_id)), tracked: true, ...(flags ? { punct_today: flags.get(m.user_id) || null } : {}) }));
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// ─── PATCH /days/:id — 관리자 정정 ──────────────────────────────
router.patch('/days/:id', authenticateToken, async (req, res, next) => {
  try {
    const day = await AttendanceDay.findByPk(Number(req.params.id));
    if (!day) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, day.business_id);
    if (!scope) return;
    if (!isManager(scope)) return errorResponse(res, 'forbidden', 403);
    // 승인 모드에서 관리자 자기 기록은 관리자 정정으로 고치지 못한다 — 자기 것은 자기가 못 정한다(대표만 예외).
    //   본인 정정(PATCH /days/:id/correct)으로 요청하면 다른 관리자가 승인한다. docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §6.1
    if (day.user_id === req.user.id && !scope.isOwner && !scope.isPlatformAdmin
        && (await require('../services/attendanceFix').approvalOn(day.business_id))) {
      return errorResponse(res, 'self_fix_needs_approval', 403);
    }
    const updated = await A.applyAdminFix({
      dayId: day.id,
      events: req.body.events,
      fixReason: req.body.fix_reason,
      actorUserId: req.user.id,
    });
    return successResponse(res, serializeDay(updated));
  } catch (err) {
    if (err instanceof A.AttendanceError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

// PATCH /days/:id/correct (본인 정정 #392) 는 routes/attendance_fix.js 로 옮겼다 — 본인 수정 요청·승인 설정과 한 곳.

// ─── PATCH /days/:id/note — 본인 메모 ───────────────────────────
router.patch('/days/:id/note', authenticateToken, async (req, res, next) => {
  try {
    const day = await AttendanceDay.findByPk(Number(req.params.id));
    if (!day) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, day.business_id);
    if (!scope) return;
    if (day.user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    await day.update({ note: (req.body.note || '').slice(0, 500) || null });
    return successResponse(res, serializeDay(day));
  } catch (err) { next(err); }
});

// ─── GET /days/:id/events — 원장 (본인·관리자) ─────────────────
router.get('/days/:id/events', authenticateToken, async (req, res, next) => {
  try {
    const day = await AttendanceDay.findByPk(Number(req.params.id));
    if (!day) return errorResponse(res, 'not_found', 404);
    const scope = await requireMember(req, res, day.business_id);
    if (!scope) return;
    if (day.user_id !== req.user.id && !isManager(scope)) return errorResponse(res, 'forbidden', 403);
    const events = await AttendanceEvent.findAll({
      // 스코프: 위에서 day 의 business_id 로 멤버십을 확인했다(canAccess 상위 검사).
      where: { attendance_day_id: day.id },
      order: [['at', 'ASC'], ['id', 'ASC']],
      attributes: ['id', 'kind', 'at', 'source', 'actor_user_id', 'fix_reason', 'superseded_at'],
    });
    return successResponse(res, events);
  } catch (err) { next(err); }
});

// ─── GET /stats — 월별 통계 (§8.1) ──────────────────────────────
// owner/admin 은 전원, member 는 본인만. member 가 남의 수치를 보는 길은 여기에도 없다.
//
// ★ overtime 은 **참고치**다. 법정 연장근로가 아니라 "그날 기준시간을 얼마나 넘겼나" 일 뿐이고,
//   유연근무라 어떤 날은 넘고 어떤 날은 모자란 것이 정상이다. 화면 라벨에도 그렇게 적는다.
router.get('/stats', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || ''))
      ? String(req.query.month)
      : (await A.todayFor(businessId)).slice(0, 7);
    const from = `${month}-01`;
    const to = (() => {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m, 0));     // 그 달의 마지막 날
      return d.toISOString().slice(0, 10);
    })();

    const manager = isManager(scope);
    const where = { business_id: businessId, work_date: { [Op.between]: [from, to] } };
    if (!manager) where.user_id = req.user.id;

    const days = await AttendanceDay.findAll({
      where,
      attributes: ['id', 'user_id', 'work_date', 'clock_in_at', 'clock_out_at', 'work_total_sec', 'break_total_sec', 'auto_closed', 'close_confirmed_at'],
    });

    // 근무 기준시간·부서는 멤버 설정에서 온다 — 초과 판정의 분모다.
    const memberWhere = { business_id: businessId, removed_at: null };
    if (!manager) memberWhere.user_id = req.user.id;
    const members = await BusinessMember.findAll({
      where: memberWhere,
      attributes: ['user_id', 'daily_work_hours', 'department_id', 'attendance_tracked'],
    });
    const byUser = new Map(members.map((m) => [m.user_id, m]));

    // 승인된 휴가 — 유급·무급을 나눠 센다(무급은 잔여를 깎지 않는다).
    const leaveWhere = {
      business_id: businessId, status: 'approved',
      start_date: { [Op.lte]: to }, end_date: { [Op.gte]: from },
    };
    if (!manager) leaveWhere.user_id = req.user.id;
    const leaves = await LeaveRequest.findAll({
      where: leaveWhere,
      attributes: ['user_id', 'leave_type', 'days_charged'],
    });

    // 자정 분할(auto_midnight) 이벤트 — 00:00 출근·24:00 퇴근은 사람이 찍은 시각이 아니라 날짜 경계다.
    //   그 날의 출근이 전부 자정 이어받기면 근무일로 세지 않고(전날의 꼬리), 평균 출근·퇴근 표본에서도 뺀다.
    //   근무·휴게 초 합은 그대로(분할은 합을 보존한다). docs/ATTENDANCE_MIDNIGHT_SPLIT_DESIGN.md §2-5
    const dayIds = days.map((d) => d.id);
    const midEvents = dayIds.length ? await AttendanceEvent.findAll({
      // 스코프: attendance_day_id 는 위에서 business_id 로 고른 하루들이다.
      where: { attendance_day_id: { [Op.in]: dayIds }, superseded_at: null, kind: { [Op.in]: ['clock_in', 'clock_out'] } },
      attributes: ['attendance_day_id', 'kind', 'at', 'source'],
      order: [['at', 'ASC'], ['id', 'ASC']],
    }) : [];
    const evByDay = new Map();
    for (const e of midEvents) {
      if (!evByDay.has(e.attendance_day_id)) evByDay.set(e.attendance_day_id, []);
      evByDay.get(e.attendance_day_id).push(e);
    }
    const isMid = (e) => e.source === 'auto_midnight';

    const acc = new Map();
    const row = (uid) => {
      if (!acc.has(uid)) {
        acc.set(uid, {
          user_id: uid, work_days: 0, work_sec: 0, break_sec: 0,
          overtime_sec: 0, auto_closed_count: 0,
          in_minutes: [], out_minutes: [],
          leave_used_paid: 0, leave_used_unpaid: 0,
          department_id: byUser.get(uid)?.department_id || null,
        });
      }
      return acc.get(uid);
    };
    // 워크스페이스 tz 벽시계 분 — 서버 로컬 시각이 아니다(지각 판정과 같은 기준, 설계 §3).
    const tz = await A.workspaceTz(businessId);
    const minutesOf = (dt) => (dt ? PU.wallOf(dt, tz).min : null);
    const pj = await PU.judgeDays({ businessId, userIds: manager ? null : [req.user.id], from, to });
    for (const d of days) {
      const r = row(d.user_id);
      const evs = evByDay.get(d.id) || [];
      const ins = evs.filter((e) => e.kind === 'clock_in');
      const hasMidIn = ins.some(isMid);
      const onlyMidIn = ins.length > 0 && ins.every(isMid);
      if (!onlyMidIn) r.work_days += 1;
      r.work_sec += Number(d.work_total_sec || 0);
      r.break_sec += Number(d.break_total_sec || 0);
      // «확인 안 된 자동 마감» 만 품질 신호로 센다 — 본인이 «맞아요» 했거나 고친 날은 문제가 아니다(설계 §4.3).
      if (d.auto_closed && !d.close_confirmed_at) r.auto_closed_count += 1;
      const dailySec = (Number(byUser.get(d.user_id)?.daily_work_hours) || 8) * 3600;
      r.overtime_sec += Math.max(0, Number(d.work_total_sec || 0) - dailySec);
      // 평균 출근 — 자정 이어받기가 있는 날은 첫 «사람의» 출근, 없으면 표본에서 뺀다.
      const firstRealIn = hasMidIn ? (ins.find((e) => !isMid(e))?.at || null) : d.clock_in_at;
      const mi = minutesOf(firstRealIn);
      if (mi !== null) r.in_minutes.push(mi);
      // 평균 퇴근 — 퇴근 시각이 자정 마감 그 자체면 뺀다(그 뒤 진짜 퇴근을 찍었으면 그 값은 쓴다).
      const midOutAt = evs.filter((e) => e.kind === 'clock_out' && isMid(e)).map((e) => new Date(e.at).getTime());
      const outIsMid = d.clock_out_at && midOutAt.includes(new Date(d.clock_out_at).getTime());
      const mo = outIsMid ? null : minutesOf(d.clock_out_at);
      if (mo !== null) r.out_minutes.push(mo);
    }
    for (const l of leaves) {
      const r = row(l.user_id);
      if (l.leave_type === 'paid') r.leave_used_paid += Number(l.days_charged || 0);
      else r.leave_used_unpaid += Number(l.days_charged || 0);
    }

    for (const [key, p] of pj.results) if (p) row(Number(key.split('|')[0]));   // 고정 근무인데 기록이 하나도 없는 사람(미출근만)도 표에 나오게
    const avg = (arr) => {
      if (!arr.length) return null;
      const m = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
      return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    };
    const round1 = (n) => Math.round(n * 10) / 10;
    const out = [...acc.values()].map((r) => ({
      user_id: r.user_id,
      department_id: r.department_id,
      work_days: r.work_days,
      work_hours: round1(r.work_sec / 3600),
      break_hours: round1(r.break_sec / 3600),
      overtime_hours: round1(r.overtime_sec / 3600),
      avg_clock_in: avg(r.in_minutes),
      avg_clock_out: avg(r.out_minutes),
      auto_closed_count: r.auto_closed_count, tracked: byUser.get(r.user_id)?.attendance_tracked !== false,   // false = «출퇴근 안 함»(지각 칸 null 과 구별)
      leave_used_paid: round1(r.leave_used_paid),
      leave_used_unpaid: round1(r.leave_used_unpaid),
      ...PU.statsOf(pj.results, r.user_id, from, to),   // 고정 근무 지각·조퇴·미출근(유연이면 null)
    })).sort((a, b) => b.work_hours - a.work_hours);

    // 부서 롤업 — 부서가 없는 멤버는 묶지 않는다(없는 소속을 만들어내지 않는다).
    const deptAcc = new Map();
    for (const r of out) {
      if (!r.department_id) continue;
      const d = deptAcc.get(r.department_id) || { department_id: r.department_id, members: 0, work_hours: 0, overtime_hours: 0, leave_used_paid: 0 };
      d.members += 1;
      d.work_hours += r.work_hours;
      d.overtime_hours += r.overtime_hours;
      d.leave_used_paid += r.leave_used_paid;
      if (r.late_count !== null) { d.late_count = (d.late_count || 0) + r.late_count; d.no_show_count = (d.no_show_count || 0) + r.no_show_count; }
      deptAcc.set(r.department_id, d);
    }
    const departments = [...deptAcc.values()].map((d) => ({
      ...d,
      work_hours: round1(d.work_hours),
      overtime_hours: round1(d.overtime_hours),
      leave_used_paid: round1(d.leave_used_paid),
    }));

    return successResponse(res, { month, from, to, scope: manager ? 'team' : 'me', members: out, departments });
  } catch (err) { next(err); }
});

// ─── POST /undo-auto-clock-in — 자동 출근 되돌리기 ─────────────
//   업무를 시작해서 자동으로 출근 처리됐는데 그게 아니었을 때(잘못 눌렀다·남의 업무를 정리했다 등).
//   ★ 사용자가 스스로 한 행동이 하나라도 섞여 있으면 되돌리지 않는다 — 그건 되돌리기가 아니라
//     기록 삭제다. 그 경우는 관리자 정정으로 간다.
router.post('/undo-auto-clock-in', authenticateToken, clockLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.body.business_id);
    const scope = await requireMember(req, res, businessId);
    if (!scope) return;
    const day = await A.undoAutoClockIn({ businessId, userId: req.user.id });
    return successResponse(res, { undone: !!day });
  } catch (err) {
    if (err instanceof A.AttendanceError) return errorResponse(res, err.code, err.status || 400);
    next(err);
  }
});

// ─── GET/PUT /settings — 개인 설정 ─────────────────────────────
router.get('/settings', authenticateToken, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id, { attributes: ['auto_clock_in_on_focus', 'attendance_prompt_on'] });
    return successResponse(res, {
      auto_clock_in_on_focus: u?.auto_clock_in_on_focus !== false,
      attendance_prompt_on: u?.attendance_prompt_on !== false,
    });
  } catch (err) { next(err); }
});
router.put('/settings', authenticateToken, async (req, res, next) => {
  try {
    const u = await User.findByPk(req.user.id);
    if (!u) return errorResponse(res, 'not_found', 404);
    // 보낸 칸만 바꾼다 — 한 토글을 바꾸며 다른 토글을 꺼 버리지 않게.
    const patch = {};
    if (req.body.auto_clock_in_on_focus !== undefined) patch.auto_clock_in_on_focus = !!req.body.auto_clock_in_on_focus;
    if (req.body.attendance_prompt_on !== undefined) patch.attendance_prompt_on = !!req.body.attendance_prompt_on;
    if (Object.keys(patch).length) await u.update(patch);
    return successResponse(res, {
      auto_clock_in_on_focus: u.auto_clock_in_on_focus !== false,
      attendance_prompt_on: u.attendance_prompt_on !== false,
    });
  } catch (err) { next(err); }
});

module.exports = router;
