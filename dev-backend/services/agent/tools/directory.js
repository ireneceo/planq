// AI 에이전트 도구 — 고객·프로젝트·멤버 조회 (#439 M2-a, 설계 §6.3).
//
//   ★ 화이트리스트로만 내보낸다 — 금액(expected_amount·contract_amount·청구)·초대 토큰·사업자 정보는 고르지 않는다.
//     금액은 설계상 HIGH(외부 AI 표면에 두지 않는다). cue_context 의 스냅샷은 대표에게 청구 내역까지 실으므로 쓰지 않는다.
//   ★ 메뉴 Layer — 고객은 Q sales(qsale) 메뉴, 프로젝트·업무는 qtask. 화면에서 안 보이면 AI 도 못 본다.
//   ★ 범위는 토큰의 워크스페이스로만 — 모든 조회에 business_id: p.businessId.
const { Op } = require('sequelize');
const cfg = require('../../agent_oauth/config');
const { err } = require('../errors');
const { taskItem } = require('../serialize');

const escLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const iso = (v) => (v ? new Date(v).toISOString() : null);

// 메뉴 Layer 판정은 services/agent/menu 한 벌. 페이지 규약은 services/agent/page 한 벌(설계 M3 §4.0).
const { assertMenu } = require('../menu');
const { parsePage, pageOf, clip } = require('../page');
const NOTE_BODY_MAX = 2000;
const DESC_MAX = 8000;

/** 메뉴가 숨겨졌으면 null — 집계 칸(counts)이 «0» 이 아니라 «모름» 이 되게(빈 결과로 위장하지 않는다). */
async function menuOk(p, menu) {
  try { await assertMenu(p, menu, 'read'); return true; } catch { return false; }
}

const clientItem = (c) => ({
  client_id: c.id,
  name: c.display_name || c.company_name || null,
  company: c.company_name || null,
  email: c.invite_email || null,
  phone: c.phone || null,
  status: c.status,
  sales_stage: c.sales_stage || null,
  last_touch_at: iso(c.last_touch_at),
  url: `${cfg.APP_URL}/sale/${c.id}`,
});

const projectItem = (pr) => ({
  project_id: pr.id,
  name: pr.name,
  status: pr.status,
  client_company: pr.client_company || null,
  start_date: pr.start_date ? String(pr.start_date).slice(0, 10) : null,
  end_date: pr.end_date ? String(pr.end_date).slice(0, 10) : null,
  url: `${cfg.APP_URL}/projects/p/${pr.id}`,
});

// ── search_clients ─────────────────────────────────────────
async function searchClients(p, a) {
  await assertMenu(p, 'qsale');
  const { Client } = require('../../../models');
  const q = String(a.query || '').normalize('NFC').trim();
  const conds = [{ business_id: p.businessId }];
  if (!a.include_archived) conds.push({ status: { [Op.ne]: 'archived' } });
  if (q) {
    const like = `%${escLike(q)}%`;
    conds.push({ [Op.or]: [{ display_name: { [Op.like]: like } }, { company_name: { [Op.like]: like } }, { invite_email: { [Op.like]: like } }] });
  }
  const pg = parsePage(a);
  const { rows, count } = await Client.findAndCountAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'display_name', 'company_name', 'invite_email', 'phone', 'status', 'sales_stage', 'last_touch_at'],
    order: [['last_touch_at', 'DESC'], ['id', 'DESC']], limit: pg.pageSize, offset: pg.offset,
  });
  return pageOf(rows.map(clientItem), count, pg);
}

