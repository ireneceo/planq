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

async function assertMenu(p, menu) {
  const { getMemberMenuLevels } = require('../../../middleware/menu_permission');
  const lv = await getMemberMenuLevels(p.businessId, p.userId);
  if (!lv || lv.role === 'owner' || lv.role === 'admin') return;
  if ((lv.menus[menu] || 'write') === 'none') throw err('PERMISSION_DENIED', `menu_hidden:${menu}`);
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
  const limit = Math.min(50, a.limit || 20);
  const { rows, count } = await Client.findAndCountAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'display_name', 'company_name', 'invite_email', 'phone', 'status', 'sales_stage', 'last_touch_at'],
    order: [['last_touch_at', 'DESC'], ['id', 'DESC']], limit,
  });
  return { items: rows.map(clientItem), total: count, truncated: count > rows.length };
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
  return {
    client: clientItem(c),
    summary: c.summary || null,
    open_tasks: tj.map(taskItem),
    recent_interactions: recent.map((r) => ({
      interaction_id: r.id, kind: r.kind, direction: r.direction, occurred_at: iso(r.occurred_at),
      title: r.title || null, summary: r.summary ? String(r.summary).slice(0, 500) : null,
    })),
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
  const limit = Math.min(50, a.limit || 20);
  const { rows, count } = await Project.findAndCountAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'name', 'status', 'client_company', 'start_date', 'end_date'],
    order: [['updated_at', 'DESC']], limit,
  });
  return { items: rows.map(projectItem), total: count, truncated: count > rows.length };
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
  return {
    project: { ...projectItem(pr), description: pr.description ? String(pr.description).slice(0, 2000) : null },
    open_tasks: tj.map(taskItem),
  };
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
    user_id: r.user_id, name: names.get(r.user_id) || r.user.name, role: r.role, email: r.user.email,
    is_me: r.user_id === p.userId,
  })).filter((m) => !q || (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q));
  const limit = Math.min(50, a.limit || 20);
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit };
}

module.exports = { searchClients, getClient, searchProjects, getProject, searchMembers };
