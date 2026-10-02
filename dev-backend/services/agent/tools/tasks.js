// AI 에이전트 도구 — 업무·메모·맥락 (#439 milestone 1, 설계 §6.2).
//
//   읽기는 기존 술어(taskListWhere·canAccessTask·메뉴 Layer), 쓰기는 **행동 계층**(task_actions)만 지난다.
//   이 파일은 모델에 create/update/destroy 를 직접 부르지 않는다(가드 agentsurface).
//   신원·범위는 principal(토큰)에서만 — 입력에 workspace/user id 칸이 없다.
const { Op } = require('sequelize');
const { z } = require('zod');
const { err, fromActionFailure } = require('../errors');
const { taskItem, noteItem } = require('../serialize');

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const OPEN = ['not_started', 'waiting', 'in_progress', 'reviewing', 'revision_requested', 'done_feedback'];

function validDate(s) {
  if (!s) return true;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;   // 2월 31일 같은 값 거절
}

async function scopeOf(p) {
  const { getUserScope } = require('../../../middleware/access_scope');
  return getUserScope(p.userId, p.businessId, p.platformRole);
}

/** 메뉴 Layer — 화면에서 안 보이는 메뉴를 AI 로 보면 안 된다(설계 §5.5). */
async function assertMenu(p, menu, level) {
  const { getMemberMenuLevels } = require('../../../middleware/menu_permission');
  const lv = await getMemberMenuLevels(p.businessId, p.userId);
  if (!lv || lv.role === 'owner' || lv.role === 'admin') return;
  const v = lv.menus[menu] || 'write';
  if (v === 'none' || (level === 'write' && v !== 'write')) throw err('PERMISSION_DENIED', `menu_${level === 'write' ? 'read_only' : 'hidden'}:${menu}`);
}

const TASK_INCLUDE = () => {
  const { User, Project, Client } = require('../../../models');
  return [
    { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
    { model: User, as: 'requester', attributes: ['id', 'name'], required: false },
    { model: Project, attributes: ['id', 'name'], required: false },
    { model: Client, attributes: ['id', 'display_name', 'company_name'], required: false },
  ];
};

async function shapeTasks(rows, businessId) {
  const { applyMemberDisplayName } = require('../../displayName');
  const js = rows.map((r) => r.toJSON());
  await applyMemberDisplayName(js, businessId, ['assignee', 'requester']);
  return js.map(taskItem);
}

/** 범위 안의 업무 하나 — 없으면 NOT_FOUND(남의 워크스페이스 id 의 존재 여부를 흘리지 않는다), 못 보면 PERMISSION_DENIED. */
async function loadTask(p, taskId, scope) {
  const { Task } = require('../../../models');
  const { canAccessTask } = require('../../../middleware/access_scope');
  const t = await Task.findOne({ where: { id: taskId, business_id: p.businessId }, include: TASK_INCLUDE() });
  if (!t) throw err('NOT_FOUND', 'task_not_found');
  if (!(await canAccessTask(p.userId, t, scope))) throw err('PERMISSION_DENIED', 'forbidden');
  return t;
}

const escLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// ── get_context ─────────────────────────────────────────────
async function getContext(p) {
  const { Business, User } = require('../../../models');
  const { getMemberNameMap } = require('../../displayName');
  const biz = await Business.findByPk(p.businessId, { attributes: ['id', 'name', 'brand_name', 'timezone'] });
  const u = await User.findByPk(p.userId, { attributes: ['id', 'name'] });
  const names = await getMemberNameMap(p.businessId, [p.userId]).catch(() => new Map());
  const tz = biz?.timezone || 'Asia/Seoul';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(now).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  return {
    user: { user_id: p.userId, name: names.get(p.userId) || u?.name || null },
    workspace: { business_id: p.businessId, name: biz?.brand_name || biz?.name || null, timezone: tz },
    today: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday || '').toLowerCase(),
    now_iso: now.toISOString(),
  };
}

