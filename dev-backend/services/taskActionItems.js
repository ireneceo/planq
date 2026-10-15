// services/taskActionItems.js — 업무 «결과물 액션» 의 **한 곳** (2026-10-12, 설계 docs/TASK_ACTIONS_DESIGN.md §3)
//
// Irene: *"업무를 할 때 결과물을 문서로 만들어야 하면 문서작성하게 보내고 … 일정을 추가하게 보내고 …
//   그 액션버튼을 통해 갔으면 해당 업무랑 연결되어 있는 거 알게 해주고"* (Fable 설계 · Irene «권고대로»)
//
// 무엇이 여기에 있나 — 라우트·대상 화면 저장 경로(문서·일정)·반복 생성기가 전부 이 파일을 부른다:
//   · KINDS             종류 ↔ 대상 짝 · 받을 수 있는 종류(enabled) — 짝을 다른 곳에서 다시 적지 않는다
//   · canEditList       적기(추가·이름·순서·건너뛰기·삭제) = 작성자·담당자·owner·admin (title 축)
//   · canPerform        만들러 가기·연결·해제 = **담당자만, 직급 예외 없음** (body 축 — 액션 완료 = 결과물 첨부)
//   · fulfill           «무엇으로 끝났나» 를 쓰는 **유일한 문**
//   · unlink · onPostPublished · onAttachmentDeleted
//   · linkedTasksOf     대상 쪽 «연결된 업무» 직렬화 하나(보는 사람 기준)
//   · serializeList     업무 상세 목록(+ 대상 요약, 보는 사람 기준)
//   · copyToOccurrence  반복 회차에 내용만 복사(연결·완료는 두고 온다)
//
// 같은 값을 두 벌로 두지 않는다 — «문서가 결과물에 들어가는가» 의 정본은 task_attachments(post_id),
//   «일정이 어느 업무 것인가» 는 calendar_events.task_id. 이 표는 «무엇으로 끝났나» 만 기억한다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { TaskActionItem, Task, TaskAttachment, Post, CalendarEvent } = require('../models');
const { getUserScope, canAccessTask, isMemberOrAbove, isWorkspaceAdmin, calendarListWhere } = require('../middleware/access_scope');

const fail = (code, http = 400) => ({ ok: false, code, http });
const done = (data) => ({ ok: true, data });

// 1단계(문서·일정)만 받는다. 메일·프로젝트는 ENUM 에는 있고 2단계에 enabled 로 켠다.
const KINDS = {
  doc: { entity: 'post', enabled: true },
  event: { entity: 'calendar_event', enabled: true },
  mail: { entity: 'email_thread', enabled: false },
  project: { entity: 'project', enabled: false },
};
const MAX_PER_TASK = 30;

function canEditList(task, userId, scope) {
  const uid = Number(userId);
  return task.created_by === uid || task.assignee_id === uid || isWorkspaceAdmin(scope);
}
function canPerform(task, userId) {
  return !!task.assignee_id && task.assignee_id === Number(userId);
}

function audit(actor, action, item, extra = {}) {
  require('./auditService').logAudit(actor?.req || null, {
    userId: actor?.userId || null,
    action,
    targetType: 'task',
    targetId: item.task_id,
    businessId: item.business_id,
    newValue: { action_item_id: item.id, kind: item.kind, label: item.label, ...extra },
  });
}

function broadcast(task, actorUserId) {
  // 드로어는 이미 task:updated 에 상세를 다시 읽는다 — 새 소켓 사건을 만들지 않는다(§16 (c)).
  require('./taskTransition').broadcastTask(task, 'task:updated', actorUserId || null);
}

/** 업무 + 보는 사람 판정. 멤버 이상 ∧ canAccessTask 가 아니면 404(존재를 알리지 않는다). */
async function loadTaskFor(userId, platformRole, taskId, businessId = null) {
  const where = { id: Number(taskId) };
  if (businessId) where.business_id = Number(businessId);
  const task = await Task.findOne({ where });
  if (!task) return { fail: fail('task_not_found', 404) };
  const scope = await getUserScope(userId, task.business_id, platformRole);
  if (!isMemberOrAbove(scope)) return { fail: fail(scope.isClient ? 'forbidden' : 'task_not_found', scope.isClient ? 403 : 404) };
  if (!(await canAccessTask(userId, task, scope))) return { fail: fail('task_not_found', 404) };
  return { task, scope };
}