// ── get_client ─────────────────────────────────────────────
async function getClient(p, a) {
  await assertMenu(p, 'qsale');
  const { Client, Task, ClientInteraction, User, Project } = require('../../../models');
  const c = await Client.findOne({ where: { id: a.client_id, business_id: p.businessId } });
  if (!c) throw err('NOT_FOUND', 'client_not_found');
  const { getUserScope, taskListWhere } = require('../../../middleware/access_scope');
  const scope = await getUserScope(p.userId, p.businessId, p.platformRole);
  const base = await taskListWhere(p.userId, p.businessId, scope);
  const tasks = base ? await Task.findAll({
    where: { [Op.and]: [base, { client_id: c.id }, { status: { [Op.notIn]: ['completed', 'canceled'] } }] },
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }, { model: Project, attributes: ['id', 'name'], required: false }],
    order: [['due_date', 'ASC']], limit: 10,
  }) : [];
  const recent = await ClientInteraction.findAll({
    where: { business_id: p.businessId, client_id: c.id, deleted_at: null },
    attributes: ['id', 'kind', 'direction', 'occurred_at', 'title', 'summary'],
    order: [['occurred_at', 'DESC']], limit: 5,
  });
  const { applyMemberDisplayName } = require('../../displayName');
  const tj = tasks.map((t) => t.toJSON());
  await applyMemberDisplayName(tj, p.businessId, ['assignee']);
  // M3-a(설계 §4.3) — 연결된 프로젝트(project_clients 조인만 — 이름 추측 없음) · 집계 · 연락처. 금액 칸은 여전히 고르지 않는다.
  const { ProjectClient, CalendarEvent, CalendarEventAttendee } = require('../../../models');
  const pcs = await ProjectClient.findAll({
    where: { client_id: c.id },
    include: [{ model: Project, attributes: ['id', 'name', 'status', 'business_id'], where: { business_id: p.businessId }, required: true }],
    limit: 50,
  });
  const openCount = base ? await Task.count({ where: { [Op.and]: [base, { client_id: c.id }, { status: { [Op.notIn]: ['completed', 'canceled'] } }] } }) : 0;
  const interactionCount = await ClientInteraction.count({ where: { business_id: p.businessId, client_id: c.id, deleted_at: null } });
  let eventCount = null;
  if (await menuOk(p, 'qcalendar')) {
    const { calendarListWhere } = require('../../../middleware/access_scope');
    const cbase = await calendarListWhere(p.userId, p.businessId, scope);
    const att = await CalendarEventAttendee.findAll({ where: { client_id: c.id }, attributes: ['event_id'] });
    const evIds = [...new Set(att.map((x) => x.event_id))];
    eventCount = cbase && evIds.length ? await CalendarEvent.count({ where: { [Op.and]: [cbase, { business_id: p.businessId }, { id: { [Op.in]: evIds } }] } }) : 0;
  }
  const { mailThreadCount } = require('./mail');
  return {
    client: clientItem(c),
    summary: c.summary || null,
    contacts: {
      invite_email: c.invite_email || null,
      billing_contact_email: c.billing_contact_email || null,
      phone: c.phone || null,
    },
    projects: pcs.map((x) => ({ project_id: x.Project.id, name: x.Project.name, status: x.Project.status, url: `${cfg.APP_URL}/projects/p/${x.Project.id}` })),
    counts: {
      open_tasks: openCount,
      interactions: interactionCount,
      mail_threads: await mailThreadCount(p, { client_id: c.id }),
      events: eventCount,
    },
    open_tasks: tj.map(taskItem),
    recent_interactions: recent.map((r) => ({
      interaction_id: r.id, kind: r.kind, direction: r.direction, occurred_at: iso(r.occurred_at),
      title: r.title || null, summary: r.summary ? String(r.summary).slice(0, 500) : null,
    })),
    note: 'Billing amounts are not available through this connection.',
  };
}

// ── search_projects / get_project ──────────────────────────
async function searchProjects(p, a) {
  await assertMenu(p, 'qtask');
  const { Project } = require('../../../models');
  const q = String(a.query || '').normalize('NFC').trim();
  const conds = [{ business_id: p.businessId }];
  if (q) conds.push({ [Op.or]: [{ name: { [Op.like]: `%${escLike(q)}%` } }, { client_company: { [Op.like]: `%${escLike(q)}%` } }] });
  if (a.status) conds.push({ status: a.status });
  const pg = parsePage(a);
  const { rows, count } = await Project.findAndCountAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'name', 'status', 'client_company', 'start_date', 'end_date'],
    order: [['updated_at', 'DESC'], ['id', 'DESC']], limit: pg.pageSize, offset: pg.offset,
  });
  return pageOf(rows.map(projectItem), count, pg);
}

