// taskActualHours — task_status_history 기반 actual_hours 자동 누적 (사이클 N+6)
//
// 설계 원칙:
//   - 모든 in_progress 진입 ~ 이탈 (reviewing/completed/canceled/revision_requested 등) 사이 시간 합산
//   - 반려 후 다시 in_progress = 새 라운드 누적 (여러 라운드 합산)
//   - 현재 in_progress 상태면 지금까지 시간도 임시 합산 — 사용자에게 즉시 시각 피드백
//   - actual_source='user' 면 자동 누적 skip (사용자 직접 입력값 보존)
//
// 호출:
//   - TaskStatusHistory afterCreate hook 에서 자동 (status_change 이벤트만)
//   - 또는 status 변경 라우트에서 명시적 호출 (workflow 라우트 commit 직후)

const { Task, TaskStatusHistory, FocusSession } = require('../models');

// 같은 task 의 모든 focus_session 실측 시간 합 (초). active/paused 도 computeActualSeconds 가 현재까지 계산.
// 포커스 타이머가 측정한 실제 집중 시간 = 가장 정확한 실제시간 (일시정지·유휴 제외).
async function sumTaskFocusSeconds(taskId) {
  if (!taskId) return 0;
  const rows = await FocusSession.findAll({ where: { task_id: taskId } });
  return rows.reduce((sum, r) => sum + (typeof r.computeActualSeconds === 'function' ? r.computeActualSeconds() : 0), 0);
}

async function recomputeActualHoursFromHistory(taskId) {
  const task = await Task.findByPk(taskId);
  if (!task) return null;
  // 사용자가 직접 입력했으면 자동 누적 정지
  if (task.actual_source === 'user') return null;

  // ── 우선순위 1: 포커스 실측 시간 (SSOT, #17/#35) ──
  // 포커스 타이머를 쓴 task 는 측정값이 status 구간보다 정확(일시정지·유휴 제외) →
  // 포커스 세션이 있으면 그 합을 actual_hours 로. 포커스 미사용 task 만 status_history fallback.
  // (운영 #35: 포커스로 완료해도 actual_hours 가 0 이던 회귀 — status_history 에 in_progress 구간이
  //  없으면 0 이었음. 포커스 측정값을 직접 반영해 근본 차단.)
  const focusSec = await sumTaskFocusSeconds(taskId);
  if (focusSec > 0) {
    const fHours = Math.round((focusSec / 3600) * 10) / 10;
    // 자동 측정값 — actual_source='auto' 명시(프론트 연회색). 시작/멈춤/재개/완료 사이 시간 합.
    if (fHours !== Number(task.actual_hours) || task.actual_source !== 'auto') {
      await task.update({ actual_hours: fHours, actual_source: 'auto' });
    }
    return fHours;
  }

  // ── 우선순위 2: status_history in_progress 구간 합 (포커스 미사용) ──
  const history = await TaskStatusHistory.findAll({
    where: { task_id: taskId, event_type: 'status_change' },
    order: [['created_at', 'ASC']],
    attributes: ['from_status', 'to_status', 'created_at'],
  });

  let totalMs = 0;
  let inProgressStartMs = null;
  for (const h of history) {
    // Sequelize underscored 모델 — DB 컬럼명 created_at 이지만 instance 접근은 createdAt.
    // get('created_at') 으로 컬럼명 직접 조회 (raw vs camelCase 양쪽 모두 안전).
    const ts = h.get('created_at') || h.createdAt;
    const t = new Date(ts).getTime();
    if (h.to_status === 'in_progress') {
      // 새 in_progress 진입 — 마커 시작 (이미 마커 있으면 그대로 유지: 같은 to_status 중복 방어)
      if (inProgressStartMs == null) inProgressStartMs = t;
    } else if (inProgressStartMs != null) {
      // in_progress 이탈 — 누적 + 마커 해제
      totalMs += Math.max(0, t - inProgressStartMs);
      inProgressStartMs = null;
    }
  }
  // 현재 in_progress 면 지금까지 시간도 임시 누적 (사용자에게 즉시 피드백)
  if (inProgressStartMs != null && task.status === 'in_progress') {
    totalMs += Math.max(0, Date.now() - inProgressStartMs);
  }

  const hours = Math.round((totalMs / 1000 / 3600) * 10) / 10;  // 0.1h 단위
  // 변경이 있을 때만 update — 자동 측정값이므로 actual_source='auto' (연회색 표시)
  if (hours !== Number(task.actual_hours) || task.actual_source !== 'auto') {
    await task.update({ actual_hours: hours, actual_source: 'auto' });
  }
  return hours;
}

module.exports = { recomputeActualHoursFromHistory };