/** 대상 행 — 같은 워크스페이스 + 보는 사람 기준. { row, visible } · 행이 없으면 row=null. */
async function loadEntity(entityType, entityId, businessId, user) {
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) return { row: null, visible: false };
  if (entityType === 'post') {
    const row = await Post.findOne({ where: { id, business_id: Number(businessId) } });
    if (!row) return { row: null, visible: false };
    const visible = await require('./postAccess').canReadPost(user, row);
    return { row, visible };
  }
  if (entityType === 'calendar_event') {
    const row = await CalendarEvent.findOne({ where: { id, business_id: Number(businessId) } });
    if (!row) return { row: null, visible: false };
    const scope = await getUserScope(user.id, Number(businessId), user.platform_role);
    const w = await calendarListWhere(user.id, Number(businessId), scope);
    const visible = !!(w && await CalendarEvent.findOne({ where: { [Op.and]: [{ id }, w] }, attributes: ['id'] }));
    return { row, visible };
  }
  return { row: null, visible: false };
}

/**
 * «무엇으로 끝났나» 를 쓰는 유일한 문.
 * @param actor  { userId, platformRole, req? }
 * @param p      { actionId, entityType, entityId, source: 'create'|'manual', businessId?, taskId? }
 *   businessId 를 주면 그 워크스페이스의 액션만 찾는다(대상이 만들어진 워크스페이스). 남의 id 는 404.
 *   ★ 호출부(문서·일정 만들기)는 자기 검사를 더하지 않는다 — 판정은 여기 한 곳이다.
 */
async function fulfill(actor, p) {
  const where = { id: Number(p.actionId) };
  if (p.businessId) where.business_id = Number(p.businessId);
  if (p.taskId) where.task_id = Number(p.taskId);
  if (!Number.isInteger(where.id) || where.id <= 0) return fail('action_not_found', 404);
  const item = await TaskActionItem.findOne({ where });
  if (!item) return fail('action_not_found', 404);
  const user = { id: actor.userId, platform_role: actor.platformRole || null };
  const lt = await loadTaskFor(actor.userId, actor.platformRole, item.task_id, item.business_id);
  if (lt.fail) return lt.fail.http === 404 ? fail('action_not_found', 404) : lt.fail;
  const { task } = lt;
  if (!canPerform(task, actor.userId)) return fail('only_assignee', 403);
  const kind = KINDS[item.kind];
  if (!kind || !kind.enabled) return fail('kind_disabled', 400);
  if (kind.entity !== p.entityType) return fail('kind_mismatch', 400);
  // 같은 대상을 다시 보내면 멱등(no-op)
  if (item.linked_entity_type === p.entityType && item.linked_entity_id === Number(p.entityId)) return done({ item, task, unchanged: true });
  if (!['pending', 'active'].includes(item.status) || item.linked_entity_id) return fail('action_already_linked', 409);
  // 붙일 때 원본 읽기 권한 — 같은 워크스페이스 + 내가 볼 수 있는 대상만
  const ent = await loadEntity(p.entityType, p.entityId, item.business_id, user);
  if (!ent.row || !ent.visible) return fail('entity_not_found', 404);

  const before = { status: item.status, linked_entity_type: item.linked_entity_type, linked_entity_id: item.linked_entity_id };
  await sequelize.transaction(async (transaction) => {
    const patch = {
      linked_entity_type: p.entityType,
      linked_entity_id: ent.row.id,
      fulfilled_by: actor.userId,
      fulfilled_at: new Date(),
      fulfilled_round: task.review_round || 0,
      status: 'completed',
    };
    if (item.kind === 'doc') {
      // 임시저장 문서면 «작성 중», 발행되면 onPostPublished 가 completed 로 올린다
      if (ent.row.status === 'draft') patch.status = 'active';
      // 결과물 첨부에 자동으로 넣는다(Irene 결정 2) — 컨펌 제출 회차 박제(attachment_ids)에 저절로 포함된다.
      //   이미 사람이 붙여 둔 같은 문서면 새로 만들지 않는다(linked_attachment_id 는 비워 둔다 — 해제 때 남의 첨부를 지우지 않게).
      const made = await require('./taskAttachmentLink').linkPostsToTask(task, [ent.row], actor.userId, { context: 'task', transaction });
      patch.linked_attachment_id = made[0]?.att?.id || null;
    }
    await item.update(patch, { transaction });
  });
  audit(actor, 'task.action_fulfilled', item, { source: p.source || 'manual', before, entity_type: p.entityType, entity_id: ent.row.id, status: item.status });
  broadcast(task, actor.userId);
  return done({ item, task });
}