async function getProject(p, a) {
  await assertMenu(p, 'qtask');
  const { Project, Task, User } = require('../../../models');
  const pr = await Project.findOne({ where: { id: a.project_id, business_id: p.businessId } });
  if (!pr) throw err('NOT_FOUND', 'project_not_found');
  const { getUserScope, canAccessProject, taskListWhere } = require('../../../middleware/access_scope');
  const scope = await getUserScope(p.userId, p.businessId, p.platformRole);
  if (!(await canAccessProject(p.userId, pr, scope))) throw err('PERMISSION_DENIED', 'forbidden');
  const base = await taskListWhere(p.userId, p.businessId, scope);
  const open = base ? await Task.findAll({
    where: { [Op.and]: [base, { project_id: pr.id }, { status: { [Op.notIn]: ['completed', 'canceled'] } }] },
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name'], required: false }],
    order: [['due_date', 'ASC']], limit: 20,
  }) : [];
  const { applyMemberDisplayName } = require('../../displayName');
  const tj = open.map((t) => t.toJSON());
  await applyMemberDisplayName(tj, p.businessId, ['assignee']);
  // M3-a(설계 §4.3) — 고객(project_clients 조인만) · 거래 단계(금액 없음) · 집계(각 자료의 권한 술어로 센 수) · 최근 메모 · 다가오는 일정.
  const { ProjectClient, ProjectStage, ProjectNote, CalendarEvent, Post, File, Client } = require('../../../models');
  const pcs = await ProjectClient.findAll({
    where: { project_id: pr.id },
    include: [{ model: Client, attributes: ['id', 'display_name', 'company_name', 'invite_email', 'business_id'], where: { business_id: p.businessId }, required: true }],
    limit: 50,
  });
  const stages = await ProjectStage.findAll({ where: { project_id: pr.id }, attributes: ['kind', 'label', 'status', 'expected_due_date', 'order_index'], order: [['order_index', 'ASC']] });
  const openCount = base ? await Task.count({ where: { [Op.and]: [base, { project_id: pr.id }, { status: { [Op.notIn]: ['completed', 'canceled'] } }] } }) : 0;
  const noteWhere = projectNoteWhere(p, pr.id);
  const noteCount = await ProjectNote.count({ where: noteWhere });
  const recentNotes = await loadProjectNotes(p, noteWhere, 3, 0);
  let upcoming = null;
  let eventsUpcoming = null;
  if (await menuOk(p, 'qcalendar')) {
    const { calendarListWhere } = require('../../../middleware/access_scope');
    const cbase = await calendarListWhere(p.userId, p.businessId, scope);
    if (cbase) {
      const ew = { [Op.and]: [cbase, { business_id: p.businessId }, { project_id: pr.id }, { start_at: { [Op.gte]: new Date() } }] };
      eventsUpcoming = await CalendarEvent.count({ where: ew });
      const evs = await CalendarEvent.findAll({ where: ew, attributes: ['id', 'title', 'start_at', 'end_at', 'all_day'], order: [['start_at', 'ASC']], limit: 5 });
      upcoming = evs.map((e) => ({ event_id: e.id, title: e.title, start_at: iso(e.start_at), end_at: iso(e.end_at), all_day: !!e.all_day, url: `${cfg.APP_URL}/calendar?event=${e.id}` }));
    } else { eventsUpcoming = 0; upcoming = []; }
  }
  const { postListWhereByLevel, fileListWhereByLevel } = require('../../../middleware/access_scope');
  const documents = (await menuOk(p, 'qdocs'))
    ? await Post.count({ where: { [Op.and]: [postListWhereByLevel(scope), { business_id: p.businessId }, { project_id: pr.id }] } }) : null;
  const files = (await menuOk(p, 'qfile'))
    ? await File.count({ where: { [Op.and]: [fileListWhereByLevel(scope), { business_id: p.businessId }, { project_id: pr.id }, { deleted_at: null }] } }) : null;
  const { mailThreadCount } = require('./mail');
  const d = clip(pr.description, DESC_MAX);
  return {
    project: {
      ...projectItem(pr),
      description: pr.description ? d.text : null,
      description_total_chars: d.total,
      truncated_fields: d.cut ? ['description'] : [],
    },
    clients: pcs.map((x) => ({ client_id: x.Client.id, name: x.Client.display_name || x.Client.company_name || null, contact_email: x.contact_email || x.Client.invite_email || null, url: `${cfg.APP_URL}/sale/${x.Client.id}` })),
    stages: stages.map((st) => ({ kind: st.kind, label: st.label || null, status: st.status, expected_due_date: st.expected_due_date ? String(st.expected_due_date).slice(0, 10) : null })),
    counts: {
      open_tasks: openCount,
      notes: noteCount,
      events_upcoming: eventsUpcoming,
      files,
      documents,
      mail_threads: await mailThreadCount(p, { project_id: pr.id }),
    },
    open_tasks: tj.map(taskItem),
    open_tasks_has_more: openCount > tj.length,
    recent_notes: recentNotes,
    notes_has_more: noteCount > recentNotes.length,
    upcoming_events: upcoming,
  };
}