// ── search_tasks ────────────────────────────────────────────
async function searchTasks(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const { Task } = require('../../../models');
  const { taskListWhere } = require('../../../middleware/access_scope');
  const scope = await scopeOf(p);
  const base = await taskListWhere(p.userId, p.businessId, scope);
  if (!base) throw err('PERMISSION_DENIED', 'no_task_access');
  if (!validDate(a.due_from) || !validDate(a.due_to)) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { due_from: a.due_from, due_to: a.due_to } });
  const conds = [base];
  const assignee = a.assignee === undefined ? 'me' : a.assignee;
  if (assignee === 'me') conds.push({ assignee_id: p.userId });
  else if (typeof assignee === 'number') conds.push({ assignee_id: assignee });
  const status = a.status || 'open';
  if (status === 'open') conds.push({ status: { [Op.in]: OPEN } });
  else if (status === 'done') conds.push({ status: 'completed' });
  else if (status === 'overdue') {
    const ctx = await getContext(p);
    conds.push({ status: { [Op.in]: OPEN } }, { due_date: { [Op.lt]: ctx.today } });
  }
  if (a.due_from) conds.push({ due_date: { [Op.gte]: a.due_from } });
  if (a.due_to) conds.push({ due_date: { [Op.lte]: a.due_to } });
  if (a.project_id) conds.push({ project_id: a.project_id });
  if (a.client_id) conds.push({ client_id: a.client_id });
  const q = String(a.query || '').normalize('NFC').trim();
  if (q) conds.push({ title: { [Op.like]: `%${escLike(q)}%` } });
  const limit = Math.min(50, a.limit || 20);
  // 권한 조건은 Op.and 안에 — 최상위 키로 두면 뒤 필터가 덮어쓴다(memory feedback_scope_where_top_key_overwritten)
  const { rows, count } = await Task.findAndCountAll({
    where: { [Op.and]: conds }, include: TASK_INCLUDE(),
    order: [['due_date', 'ASC'], ['updated_at', 'DESC']], limit, distinct: true,
  });
  return { items: await shapeTasks(rows, p.businessId), total: count, truncated: count > rows.length };
}

// ── get_task ────────────────────────────────────────────────
async function getTask(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const scope = await scopeOf(p);
  const t = await loadTask(p, a.task_id, scope);
  const [item] = await shapeTasks([t], p.businessId);
  const notes = await listNotes(p, t, 3);
  return { task: { ...item, description: t.description || null }, recent_notes: notes.items };
}

// ── create_task ─────────────────────────────────────────────
async function createTask(p, a, actor) {
  if (!validDate(a.due_date) || !validDate(a.start_date)) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { due_date: a.due_date, start_date: a.start_date } });
  if (a.start_date && a.due_date && a.start_date > a.due_date) throw err('VALIDATION_ERROR', 'start_after_due');
  if (a.assignee_user_id) {
    const { assertAssignable } = require('../../../middleware/access_scope');
    const ok = await assertAssignable(a.assignee_user_id, p.businessId, a.project_id || null);
    if (!ok.ok) throw err('PERMISSION_DENIED', `cannot_assign:${ok.reason}`);
  }
  const taskActions = require('../../actions/task_actions');
  const r = await taskActions.createTask(actor, {
    businessId: p.businessId,
    title: a.title,
    description: a.description || null,
    dueDate: a.due_date || null,
    startDate: a.start_date || null,
    assigneeId: a.assignee_user_id || null,
    projectId: a.project_id || null,
    clientId: a.client_id || null,
    priorityLevel: a.priority || null,
    createdVia: 'agent',
  }, { autoAiEstimate: false });
  if (!r.ok) throw fromActionFailure(r);
  const scope = await scopeOf(p);
  const t = await loadTask(p, r.data.task.id, scope);
  const [item] = await shapeTasks([t], p.businessId);
  return { task: item, created: true };
}

