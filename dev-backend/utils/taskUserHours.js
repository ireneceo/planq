// task_user_hours 동기화 헬퍼.
// task의 (담당자/요청자/컨펌자) 변경 시 row 를 idempotent 하게 추가/이전한다.
// 시간 값은 보존 — 사용자가 입력한 시간은 절대 자동 삭제하지 않는다 (단, 역할 자체가 사라지면 row 제거).

const { TaskUserHours } = require('../models');

// 담당자 row 보장 (없으면 생성, assignee 가 바뀌면 새 user_id 로 row 생성).
// 기존 row 는 user_id가 다르면 그대로 두고 new row 추가 — 데이터 보존 우선.
// 단, 같은 task 에 같은 role 의 row 가 동일 user 로 두 개 생기는 것은 unique 제약으로 방지.
async function ensureAssigneeRow(taskId, assigneeId, opts = {}) {
  if (!taskId || !assigneeId) return null;
  const { estimated_hours = 0, actual_hours = 0 } = opts;
  const [row] = await TaskUserHours.findOrCreate({
    where: { task_id: taskId, user_id: assigneeId, role: 'assignee' },
    defaults: { estimated_hours, actual_hours },
  });
  return row;
}

// 요청자 row 보장 (있으면 유지, 없으면 0 으로 생성).
async function ensureRequesterRow(taskId, requesterId) {
  if (!taskId || !requesterId) return null;
  const [row] = await TaskUserHours.findOrCreate({
    where: { task_id: taskId, user_id: requesterId, role: 'requester' },
    defaults: { estimated_hours: 0, actual_hours: 0 },
  });
  return row;
}

// 컨펌자 row 보장 (있으면 유지, 없으면 0 으로 생성).
async function ensureReviewerRow(taskId, reviewerUserId) {
  if (!taskId || !reviewerUserId) return null;
  const [row] = await TaskUserHours.findOrCreate({
    where: { task_id: taskId, user_id: reviewerUserId, role: 'reviewer' },
    defaults: { estimated_hours: 0, actual_hours: 0 },
  });
  return row;
}

// 컨펌자 제거 시 reviewer row 삭제.
async function removeReviewerRow(taskId, reviewerUserId) {
  if (!taskId || !reviewerUserId) return 0;
  return TaskUserHours.destroy({
    where: { task_id: taskId, user_id: reviewerUserId, role: 'reviewer' },
  });
}

// 본인의 row 시간 업데이트 — role/user_id 조합 row 가 없으면 생성 후 업데이트.
async function upsertHours(taskId, userId, role, { estimated_hours, actual_hours } = {}) {
  if (!taskId || !userId || !role) throw new Error('taskId/userId/role required');
  const [row] = await TaskUserHours.findOrCreate({
    where: { task_id: taskId, user_id: userId, role },
    defaults: {
      estimated_hours: estimated_hours ?? 0,
      actual_hours: actual_hours ?? 0,
    },
  });
  const updates = {};
  if (estimated_hours !== undefined) updates.estimated_hours = Number(estimated_hours) || 0;
  if (actual_hours !== undefined) updates.actual_hours = Number(actual_hours) || 0;
  if (Object.keys(updates).length > 0) await row.update(updates);
  return row;
}

module.exports = {
  ensureAssigneeRow,
  ensureRequesterRow,
  ensureReviewerRow,
  removeReviewerRow,
  upsertHours,
};