// ── 프로젝트 메모 — 사람 화면(GET /api/projects/:id/notes, 멤버 분기)과 **같은 술어**: 팀 공개(internal) + 내 개인(personal) ──
//   개인 메모는 쓴 사람만 — 외부로 나가는 표면이라 화면보다 넓히지 않는다(get_task_notes 와 같은 규칙).
function projectNoteWhere(p, projectId, visibility) {
  const conds = [{ project_id: projectId }, { [Op.or]: [{ visibility: 'internal' }, { visibility: 'personal', author_user_id: p.userId }] }];
  if (visibility === 'internal') conds.push({ visibility: 'internal' });
  if (visibility === 'personal') conds.push({ visibility: 'personal' });
  return { [Op.and]: conds };
}

async function loadProjectNotes(p, where, limit, offset) {
  const { ProjectNote, User } = require('../../../models');
  const { applyMemberDisplayName } = require('../../displayName');
  const rows = await ProjectNote.findAll({
    where, include: [{ model: User, as: 'author', attributes: ['id', 'name'], required: false }],
    order: [['created_at', 'DESC'], ['id', 'DESC']], limit, offset,
  });
  const js = rows.map((r) => r.toJSON());
  await applyMemberDisplayName(js, p.businessId, ['author']);
  return js.map((n) => {
    const b = clip(n.body, NOTE_BODY_MAX);
    let source = null;
    if (n.email_thread_id) source = { kind: 'mail', thread_id: n.email_thread_id, url: `${cfg.APP_URL}/mail?thread=${n.email_thread_id}` };
    else if (n.conversation_id) source = { kind: 'chat', conversation_id: n.conversation_id, url: `${cfg.APP_URL}/talk?conv=${n.conversation_id}` };
    return {
      note_id: n.id,
      author: n.author ? { user_id: n.author.id, name: n.author.display_name || n.author.name || null } : null,
      visibility: n.visibility,
      created_at: iso(n.created_at || n.createdAt),
      body: b.text,
      body_total_chars: b.total,
      truncated_fields: b.cut ? ['body'] : [],
      source,
    };
  });
}

async function findProject(p, projectId) {
  const { Project } = require('../../../models');
  const pr = await Project.findOne({ where: { id: projectId, business_id: p.businessId } });
  if (!pr) throw err('NOT_FOUND', 'project_not_found');
  const { getUserScope, canAccessProject } = require('../../../middleware/access_scope');
  const scope = await getUserScope(p.userId, p.businessId, p.platformRole);
  if (!(await canAccessProject(p.userId, pr, scope))) throw err('PERMISSION_DENIED', 'forbidden');
  return { pr, scope };
}

// ── list_project_notes ─────────────────────────────────────
async function listProjectNotes(p, a) {
  await assertMenu(p, 'qtask', 'read');
  const { pr } = await findProject(p, a.project_id);
  const { ProjectNote } = require('../../../models');
  const where = projectNoteWhere(p, pr.id, a.visibility);
  const pg = parsePage(a);
  const total = await ProjectNote.count({ where });
  const items = await loadProjectNotes(p, where, pg.pageSize, pg.offset);
  return { project: { project_id: pr.id, name: pr.name, url: `${cfg.APP_URL}/projects/p/${pr.id}` }, ...pageOf(items, total, pg) };
}

