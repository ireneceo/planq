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

// 메뉴 Layer — 화면에서 안 보이는 메뉴를 AI 로 보면 안 된다(설계 §5.5). 판정은 services/agent/menu 한 벌.
const { assertMenu } = require('../menu');
const { parsePage, pageOf, clip } = require('../page');
const cfg = require('../../agent_oauth/config');

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
//   M3-a(설계 §4.1) — 날짜는 **사용자 시간대**(users.timezone, 없으면 워크스페이스)로 푼다. 사람이 «오늘» 이라고 말할 때의
//   기준은 그 사람이 사는 시간대다. 연결이 무엇을 볼 수 있는지(granted)도 같이 알려 준다 — 모델이 메일 권한 없이 메일을 찾다
//   헤매지 않게.
function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

function localParts(tz, now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a, x) => ({ ...a, [x.type]: x.value }), {});
  const hh = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: String(parts.weekday || '').toLowerCase(), local: `${parts.year}-${parts.month}-${parts.day}T${hh}:${parts.minute}` };
}

async function getContext(p) {
  const { Business, User } = require('../../../models');
  const { getMemberNameMap } = require('../../displayName');
  const biz = await Business.findByPk(p.businessId, { attributes: ['id', 'name', 'brand_name', 'timezone'] });
  const u = await User.findByPk(p.userId, { attributes: ['id', 'name', 'timezone'] });
  const names = await getMemberNameMap(p.businessId, [p.userId]).catch(() => new Map());
  const wsTz = validTz(biz?.timezone) ? biz.timezone : 'Asia/Seoul';
  const userTz = validTz(u?.timezone) ? u.timezone : wsTz;
  const now = new Date();
  const lp = localParts(userTz, now);
  const scopes = p.scopes || [];
  let mailCount = null;
  if (scopes.includes('mail:read')) {
    const { accessibleAccountIds } = require('../../mailIdentity');
    mailCount = (await accessibleAccountIds(p.businessId, p.userId)).length;
  }
  return {
    user: { user_id: p.userId, name: names.get(p.userId)?.name || u?.name || null, timezone: userTz },
    workspace: { business_id: p.businessId, name: biz?.brand_name || biz?.name || null, timezone: wsTz },
    today: lp.date,
    weekday: lp.weekday,
    now_local: lp.local,
    now_iso: now.toISOString(),
    granted: {
      write: scopes.some((x) => cfg.WRITE_SCOPES.includes(x)),
      mail: scopes.includes('mail:read'),
      mail_drafts: scopes.includes('mail_drafts:write'),
    },
    mail_accounts_count: mailCount,
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
  if (a.updated_since) {
    const d = new Date(String(a.updated_since));
    if (Number.isNaN(d.getTime())) throw err('VALIDATION_ERROR', 'invalid_datetime', { fields: { updated_since: a.updated_since } });
    conds.push({ updated_at: { [Op.gte]: d } });
  }
  const q = String(a.query || '').normalize('NFC').trim();
  if (q) {
    const like = `%${escLike(q)}%`;
    conds.push({ [Op.or]: [{ title: { [Op.like]: like } }, { description: { [Op.like]: like } }] });
  }
  const pg = parsePage(a);
  // 권한 조건은 Op.and 안에 — 최상위 키로 두면 뒤 필터가 덮어쓴다(memory feedback_scope_where_top_key_overwritten)
  const { rows, count } = await Task.findAndCountAll({
    where: { [Op.and]: conds }, include: TASK_INCLUDE(),
    order: [['due_date', 'ASC'], ['updated_at', 'DESC'], ['id', 'DESC']], limit: pg.pageSize, offset: pg.offset, distinct: true,
  });
  return pageOf(await shapeTasks(rows, p.businessId), count, pg);
}

// ── get_task ────────────────────────────────────────────────
//   M3-a(설계 §4.3) — 설명 전체(≤8,000 + truncated) · 첨부 메타 · 출처(메일·채팅) · 관련 업무 · 최근 메모 3 + 더 있나.
const DESC_MAX = 8000;

async function taskExtras(p, t, scope) {
  const { TaskAttachment, TaskLink, Task } = require('../../../models');
  // 첨부 — 업무 자체에 붙은 것만(댓글 첨부는 그 댓글의 공개 범위를 따라야 하므로 여기 싣지 않는다). 바이트·경로는 내보내지 않는다.
  const atts = await TaskAttachment.findAll({
    where: { task_id: t.id, business_id: p.businessId, comment_id: null },
    attributes: ['id', 'context', 'original_name', 'file_size', 'mime_type', 'post_id', 'created_at'],
    order: [['id', 'ASC']], limit: 50,
  });
  const links = await TaskLink.findAll({ where: { [Op.or]: [{ task_a_id: t.id }, { task_b_id: t.id }] }, attributes: ['task_a_id', 'task_b_id', 'link_type'], limit: 50 });
  const otherIds = links.map((l) => (l.task_a_id === t.id ? l.task_b_id : l.task_a_id));
  let related = [];
  if (otherIds.length) {
    const { taskListWhere } = require('../../../middleware/access_scope');
    const base = await taskListWhere(p.userId, p.businessId, scope);
    if (base) {
      const rows = await Task.findAll({ where: { [Op.and]: [base, { business_id: p.businessId }, { id: { [Op.in]: otherIds } }] }, attributes: ['id', 'title', 'status'] });
      related = rows.map((r) => ({ task_id: r.id, title: r.title, status: r.status, url: `${cfg.APP_URL}/tasks?task=${r.id}` }));
    }
  }
  let source = null;
  if (t.email_thread_id) source = { kind: 'mail', thread_id: t.email_thread_id, message_id: t.source_email_message_id || null, url: `${cfg.APP_URL}/mail?thread=${t.email_thread_id}` };
  else if (t.conversation_id) source = { kind: 'chat', conversation_id: t.conversation_id, url: `${cfg.APP_URL}/talk?conv=${t.conversation_id}` };
  return {
    attachments: atts.map((x) => ({ attachment_id: x.id, context: x.context, name: x.original_name || null, size_bytes: x.file_size ?? null, mime_type: x.mime_type || null, post_id: x.post_id || null })),
    related_tasks: related,
    source,
  };
}

async function getTask(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const scope = await scopeOf(p);
  const t = await loadTask(p, a.task_id, scope);
  const [item] = await shapeTasks([t], p.businessId);
  const notes = await listNotes(p, t, 3);
  const d = clip(t.description, DESC_MAX);
  const extras = await taskExtras(p, t, scope);
  return {
    task: {
      ...item,
      description: t.description ? d.text : null,
      description_total_chars: d.total,
      truncated_fields: d.cut ? ['description'] : [],
      ...extras,
    },
    recent_notes: notes.items,
    notes_has_more: notes.truncated,
  };
}

// ── create_task ─────────────────────────────────────────────
async function createTask(p, a, actor) {
  if (!validDate(a.due_date) || !validDate(a.start_date)) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { due_date: a.due_date, start_date: a.start_date } });
  if (a.start_date && a.due_date && a.start_date > a.due_date) throw err('VALIDATION_ERROR', 'start_after_due');
  // M3-c 출처(설계 §6) — 읽을 수 있는 메일·채팅만 붙인다(services/agent/tools/sources). 메일이면 그 스레드에 PlanQ 가 건
  //   고객·프로젝트 연결을 승계한다(모델이 안 줬을 때만 — 추측이 아니라 mailLink 완전일치·사람이 건 값이다).
  const { resolveSource } = require('./sources');
  const src = await resolveSource(p, a.source, ['mail', 'chat']);
  const projectId = a.project_id || (src && src.kind === 'mail' ? src.thread.project_id : null) || null;
  const clientId = a.client_id || (src && src.kind === 'mail' ? src.thread.client_id : null) || null;
  if (a.assignee_user_id) {
    const { assertAssignable } = require('../../../middleware/access_scope');
    const ok = await assertAssignable(a.assignee_user_id, p.businessId, projectId);
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
    projectId,
    clientId,
    priorityLevel: a.priority || null,
    createdVia: 'agent',
    ...(src && src.kind === 'mail' ? { emailThreadId: src.thread.id, sourceEmailMessageId: src.messageId } : {}),
    ...(src && src.kind === 'chat' ? { conversationId: src.conversation.id } : {}),
  }, { autoAiEstimate: false });
  if (!r.ok) throw fromActionFailure(r);
  const scope = await scopeOf(p);
  const t = await loadTask(p, r.data.task.id, scope);
  const [item] = await shapeTasks([t], p.businessId);
  const extras = await taskExtras(p, t, scope);
  return { task: { ...item, source: extras.source }, created: true };
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
  const hasMore = rows.length > limit;
  // 키셋(id DESC) — 새 댓글이 끼어도 중복 없이 이어진다(설계 §4.0). next_before_note_id 로 다음 묶음을 부른다.
  return { items: js.map(noteItem), has_more: hasMore, truncated: hasMore, next_before_note_id: hasMore && js.length ? js[js.length - 1].id : null };
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
  if (m.get(userId)?.name) return m.get(userId).name;
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

/** 출처로 쓸 업무(create_event source) — get_task 와 같은 문(워크스페이스 묶음 + canAccessTask). */
async function loadTaskForSource(p, taskId) {
  return loadTask(p, taskId, await scopeOf(p));
}

module.exports = {
  loadTaskForSource,
  dateOnly, getContext, searchTasks, getTask, createTask, getTaskNotes, addTaskNote, validDate,
  previewReschedule, rescheduleTask, previewComplete, completeTask,
  previewAssign, assignTask, updateTask,
};