/** 해제 — 담당자만. 링크 칸 비움 · pending · 액션이 스스로 만든 첨부만 지운다. */
async function unlink(actor, { actionId, taskId }) {
  const lt = await loadTaskFor(actor.userId, actor.platformRole, taskId);
  if (lt.fail) return lt.fail;
  const { task } = lt;
  const item = await TaskActionItem.findOne({ where: { id: Number(actionId), task_id: task.id, business_id: task.business_id } });
  if (!item) return fail('action_not_found', 404);
  if (!canPerform(task, actor.userId)) return fail('only_assignee', 403);
  if (!item.linked_entity_id) return done({ item, task, unchanged: true });
  const before = { status: item.status, linked_entity_type: item.linked_entity_type, linked_entity_id: item.linked_entity_id };
  await sequelize.transaction(async (transaction) => {
    if (item.linked_attachment_id) {
      await TaskAttachment.destroy({ where: { id: item.linked_attachment_id, task_id: task.id, post_id: { [Op.ne]: null } }, transaction });
    }
    await item.update(clearedPatch(), { transaction });
  });
  audit(actor, 'task.action_unlinked', item, { before });
  broadcast(task, actor.userId);
  return done({ item, task });
}

function clearedPatch() {
  return {
    status: 'pending', linked_entity_type: null, linked_entity_id: null, linked_attachment_id: null,
    fulfilled_by: null, fulfilled_at: null, fulfilled_round: null,
  };
}

/** 문서가 draft → published 가 되는 순간 — active 액션을 completed 로. 첨부 이름도 발행 제목으로 맞춘다. */
async function onPostPublished(post, actorUserId = null) {
  try {
    if (!post || post.status === 'draft') return;
    const items = await TaskActionItem.findAll({
      where: { business_id: post.business_id, linked_entity_type: 'post', linked_entity_id: post.id, status: 'active' },
    });
    for (const item of items) {
      await item.update({ status: 'completed' });
      if (item.linked_attachment_id) {
        await TaskAttachment.update({ original_name: String(post.title || '(제목 없음)').slice(0, 500) }, { where: { id: item.linked_attachment_id, post_id: post.id } });
      }
      audit({ userId: actorUserId }, 'task.action_fulfilled', item, { source: 'publish', entity_type: 'post', entity_id: post.id, status: 'completed' });
      const task = await Task.findByPk(item.task_id);
      if (task) broadcast(task, actorUserId);
    }
  } catch (e) { console.warn('[taskActionItems.onPostPublished]', e.message); }
}

/**
 * 결과물 첨부에서 사람이 문서 첨부를 지우면 그 문서를 가리키는 액션은 pending 으로 — «완료인데 결과물에 없는» 거짓 상태를 남기지 않는다.
 *   액션이 만든 첨부든, 사람이 먼저 붙여 둔 같은 문서 첨부든 같다(그 문서가 결과물에서 빠졌다는 사실은 같다).
 */