// ── list_client_interactions ───────────────────────────────
async function listClientInteractions(p, a) {
  await assertMenu(p, 'qsale', 'read');
  const { Client, ClientInteraction, Project, User } = require('../../../models');
  const c = await Client.findOne({ where: { id: a.client_id, business_id: p.businessId }, attributes: ['id', 'display_name', 'company_name'] });
  if (!c) throw err('NOT_FOUND', 'client_not_found');
  const conds = [{ business_id: p.businessId }, { client_id: c.id }, { deleted_at: null }];
  if (a.kind) conds.push({ kind: a.kind });
  if (a.project_id) conds.push({ project_id: a.project_id });
  for (const [k, op] of [['since', Op.gte], ['until', Op.lte]]) {
    if (!a[k]) continue;
    const d = new Date(String(a[k]));
    if (Number.isNaN(d.getTime())) throw err('VALIDATION_ERROR', 'invalid_datetime', { fields: { [k]: a[k] } });
    conds.push({ occurred_at: { [op]: d } });
  }
  const pg = parsePage(a);
  const { rows, count } = await ClientInteraction.findAndCountAll({
    where: { [Op.and]: conds },
    include: [{ model: User, as: 'creator', attributes: ['id', 'name'], required: false }],
    order: [['occurred_at', 'DESC'], ['id', 'DESC']], limit: pg.pageSize, offset: pg.offset, distinct: true,
  });
  const { applyMemberDisplayName } = require('../../displayName');
  const js = rows.map((r) => r.toJSON());
  await applyMemberDisplayName(js, p.businessId, ['creator']);
  // 상담 ↔ 프로젝트는 연관이 선언돼 있지 않다 — 이 워크스페이스 프로젝트만 이름을 붙인다.
  const pids = [...new Set(js.map((r) => r.project_id).filter(Boolean))];
  const prMap = new Map(pids.length ? (await Project.findAll({ where: { id: pids, business_id: p.businessId }, attributes: ['id', 'name'] })).map((x) => [x.id, x]) : []);
  for (const r of js) r.Project = prMap.get(r.project_id) || null;
  const items = js.map((r) => {
    const b = clip(r.body, NOTE_BODY_MAX);
    return {
      interaction_id: r.id,
      kind: r.kind,
      direction: r.direction || null,
      occurred_at: iso(r.occurred_at),
      title: r.title || null,
      body: r.body ? b.text : null,
      body_total_chars: b.total,
      truncated_fields: b.cut ? ['body'] : [],
      summary: r.summary || null,
      key_points: Array.isArray(r.key_points) ? r.key_points : (r.key_points || null),
      project: r.Project ? { project_id: r.Project.id, name: r.Project.name } : null,
      source: { kind: r.source_kind || r.origin || null, qnote_session_id: r.qnote_session_id || null },
      author: r.creator ? { user_id: r.creator.id, name: r.creator.display_name || r.creator.name || null } : null,
    };
  });
  return { client: { client_id: c.id, name: c.display_name || c.company_name || null, url: `${cfg.APP_URL}/sale/${c.id}` }, ...pageOf(items, count, pg) };
}

// ── search_members — 담당자를 고를 때(create_task.assignee_user_id 의 재료) ──
async function searchMembers(p, a) {
  const { BusinessMember, User } = require('../../../models');
  const { getMemberNameMap } = require('../../displayName');
  const rows = await BusinessMember.findAll({
    where: { business_id: p.businessId, removed_at: null, role: ['owner', 'admin', 'member'] },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'is_ai'], required: true }],
  });
  const people = rows.filter((r) => r.user && !r.user.is_ai);
  const names = await getMemberNameMap(p.businessId, people.map((r) => r.user_id));
  const q = String(a.query || '').normalize('NFC').trim().toLowerCase();
  const items = people.map((r) => ({
    user_id: r.user_id, name: names.get(r.user_id)?.name || r.user.name, role: r.role, email: r.user.email,
    is_me: r.user_id === p.userId,
  })).filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q));
  const pg = parsePage(a);
  return pageOf(items.slice(pg.offset, pg.offset + pg.pageSize), items.length, pg);
}

module.exports = { searchClients, getClient, searchProjects, getProject, searchMembers, listProjectNotes, listClientInteractions };