// ── get_task_notes / add_task_note ──────────────────────────
async function listNotes(p, task, limit, beforeId) {
  const { TaskComment, User } = require('../../../models');
  const { applyMemberDisplayName } = require('../../displayName');
  // 개인 메모(personal)는 **쓴 사람만** — 화면보다 좁게 둔다(외부로 나가는 표면이다).
  const where = { task_id: task.id, [Op.or]: [{ visibility: { [Op.ne]: 'personal' } }, { user_id: p.userId }] };
  if (beforeId) where.id = { [Op.lt]: beforeId };
  const rows = await TaskComment.findAll({
    where, include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
    order: [['id', 'DESC']], limit: limit + 1,
  });
  const js = rows.slice(0, limit).map((r) => r.toJSON());
  await applyMemberDisplayName(js, task.business_id, ['author']);
  return { items: js.map(noteItem), truncated: rows.length > limit };
}

async function getTaskNotes(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const scope = await scopeOf(p);
  const t = await loadTask(p, a.task_id, scope);
  const r = await listNotes(p, t, Math.min(50, a.limit || 20), a.before_note_id);
  return { task: { task_id: t.id, title: t.title }, ...r };
}

async function addTaskNote(p, a, actor) {
  await assertMenu(p, 'qtask', 'read');
  const scope = await scopeOf(p);
  const t = await loadTask(p, a.task_id, scope);
  const taskActions = require('../../actions/task_actions');
  const r = await taskActions.createComment(actor, t, { content: a.content, visibility: a.visibility || 'internal' });
  if (!r.ok) throw fromActionFailure(r);
  return { note: noteItem(r.data), task: { task_id: t.id, title: t.title }, created: true };
}

// ── reschedule_task / complete_task — MEDIUM(설계 §7): execute 가 먼저 preview 로 «무엇이 바뀌는지» 를 돌려주고,
//    사용자가 동의한 뒤 confirmation_token 과 함께 다시 부를 때만 실행한다. 실행은 행동 계층(이력·알림·broadcast).
const dateOf = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);

async function previewReschedule(p, a) {
  if (a.due_date === undefined && a.start_date === undefined) throw err('VALIDATION_ERROR', 'no_fields');
  if (!validDate(a.due_date) || !validDate(a.start_date)) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { due_date: a.due_date, start_date: a.start_date } });
  await assertMenu(p, 'qtask', 'read');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  // 실행(updateSchedule)과 같은 판정을 미리보기에서 먼저 — 거절될 요청에 확인 토큰을 내주지 않는다(Fable M2-a 관찰)
  const taskActions = require('../../actions/task_actions');
  if (!(await taskActions.canChangeStatus(t, previewActor(p)))) throw err('PERMISSION_DENIED', 'forbidden_fields:schedule');
  if (['completed', 'canceled'].includes(t.status)) throw err('CONFLICT', 'task_closed');
  const before = { start_date: dateOf(t.start_date), due_date: dateOf(t.due_date) };
  const after = { start_date: a.start_date !== undefined ? a.start_date : before.start_date, due_date: a.due_date !== undefined ? a.due_date : before.due_date };
  if (after.start_date && after.due_date && after.due_date < after.start_date) throw err('VALIDATION_ERROR', 'due_before_start');
  return { task: { task_id: t.id, title: t.title }, before, after };
}

async function rescheduleTask(p, a, actor) {
  await assertMenu(p, 'qtask', 'write');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  const taskActions = require('../../actions/task_actions');
  const r = await taskActions.updateSchedule(t, actor, { start_date: a.start_date, due_date: a.due_date });
  if (!r.ok) throw fromActionFailure(r);
  const fresh = await loadTask(p, t.id, await scopeOf(p));
  const [item] = await shapeTasks([fresh], p.businessId);
  return { task: item, changed: r.data?.changed !== false };
}

