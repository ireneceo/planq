// taskActualHours — actual_hours 자동 산정 (사이클 N+6 신설 → 2026-07-31 재설계)
//
// ★ 정책: 자동값의 근거는 **포커스 타이머 실측**뿐이다. 사용자가 직접 입력한 값은 건드리지 않는다.
//
// 왜 status_history 기반 누적을 버렸나 (Fable 설계 게이트 2026-07-31):
//   옛 구현은 task_status_history 의 in_progress 진입~이탈 구간을 합산했다. 그런데 그 구간은
//   **경과시간(elapsed)이지 작업시간(work)이 아니다.** 진행 상태로 두고 퇴근하는 게 정상 사용이라,
//   2시간짜리 작업이 사흘 라운드면 67.7h 로, 45일 방치면 1948h 로 기록됐다(dev task 529 실측).
//   게다가 라운드 경계 자체가 깨져 있었다 — 집계가 `event_type='status_change'` 행만 읽는 바람에
//   `review_submit`·`completed`·`revert`·`review_cancel` 로 기록된 전이(운영 96행, 34%)가 탈락해
//   같은 이력이 status 에 따라 **0h 로 증발하거나 72h 로 부풀었다**(양방향 실측 반증 완료).
//   어떤 상한 heuristic 도 퇴근·주말·점심을 작업시간에서 분리하지 못한다 → 추정을 그만두고 비운다.
//   운영 fallback 대상 84건 중 80건은 경계를 완벽히 고쳐도 어차피 0h 였다.
//   부수 효과: 허구값이 cueKnowledge.computeWorkPatternStats 를 통해 AI 시간추정 프롬프트로
//   흘러들어가 워크스페이스 전체 추정을 오염시키던 경로도 함께 끊긴다.
//
// 호출: focus 세션 start/stop/재개 시 (routes/focus.js) · 액션 계층 status 전이 후 (services/focusSync.js)

const { Task, FocusSession } = require('../models');

// 같은 task 의 모든 focus_session 실측 시간 합 (초). active/paused 도 computeActualSeconds 가 현재까지 계산.
// 포커스 타이머가 측정한 실제 집중 시간 = 유일한 자동 근거 (일시정지·유휴 제외, 방치분 캡 포함).
async function sumTaskFocusSeconds(taskId) {
  if (!taskId) return 0;
  const rows = await FocusSession.findAll({ where: { task_id: taskId } });
  return rows.reduce((sum, r) => sum + (typeof r.computeActualSeconds === 'function' ? r.computeActualSeconds() : 0), 0);
}

/**
 * actual_hours 재계산. 반환: 계산된 시간(h) 또는 null(사용자 입력값이라 건드리지 않음 / task 없음).
 * 포커스 세션이 없으면 0 — "모르면 비운다". 프론트는 0/빈값을 placeholder 로 자연 처리한다.
 */
async function recomputeActualHours(taskId) {
  const task = await Task.findByPk(taskId);
  if (!task) return null;
  // 사용자가 직접 입력했으면 자동 산정 정지 (검정 표시 = 확정값)
  if (task.actual_source === 'user') return null;

  const focusSec = await sumTaskFocusSeconds(taskId);
  const hours = Math.round((focusSec / 3600) * 10) / 10;  // 0.1h 단위
  // 변경이 있을 때만 update — 자동 측정값이므로 actual_source='auto' (프론트 연회색 italic)
  if (hours !== Number(task.actual_hours) || task.actual_source !== 'auto') {
    await task.update({ actual_hours: hours, actual_source: 'auto' });
  }
  return hours;
}

module.exports = { recomputeActualHours };
