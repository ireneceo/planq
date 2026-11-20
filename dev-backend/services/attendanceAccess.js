// 근태 라우트 두 파일(routes/attendance.js · routes/attendance_fix.js)이 같이 쓰는 접근 판정·직렬화 — 한 곳.
//   두 파일이 각자 적으면 한쪽만 고쳐진다(열람 범위 §6 이 특히).
const { getUserScope } = require('../middleware/access_scope');
const { errorResponse } = require('../utils/response');
const { moduleOnFor } = require('./modules');
const { ymd } = require('../utils/datetime');

/** 멤버십 확인. client·ai 는 근태 대상이 아니다 — 전부 403. */
async function requireMember(req, res, businessId) {
  if (!businessId) { errorResponse(res, 'business_id_required', 400); return null; }
  const scope = await getUserScope(req.user.id, Number(businessId), req.user.role);
  if (!(scope.isMember || scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) {
    errorResponse(res, 'forbidden', 403); return null;
  }
  if (!(await moduleOnFor(businessId, 'attendance'))) { errorResponse(res, 'module_off', 404); return null; }   // 근태·휴가 꺼짐 = 없는 API(services/modules · 멤버십 확인 뒤라 남에게 켜짐 여부를 말하지 않는다)
  return scope;
}
const isManager = (scope) => !!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin);

// 본인·관리자용 — 시각과 누계를 포함한다.
function serializeDay(day, live) {
  return {
    id: day.id,
    user_id: day.user_id,
    work_date: ymd(day.work_date),
    state: day.state,
    clock_in_at: day.clock_in_at,
    clock_out_at: day.clock_out_at,
    break_started_at: day.break_started_at,
    work_sec: live ? live.work_sec : Number(day.work_total_sec || 0),
    break_sec: live ? live.break_sec : Number(day.break_total_sec || 0),
    auto_closed: !!day.auto_closed,
    // 자동 마감 시각을 본인이 «맞아요» 했거나 고쳤는가 — 화면이 «자동 마감됨» 대신 «확인됨» 을 보인다
    close_confirmed: !!day.close_confirmed_at,
    admin_fixed: !!day.admin_fixed,
    note: day.note || null,
  };
}

module.exports = { requireMember, isManager, serializeDay };