async function previewComplete(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  // complete() 와 같은 판정을 먼저 — 담당자만 · 닫힌 업무 아님 · 컨펌 대기 아님(승인완료 제외)
  if (t.assignee_id !== p.userId) throw err('PERMISSION_DENIED', 'only_assignee');
  if (['completed', 'canceled'].includes(t.status)) throw err('CONFLICT', 'task_closed');
  if (t.status === 'on_hold') throw err('CONFLICT', 'task_on_hold');
  const { TaskReviewer } = require('../../../models');
  if (t.status !== 'done_feedback' && (await TaskReviewer.count({ where: { task_id: t.id } })) > 0) throw err('CONFLICT', 'not_ready_for_complete');
  return { task: { task_id: t.id, title: t.title }, before: { status: t.status }, after: { status: 'completed' } };
}

async function completeTask(p, a, actor) {
  await assertMenu(p, 'qtask', 'write');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  const taskActions = require('../../actions/task_actions');
  const r = await taskActions.complete(t, actor);
  if (!r.ok) throw fromActionFailure(r);
  const fresh = await loadTask(p, t.id, await scopeOf(p));
  const [item] = await shapeTasks([fresh], p.businessId);
  return { task: item };
}

// 미리보기는 실행 주체와 같은 모양의 actor 로 판정한다(채널은 감사용이라 미리보기엔 필요 없다)
const previewActor = (p) => ({ kind: 'user', userId: p.userId, platformRole: p.platformRole, req: null });

// ── assign_task (MEDIUM) / update_task (LOW) — #439 M2-b. 규칙은 PUT /tasks/:id 와 같은 행동 계층 함수 ──
async function memberName(p, userId) {
  if (!userId) return null;
  const { getMemberNameMap } = require('../../displayName');
  const m = await getMemberNameMap(p.businessId, [userId]).catch(() => new Map());
  if (m.get(userId)) return m.get(userId);
  const { User } = require('../../../models');
  return (await User.findByPk(userId, { attributes: ['name'] }))?.name || null;
}

async function previewAssign(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  const taskActions = require('../../actions/task_actions');
  const ctx = await taskActions.fieldContext(t, p.userId, p.platformRole);
  if (taskActions.deniedFields(['assignee_id'], ctx).length) throw err('PERMISSION_DENIED', 'forbidden_fields:assignee_id');
  const { assertAssignable } = require('../../../middleware/access_scope');
  const chk = await assertAssignable(a.assignee_user_id, p.businessId, t.project_id);
  if (!chk.ok) throw err('PERMISSION_DENIED', `cannot_assign:${chk.reason}`);
  return {
    task: { task_id: t.id, title: t.title },
    before: { assignee: t.assignee_id ? { user_id: t.assignee_id, name: await memberName(p, t.assignee_id) } : null },
    after: { assignee: { user_id: a.assignee_user_id, name: await memberName(p, a.assignee_user_id) } },
    note: 'The new assignee will be notified.',
  };
}

async function assignTask(p, a, actor) {
  await assertMenu(p, 'qtask', 'write');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  const taskActions = require('../../actions/task_actions');
  const r = await taskActions.reassign(t, actor, { assigneeId: a.assignee_user_id });
  if (!r.ok) throw fromActionFailure(r);
  const fresh = await loadTask(p, t.id, await scopeOf(p));
  const [item] = await shapeTasks([fresh], p.businessId);
  return { task: item, changed: r.data.changed };
}

async function updateTask(p, a, actor) {
  await assertMenu(p, 'qtask', 'write');
  const t = await loadTask(p, a.task_id, await scopeOf(p));
  const taskActions = require('../../actions/task_actions');
  const r = await taskActions.updateFields(t, actor, { title: a.title, description: a.description, priority_level: a.priority });
  if (!r.ok) throw fromActionFailure(r);
  const fresh = await loadTask(p, t.id, await scopeOf(p));
  const [item] = await shapeTasks([fresh], p.businessId);
  return { task: { ...item, description: fresh.description || null } };
}

module.exports = {
  dateOnly, getContext, searchTasks, getTask, createTask, getTaskNotes, addTaskNote, validDate,
  previewReschedule, rescheduleTask, previewComplete, completeTask,
  previewAssign, assignTask, updateTask,
};
