// 일정 ↔ 업무 연결 — 붙일 때와 보여줄 때의 판정 **한 곳** (2026-10-07).
//   CLAUDE.md «공유·참조 다섯 규칙» ⑤: 붙일 때 원본 읽기 권한, 보여줄 때 보는 사람 기준. 제목을 복사해 두지 않는다.
//   판정 술어는 업무를 열 때와 같은 access_scope.canAccessTask — 일정 쪽에서 따로 정하지 않는다.
const { Task } = require('../models');
const { canAccessTask, getUserScope } = require('../middleware/access_scope');

/** 붙일 업무 검증 — 빈 값은 «연결 없음». 같은 워크스페이스 + 내가 열 수 있는 업무만. */
async function resolveTaskLink(userId, businessId, raw) {
  if (raw === undefined) return { ok: true, skip: true };
  if (raw === null || raw === '' || raw === 0) return { ok: true, taskId: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, code: 'invalid_task' };
  const task = await Task.findOne({ where: { id, business_id: Number(businessId) } });
  if (!task || !(await canAccessTask(userId, task))) return { ok: false, code: 'invalid_task' };
  return { ok: true, taskId: task.id };
}

/** 응답의 일정들에 task 를 싣는다 — 볼 수 있으면 {id,title,status,project_id}, 아니면 {id, hidden:true} · 지워졌으면 deleted:true 를 더한다. */
async function attachTaskLinks(events, userId, businessId, scope) {
  const list = (events || []).filter((e) => e && e.task_id);
  if (!list.length) return events;
  const ids = [...new Set(list.map((e) => Number(e.task_id)))];
  const tasks = await Task.findAll({ where: { id: ids, business_id: Number(businessId) }, attributes: ['id', 'business_id', 'title', 'status', 'project_id', 'assignee_id', 'created_by', 'request_by_user_id', 'conversation_id'] });
  const sc = scope || await getUserScope(userId, Number(businessId));
  const visible = new Map();
  for (const t of tasks) if (await canAccessTask(userId, t, sc)) visible.set(t.id, t);
  for (const e of list) {
    const t = visible.get(Number(e.task_id));
    // 행이 아예 없으면 «삭제됨» — 업무는 하드 삭제라 «볼 수 없음» 으로 그리면 권한 문제처럼 읽힌다(Fable 행 32).
    const exists = tasks.some((x) => x.id === Number(e.task_id));
    e.task = t ? { id: t.id, title: t.title, status: t.status, project_id: t.project_id }
      : exists ? { id: Number(e.task_id), hidden: true } : { id: Number(e.task_id), hidden: true, deleted: true };
  }
  return events;
}

module.exports = { resolveTaskLink, attachTaskLinks };
