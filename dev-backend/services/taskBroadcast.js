// services/taskBroadcast.js
//
// 소켓으로 나가는 Task payload 의 **단일 직렬화 지점**.
//
// 왜 있는가 — emit 지점이 7곳으로 흩어져 있었고, 어떤 곳은 `task.toJSON()` (raw 컬럼, 사람 정보 없음),
// 어떤 곳은 assignee 를 include 하되 표시명 헬퍼를 안 태웠다. 프론트는
// `setAllTasks(prev => prev.map(t => t.id===task.id ? { ...t, ...task } : t))` 로 **spread 병합**이라,
// 표시명이 빠진 payload 하나가 도착하면 이미 화면에 있던 정상 표시명을 **계정명으로 덮어쓴다**.
//   운영 #277 이 정확히 이것이었다 — AI 예측 broadcast(task_actions.js)가 assignee 를 include 만 하고
//   applyMemberDisplayName 을 안 태워, 업무 생성 직후 자동 추정이 도는 행만 '루아' → '한수정' 으로 플립.
//
// 규약:
//   - **배치 우선**. task_priority 의 reindex 는 1회 드래그에 N건을 emit 한다.
//     per-task 조회/헬퍼 호출이면 쿼리가 폭증하므로 배열 API 를 기본으로 둔다.
//   - **부가 필드는 caller 가 spread 한다.** 헬퍼는 base 만 만든다
//     (reviewer_user_ids · actor_user_id · latest_estimation_source · ai_estimate 등은 경로마다 다르다).

const { Task, Project, User } = require('../models');
const { applyMemberDisplayName } = require('./displayName');

const PERSON_INCLUDE = [
  { model: Project, attributes: ['id', 'name'], required: false },
  { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
  { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
];

// 이미 include 를 붙여 조회한 Sequelize 인스턴스(또는 plain object) 배열을 받아
// 표시명만 입혀 plain JSON 배열로 돌려준다. 추가 쿼리 없음.
async function serializeLoadedTasks(rows, businessId) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  if (!list.length) return [];
  const json = list.map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : { ...r }));
  await applyMemberDisplayName(json, businessId, ['assignee', 'requester']);
  return json;
}

// task id 배열 → broadcast 용 plain JSON 배열 (사람 정보 + 표시명 포함).
//   조회 1회 + 표시명 조회 1회로 끝난다 (N+1 없음).
async function serializeTasksForBroadcast(taskIds, businessId) {
  const ids = [...new Set((Array.isArray(taskIds) ? taskIds : [taskIds]).filter(Boolean).map(Number))];
  if (!ids.length) return [];
  const rows = await Task.findAll({ where: { id: ids }, include: PERSON_INCLUDE });
  return serializeLoadedTasks(rows, businessId);
}

// 단건 — 없으면 null.
async function serializeTaskForBroadcast(taskId, businessId) {
  const [one] = await serializeTasksForBroadcast([taskId], businessId);
  return one || null;
}

module.exports = {
  PERSON_INCLUDE,
  serializeLoadedTasks,
  serializeTasksForBroadcast,
  serializeTaskForBroadcast,
};