async function onAttachmentDeleted(att, actorUserId = null) {
  try {
    if (!att) return;
    const or = [{ linked_attachment_id: att.id }];
    if (att.post_id && att.context === 'task') or.push({ linked_entity_type: 'post', linked_entity_id: att.post_id });
    const items = await TaskActionItem.findAll({ where: { task_id: att.task_id, business_id: att.business_id, [Op.or]: or } });
    if (!items.length) return;
    // 같은 문서가 결과물에 아직 남아 있으면(다른 자리 첨부) 되돌리지 않는다
    if (att.post_id) {
      const still = await TaskAttachment.findOne({ where: { task_id: att.task_id, post_id: att.post_id, context: 'task', id: { [Op.ne]: att.id } }, attributes: ['id'] });
      if (still) {
        for (const item of items) if (item.linked_attachment_id === att.id) await item.update({ linked_attachment_id: null });
        return;
      }
    }
    for (const item of items) {
      const before = { status: item.status, linked_entity_type: item.linked_entity_type, linked_entity_id: item.linked_entity_id };
      await item.update(clearedPatch());
      audit({ userId: actorUserId }, 'task.action_unlinked', item, { before, reason: 'attachment_deleted' });
    }
    const task = await Task.findByPk(att.task_id);
    if (task) broadcast(task, actorUserId);
  } catch (e) { console.warn('[taskActionItems.onAttachmentDeleted]', e.message); }
}

/** 대상 요약 — 보는 사람 기준. 행이 없으면 deleted, 못 보면 hidden. 제목을 복사해 두지 않고 매번 읽는다. */
async function targetSummary(item, user) {
  if (!item.linked_entity_type || !item.linked_entity_id) return null;
  const base = { type: item.linked_entity_type, id: item.linked_entity_id };
  if (item.linked_entity_type === 'post') {
    const row = await Post.findOne({ where: { id: item.linked_entity_id, business_id: item.business_id }, paranoid: false });
    if (!row || row.deleted_at) return { ...base, deleted: true };
    if (!(await require('./postAccess').canReadPost(user, row))) return { ...base, hidden: true };
    return { ...base, title: row.title, status: row.status, kind: row.kind };
  }
  if (item.linked_entity_type === 'calendar_event') {
    const ent = await loadEntity('calendar_event', item.linked_entity_id, item.business_id, user);
    if (!ent.row) return { ...base, deleted: true };
    if (!ent.visible) return { ...base, hidden: true };
    return { ...base, title: ent.row.title, start_at: ent.row.start_at, end_at: ent.row.end_at, all_day: !!ent.row.all_day };
  }
  return { ...base, hidden: true };
}

async function serializeList(task, user, scope) {
  const items = await TaskActionItem.findAll({
    where: { task_id: task.id, business_id: task.business_id },
    order: [['order_index', 'ASC'], ['id', 'ASC']],
  });
  const out = [];
  for (const it of items) {
    out.push({
      id: it.id, task_id: it.task_id, order_index: it.order_index, kind: it.kind, label: it.label, note: it.note, meta: it.meta,
      status: it.status, linked_entity_type: it.linked_entity_type, linked_entity_id: it.linked_entity_id,
      fulfilled_by: it.fulfilled_by, fulfilled_at: it.fulfilled_at, fulfilled_round: it.fulfilled_round,
      created_by: it.created_by, created_at: it.created_at,
      target: await targetSummary(it, user),
    });
  }
  return {
    items: out,
    can_edit: canEditList(task, user.id, scope),
    can_perform: canPerform(task, user.id),
    has_assignee: !!task.assignee_id,
    is_recurring_parent: !!task.recurrence_rule && !task.recurrence_parent_id,
    kinds: Object.entries(KINDS).filter(([, v]) => v.enabled).map(([k]) => k),
  };
}

/**
 * 대상 쪽 «연결된 업무» — 직렬화 하나. 액션 연결 ∪ 종류별 기존 연결. 보는 사람이 못 보는 업무는 제목도 id 도 내지 않는다.
 * @returns [{ id, title, status, project_id, via: 'action'|'attachment'|'event', attachment_id?, can_unlink? }]
 */
