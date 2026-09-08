// services/taskSeriesScope.js — "이 수정이 어느 회차들에 닿는가" **단일 판정**.
//
// Irene 2026-09-08: *"반복업무 내용 수정을 모든 업무 수정하기, 이 업무만 수정하기,
//   이 업무부터 뒤의 업무들 수정하기 적용해서 반복설정 및 내용 다 적용하게 해야해.
//   업무가 반복된다는 건 내용도 반복관리가 되어야 하잖아. 이게 계속 요구하는데 안되네."*
//
// 왜 또 안 됐나: PUT(제목·설명·담당자…)에는 범위가 붙어 있었는데 **태그와 컨펌자는 별도 라우트**라
//   범위 개념 자체가 없었다. 사용자에게 그것들도 똑같은 "내용" 이다 —
//   진입점마다 술어가 갈라지면 "어디서 고쳤느냐" 로 결과가 달라진다
//   (memory: feedback_list_blocked_search_open · feedback_comment_lies_predicate_drifts).
//
// 그래서 대상 산출을 여기 **한 함수**로 두고 PUT·태그·컨펌자가 같이 부른다.
// 주석으로 "같은 규칙" 이라고 적지 않는다 — 같은 함수를 부르게 한다.
const { Op } = require('sequelize');
const { Task } = require('../models');

const SCOPES = ['single', 'future', 'all'];

/** 시리즈의 모든 회차가 같이 쓰는 **내용** 필드.
 *  회차마다 달라야 하는 값(status·진행률·실적시간·마감일·결과물 body·완료시각)은 여기 없다.
 *  ★ 프론트 `src/utils/taskSeries.ts` 의 TASK_SERIES_FIELDS 와 **같은 집합**이어야 한다 —
 *    한쪽에만 있으면 화면이 안 묻고 단건 저장돼 "왜 모두 안 바뀌어?" 가 된다(실제로 그랬다).
 *    회귀는 `node scripts/e2e/run.js --suite seriesscope` 가 두 목록을 대조해 막는다. */
const SERIES_CONTENT_FIELDS = [
  'title', 'description', 'category', 'assignee_id', 'estimated_hours',
  'priority_level', 'workstream_id', 'is_milestone',
];

/** 이 업무가 반복 시리즈에 속하는가 (부모이거나 회차이거나). */
function isSeriesTask(task) {
  return !!(task && (task.recurrence_rule || task.recurrence_parent_id));
}

function normalizeScope(raw) {
  const s = String(raw || 'single').toLowerCase();
  return SCOPES.includes(s) ? s : 'single';
}

/**
 * 적용 대상 업무 id 목록.
 *   single — 이 업무만 (기본. 반복이 아니어도 항상 이 값)
 *   future — 이 회차 + 마감일이 같거나 뒤인 회차 + **부모**(앞으로 생길 회차의 원본이므로 항상 포함)
 *   all    — 시리즈 전체 (취소된 회차 제외)
 *
 * ★ 취소(canceled)된 회차는 건드리지 않는다 — 이미 없던 일로 한 회차의 내용을 바꿔 봐야
 *   원장만 흐려진다.
 */
async function seriesTargetIds(task, rawScope) {
  const scope = normalizeScope(rawScope);
  if (scope === 'single' || !isSeriesTask(task)) return { scope: 'single', ids: [task.id] };

  const parentId = task.recurrence_parent_id || task.id;
  const where = {
    business_id: task.business_id,
    status: { [Op.notIn]: ['canceled'] },
    [Op.or]: [{ id: parentId }, { recurrence_parent_id: parentId }],
  };
  if (scope === 'future' && task.due_date) {
    where[Op.and] = [{ [Op.or]: [{ id: parentId }, { due_date: { [Op.gte]: task.due_date } }] }];
  }
  const rows = await Task.findAll({ where, attributes: ['id'] });
  const ids = rows.map((r) => r.id);
  // 지금 고치는 업무는 언제나 포함된다 — 취소 상태여도 사용자가 그 행을 고치는 중이다.
  if (!ids.includes(task.id)) ids.push(task.id);
  return { scope, ids };
}

module.exports = { seriesTargetIds, isSeriesTask, normalizeScope, SCOPES, SERIES_CONTENT_FIELDS };
