// 멤버별 «출퇴근 안 함» — 근태 대상 여부 한 곳 (docs/ATTENDANCE_MEMBER_TRACKING_DESIGN.md D8)
//
// Irene 2026-11-24: «출퇴근을 하는 워크스페이스가 있고 출퇴근 안하는 그냥 일만 봐주거나 연결되어 있는 경우가 있어.
//   멤버별로 출퇴근 설정을 다르게 할 수 없어?»
// business_members.attendance_tracked = false 면 그 사람은 **그 워크스페이스에서만** 출퇴근을 기록하지 않는다 —
//   출근·휴게 시작 403 · 자동 출근·자정 분할 없음 · 출근 묻기 없음 · 위젯 없음 · 동료 근무 점 없음 · 지각·미출근 판정 없음.
//   휴가·지난 기록은 그대로. 라우트·서비스는 칸을 직접 읽지 말고 이 파일을 부른다.
const { Op } = require('sequelize');
const { BusinessMember } = require('../models');

/** 이 사람이 이 워크스페이스에서 출퇴근을 기록하는가. 멤버 행이 없으면 true(다른 검사가 막는다 — 여기서 판정을 넓히지 않는다). */
async function isTracked(businessId, userId) {
  if (!businessId || !userId) return true;
  const m = await BusinessMember.findOne({
    where: { business_id: Number(businessId), user_id: Number(userId), removed_at: null },
    attributes: ['attendance_tracked'],
  });
  return !m || m.attendance_tracked !== false;
}

/** 이 워크스페이스에서 출퇴근을 기록하지 않는 사람들(user_id Set). 빠진 멤버 행도 포함 — 판정은 «지금 칸 값» 하나다(D7). */
async function untrackedSet(businessId) {
  const rows = await BusinessMember.unscoped().findAll({
    where: { business_id: Number(businessId), attendance_tracked: false, user_id: { [Op.ne]: null } },
    attributes: ['user_id'],
  });
  return new Set(rows.map((r) => r.user_id));
}

class TrackingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const CLOSE_REASON = '출퇴근 기록 안 함으로 바뀜';

/**
 * 켜기/끄기 — 쓰는 문은 여기 한 곳. 바로 적용(D2).
 *   · 대상: 그 워크스페이스의 직원 멤버(owner·admin·member). 아니면 404.
 *   · 자기 것은 대표(owner)·플랫폼 관리자만 바꾼다 — 관리자(admin)는 자기 것을 못 정한다(Fable 판정 6 · routes/attendance.js 정정 선례).
 *   · 끄면 열린 하루(근무중·휴게중)를 전부 닫는다 — 오늘 것은 지금, 지난 날 것은 자동 마감과 같은 추정 시각(그날 자정 상한).
 *     업무 측정은 끊지 않는다(closeOpenDayQuietly · Fable 판정 1).
 *   · 켜면 attendance_tracked_since = 오늘(워크스페이스 날짜) → 판정은 내일부터(꺼 둔 동안이 미출근으로 뜨지 않게 · Fable 판정 2).
 *   반환 { changed, prev, tracked, closedDayIds }
 */
async function setTracked({ businessId, userId, tracked, actorUserId, actorIsOwner = false, actorIsPlatformAdmin = false }) {
  const m = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
  });
  if (!m) throw new TrackingError('member_not_found', 404);
  if (userId === actorUserId && !actorIsOwner && !actorIsPlatformAdmin) throw new TrackingError('self_change_not_allowed', 403);
  const prev = m.attendance_tracked !== false;
  if (prev === tracked) return { changed: false, prev, tracked, closedDayIds: [] };
  const { dateStrInTz, ymd } = require('../utils/datetime');
  const tz = await require('./attendanceSchedule').tzOf(businessId);
  const today = dateStrInTz(new Date(), tz);
  await m.update(tracked ? { attendance_tracked: true, attendance_tracked_since: today } : { attendance_tracked: false });
  const closedDayIds = [];
  if (!tracked) {
    const { AttendanceDay } = require('../models');
    const A = require('./attendanceTransition');
    const { guessCloseAt } = require('./attendanceAutoClose');
    const open = await AttendanceDay.findAll({
      where: { business_id: businessId, user_id: userId, state: { [Op.in]: ['working', 'on_break'] } },
      order: [['work_date', 'ASC']],
    });
    for (const day of open) {
      const at = ymd(day.work_date) === today ? new Date() : await guessCloseAt(day, tz);
      const closed = await A.closeOpenDayQuietly({ dayId: day.id, at, actorUserId, fixReason: CLOSE_REASON })
        .catch((e) => { console.warn('[attendance tracking close]', e.message); return null; });
      if (closed) closedDayIds.push(closed.id);
    }
  }
  return { changed: true, prev, tracked, closedDayIds };
}

/** 판정 시작일 — 다시 켠 날의 다음 날. 없으면 null(처음부터 켜짐). judgeDays 가 합류일과 같이 쓴다. */
function trackedFromOf(member) {
  const since = member?.attendance_tracked_since;
  if (!since) return null;
  const { addDaysStr, ymd } = require('../utils/datetime');
  return addDaysStr(ymd(since), 1);
}

/** GET /today 응답 — «출퇴근 안 함» 인 사람(위젯·묻기 창이 tracked:false 를 보고 숨는다). */
function notTrackedToday(workDate) {
  return {
    work_date: workDate, state: null, day: null, tracked: false, fix_approval: false, schedule: null, punct: null,
    prompt: null, close_check: null, prompt_status: { state: 'not_tracked' },
  };
}

module.exports = { isTracked, untrackedSet, setTracked, trackedFromOf, notTrackedToday, TrackingError };