async function linkedTasksOf(entityType, entityId, user, businessId) {
  const bid = Number(businessId);
  const eid = Number(entityId);
  const via = new Map();   // task_id → via (action 우선)
  const attOf = new Map(); // task_id → 그 연결의 첨부 행(문서 쪽에서 해제할 때 쓴다 — 결과물(task) 칸 우선)
  const acts = await TaskActionItem.findAll({ where: { business_id: bid, linked_entity_type: entityType, linked_entity_id: eid }, attributes: ['task_id'] });
  for (const a of acts) via.set(a.task_id, 'action');
  if (entityType === 'post') {
    const atts = await TaskAttachment.findAll({ where: { business_id: bid, post_id: eid, context: { [Op.in]: ['task', 'description_attach'] } }, attributes: ['id', 'task_id', 'context', 'uploaded_by'], order: [['id', 'ASC']] });
    for (const a of atts) {
      if (!via.has(a.task_id)) via.set(a.task_id, 'attachment');
      const prev = attOf.get(a.task_id);
      if (!prev || (prev.context !== 'task' && a.context === 'task')) attOf.set(a.task_id, a);
    }
  } else if (entityType === 'calendar_event') {
    const ev = await CalendarEvent.findOne({ where: { id: eid, business_id: bid }, attributes: ['task_id'] });
    if (ev?.task_id && !via.has(ev.task_id)) via.set(ev.task_id, 'event');
  }
  if (!via.size) return [];
  const tasks = await Task.findAll({ where: { id: [...via.keys()], business_id: bid }, order: [['id', 'ASC']] });
  const scope = await getUserScope(user.id, bid, user.platform_role);
  const out = [];
  for (const t of tasks) {
    if (!(await canAccessTask(user.id, t, scope))) continue;
    const row = { id: t.id, title: t.title, status: t.status, project_id: t.project_id, via: via.get(t.id) };
    // 첨부로 걸린 것만 문서 쪽에서 뗄 수 있다(삭제 라우트와 같은 술어). 결과물 액션 연결은 업무 쪽 문으로만 푼다.
    const att = row.via === 'attachment' ? attOf.get(t.id) : null;
    if (att) {
      row.attachment_id = att.id;
      row.can_unlink = require('./taskAttachmentLink').canRemoveTaskAttachment(att, user.id, scope);
    }
    out.push(row);
  }
  return out;
}

/** 대상 화면이 처음 열릴 때 읽는 것. 주소에는 숫자 id 만 다닌다. */
async function handoff(user, actionId) {
  const item = await TaskActionItem.findByPk(Number(actionId));
  if (!item) return fail('action_not_found', 404);
  const lt = await loadTaskFor(user.id, user.platform_role, item.task_id, item.business_id);
  if (lt.fail) return fail('action_not_found', 404);
  const { task } = lt;
  const kind = KINDS[item.kind];
  let reason = null;
  if (!kind?.enabled) reason = 'kind_disabled';
  else if (!canPerform(task, user.id)) reason = task.assignee_id ? 'not_assignee' : 'no_assignee';
  else if (item.status !== 'pending') reason = 'not_pending';
  return done({
    action: { id: item.id, kind: item.kind, label: item.label, note: item.note, meta: item.meta, status: item.status },
    task: { id: task.id, title: task.title, due_date: task.due_date, start_date: task.start_date || null, project_id: task.project_id, business_id: task.business_id },
    can_perform: !reason,
    reason,
  });
}

/** 반복 회차 — 부모의 액션 목록을 내용만 복사(kind·label·note·meta·order_index). 연결·완료는 두고 온다. */
async function copyToOccurrence(parent, inst, { transaction } = {}) {
  const src = await TaskActionItem.findAll({ where: { task_id: parent.id, business_id: parent.business_id }, order: [['order_index', 'ASC'], ['id', 'ASC']], transaction });
  if (!src.length) return 0;
  await TaskActionItem.bulkCreate(src.map((a) => ({
    business_id: inst.business_id, task_id: inst.id, order_index: a.order_index, kind: a.kind, label: a.label,
    note: a.note, meta: a.meta, status: 'pending', created_by: a.created_by,
  })), { transaction });
  return src.length;
}

module.exports = {
  KINDS, MAX_PER_TASK, canEditList, canPerform, loadTaskFor,
  fulfill, unlink, onPostPublished, onAttachmentDeleted, linkedTasksOf, serializeList, handoff, copyToOccurrence,
  audit, broadcast,
};
