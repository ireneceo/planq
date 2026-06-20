// reportUnitSnapshot.js — 단위 보고서(ReportUnit) 자동 초안 빌더 (R2, 마스터설계 §4.2·§7.0)
//   scope = project / department. KPI 수치는 fetchProjectStats 단일 원천 재사용(P4).
//   주간/월간 period 경계 안에서 하이라이트·리스크·차기 계획·팀/멤버 롤업 집계.
const { Op } = require('sequelize');
const {
  Project, Task, User, ProjectMember, BusinessMember, Department, ProjectIssue, Post, Document,
  ProjectWorkstream, ProjectClient,
} = require('../models');
const { fetchProjectStats } = require('./weeklyReviewSnapshot');
const { todayInTz, mondayOfDateStr, addDaysStr } = require('../utils/datetime');

const SCHEMA_VERSION = 1;
// DATEONLY 는 Date 객체로 올 수 있음(memory feedback_recurring_billing_latent_bugs) — Date/문자열 모두 안전 처리.
const ymd = (d) => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

// 기간 경계 — 주간(월~일) / 월간(1일~말일)
function periodBounds(periodType, periodStart) {
  const start = ymd(periodStart);
  if (periodType === 'monthly') {
    const d = new Date(`${start}T00:00:00Z`);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { start, end: last.toISOString().slice(0, 10), nextStart: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10) };
  }
  // weekly
  const monday = mondayOfDateStr(start);
  return { start: monday, end: addDaysStr(monday, 6), nextStart: addDaysStr(monday, 7) };
}

const inRange = (d, start, end) => { const v = ymd(d); return v != null && v >= start && v <= end; };
const briefTask = (t) => ({ id: t.id, title: t.title, status: t.status, due_date: ymd(t.due_date), assignee_name: t.assignee?.name || null, progress_percent: Number(t.progress_percent) || 0, workstream_id: t.workstream_id ?? null, project_name: t.Project?.name || null });
const displayName = (u, uid) => u?.name_localized?.ko || u?.name || `user ${uid}`;

// 산출물 (발행 post + document)
async function fetchDeliverables(projectId) {
  const [posts, docs] = await Promise.all([
    Post.findAll({ where: { project_id: projectId, status: 'published' }, attributes: ['id', 'title', 'category', 'created_at'], order: [['created_at', 'DESC']], limit: 12 }),
    Document.findAll({ where: { project_id: projectId }, attributes: ['id', 'title', 'kind', 'created_at'], order: [['created_at', 'DESC']], limit: 12 }),
  ]);
  return [
    ...posts.map((p) => ({ kind: 'post', id: p.id, title: p.title, link: `/projects/p/${projectId}?tab=docs&post=${p.id}` })),
    ...docs.map((d) => ({ kind: 'document', id: d.id, title: d.title, link: `/documents/${d.id}` })),
  ].slice(0, 12);
}

// ── 프로젝트 단위 ──
async function buildProjectSnapshot(businessId, projectId, periodType, periodStart) {
  const project = await Project.findOne({ where: { id: projectId, business_id: businessId } });
  if (!project) return null;
  const { start, end, nextStart } = periodBounds(periodType, periodStart);
  const today = todayInTz('Asia/Seoul');

  const stats = (await fetchProjectStats(businessId, [project.id], mondayOfDateStr(start), true))[0] || {
    progress_percent: 0, progress_delta: 0, completed_tasks: 0, total_tasks: 0, overdue_count: 0, open_issues: 0, d_day: null, health: 'yellow',
  };

  const tasks = await Task.findAll({
    where: { project_id: project.id },
    attributes: ['id', 'title', 'status', 'due_date', 'planned_week_start', 'progress_percent', 'assignee_id', 'workstream_id', 'completed_at'],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
  });
  const tp = tasks.map((t) => t.toJSON());

  const highlights = tp.filter((t) => t.status === 'completed' && inRange(t.completed_at, start, end)).map(briefTask).slice(0, 20);
  const in_progress = tp.filter((t) => t.status === 'in_progress' || t.status === 'reviewing').map(briefTask).slice(0, 20);
  const risks = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed' && t.status !== 'canceled').map(briefTask).slice(0, 20);
  const blockers = tp.filter((t) => t.status === 'waiting' || t.status === 'revision_requested').map(briefTask).slice(0, 15);
  // 리뷰 M6 — 주간: 차주 정확 매치 / 월간: 익월(YYYY-MM) 내 계획
  const inNext = (d) => { const v = ymd(d); if (!v) return false; return periodType === 'monthly' ? v.slice(0, 7) === nextStart.slice(0, 7) : v === nextStart; };
  const next = tp.filter((t) => inNext(t.planned_week_start) && t.status !== 'canceled').map(briefTask).slice(0, 20);

  // 워크스트림(추진과제) 진행 — MECE 한 줄
  const wsRows = await ProjectWorkstream.findAll({ where: { project_id: project.id }, order: [['order_index', 'ASC'], ['id', 'ASC']] });
  const workstreams = wsRows.map((w) => {
    const mine = tp.filter((t) => t.workstream_id === w.id && t.status !== 'canceled');
    const total = mine.length;
    const prog = total === 0 ? 0 : Math.round(mine.reduce((s, t) => s + (t.status === 'completed' ? 100 : (Number(t.progress_percent) || 0)), 0) / total);
    return { id: w.id, title: w.title, color: w.color, total, progress_percent: prog };
  });

  // 이슈 (project_issues)
  const issueRows = await ProjectIssue.findAll({ where: { project_id: project.id }, attributes: ['id', 'body', 'created_at'], order: [['created_at', 'DESC']], limit: 12 });
  const issues = issueRows.map((i) => ({ id: i.id, body: i.body }));

  // 산출물
  const deliverables = await fetchDeliverables(project.id);

  // 팀·이해관계자 — 프로젝트 멤버 + 참여 고객
  const [pms, clients] = await Promise.all([
    ProjectMember.findAll({ where: { project_id: project.id }, include: [{ model: User, attributes: ['id', 'name', 'name_localized'], required: false }] }),
    ProjectClient.findAll({ where: { project_id: project.id }, attributes: ['id', 'contact_name'] }).catch(() => []),
  ]);
  const team = pms.map((pm) => {
    const mine = tp.filter((t) => t.assignee_id === pm.user_id && t.status !== 'canceled');
    return { user_id: pm.user_id, name: displayName(pm.User, pm.user_id), active: mine.filter((t) => t.status !== 'completed').length, completed: mine.filter((t) => t.status === 'completed').length };
  });
  const stakeholders = (clients || []).map((c) => ({ id: c.id, name: c.contact_name || '고객' }));

  return {
    schema_version: SCHEMA_VERSION, scope: 'project', ref_id: project.id,
    period: { type: periodType, start, end },
    subject: { id: project.id, name: project.name, status: project.status, start_date: ymd(project.start_date), end_date: ymd(project.end_date), owner_user_id: project.owner_user_id },
    strategy: { context: project.strategy_context, key_question: project.strategy_key_question, goal: project.strategy_goal, governing_thought: project.strategy_governing_thought, approach: project.strategy_approach },
    kpi: {
      progress_percent: stats.progress_percent, progress_delta: stats.progress_delta,
      completed_tasks: stats.completed_tasks, total_tasks: stats.total_tasks,
      in_progress_count: in_progress.length,
      overdue_count: stats.overdue_count, open_issues: issues.length, health: stats.health, d_day: stats.d_day,
      completed_in_period: highlights.length,
    },
    workstreams, highlights, in_progress, risks, blockers, issues, deliverables, next, team, stakeholders,
  };
}

// ── 개인(멤버) 단위 — 나의 보고 / 개별 보고 ──
async function buildMemberSnapshot(businessId, userId, periodType, periodStart) {
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId },
    include: [
      { model: User, as: 'user', attributes: ['id', 'name', 'name_localized'], required: false },
      { model: Department, as: 'department', attributes: ['id', 'name'], required: false },
    ],
  });
  if (!bm) return null;
  const { start, end, nextStart } = periodBounds(periodType, periodStart);
  const today = todayInTz('Asia/Seoul');

  const tasks = await Task.findAll({
    where: { business_id: businessId, assignee_id: userId, status: { [Op.ne]: 'canceled' } },
    attributes: ['id', 'title', 'status', 'due_date', 'planned_week_start', 'progress_percent', 'workstream_id', 'completed_at', 'project_id'],
    include: [{ model: Project, attributes: ['id', 'name'], required: false }],
  });
  const tp = tasks.map((t) => t.toJSON());

  const highlights = tp.filter((t) => t.status === 'completed' && inRange(t.completed_at, start, end)).map(briefTask).slice(0, 20);
  const in_progress = tp.filter((t) => t.status === 'in_progress' || t.status === 'reviewing').map(briefTask).slice(0, 20);
  const risks = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed').map(briefTask).slice(0, 20);
  const blockers = tp.filter((t) => t.status === 'waiting' || t.status === 'revision_requested').map(briefTask).slice(0, 15);
  const inNext = (d) => { const v = ymd(d); if (!v) return false; return periodType === 'monthly' ? v.slice(0, 7) === nextStart.slice(0, 7) : v === nextStart; };
  const next = tp.filter((t) => inNext(t.planned_week_start)).map(briefTask).slice(0, 20);

  const completed = highlights.length;
  const total = tp.length;
  const overdue = risks.length;

  return {
    schema_version: SCHEMA_VERSION, scope: 'member', ref_id: userId,
    period: { type: periodType, start, end },
    subject: { user_id: userId, name: bm.name || displayName(bm.user, userId), department: bm.department?.name || null },
    kpi: { total_tasks: total, completed_tasks: completed, in_progress_count: in_progress.length, overdue_count: overdue, completed_in_period: completed },
    highlights, in_progress, risks, blockers, next,
  };
}

// ── 부서 단위 ──
async function buildDepartmentSnapshot(businessId, departmentId, periodType, periodStart) {
  const dept = await Department.findOne({ where: { id: departmentId, business_id: businessId } });
  if (!dept) return null;
  const { start, end } = periodBounds(periodType, periodStart);
  const today = todayInTz('Asia/Seoul');

  const members = await BusinessMember.findAll({
    where: { business_id: businessId, department_id: dept.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'name_localized'], required: false }],
  });
  const memberIds = members.map((m) => m.user_id).filter(Boolean);

  let tp = [];
  if (memberIds.length) {
    const tasks = await Task.findAll({
      where: { business_id: businessId, assignee_id: { [Op.in]: memberIds }, status: { [Op.ne]: 'canceled' } },
      attributes: ['id', 'title', 'status', 'due_date', 'progress_percent', 'assignee_id', 'workstream_id', 'completed_at'],
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
    });
    tp = tasks.map((t) => t.toJSON());
  }

  const total = tp.length;
  const completed = tp.filter((t) => t.status === 'completed').length;
  const overdue = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed').length;
  const progress = total === 0 ? 0 : Math.round(tp.reduce((s, t) => s + (t.status === 'completed' ? 100 : (Number(t.progress_percent) || 0)), 0) / total);
  const highlights = tp.filter((t) => t.status === 'completed' && inRange(t.completed_at, start, end)).map(briefTask).slice(0, 20);
  const risks = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed').map(briefTask).slice(0, 20);

  const memberRollup = members.map((m) => {
    const mine = tp.filter((t) => t.assignee_id === m.user_id);
    return {
      user_id: m.user_id, name: m.name || displayName(m.user, m.user_id),
      active: mine.filter((t) => t.status !== 'completed').length,
      completed: mine.filter((t) => t.status === 'completed').length,
      overdue: mine.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed').length,
      completed_in_period: mine.filter((t) => t.status === 'completed' && inRange(t.completed_at, start, end)).length,
    };
  });

  return {
    schema_version: SCHEMA_VERSION, scope: 'department', ref_id: dept.id,
    period: { type: periodType, start, end },
    subject: { id: dept.id, name: dept.name, lead_user_id: dept.lead_user_id, member_count: members.length },
    kpi: { total_tasks: total, completed_tasks: completed, overdue_count: overdue, progress_percent: progress, completed_in_period: highlights.length },
    members: memberRollup, highlights, risks,
  };
}

// ── 워크스페이스 멤버 차원 롤업 (R3' 통합보고서 멤버별 섹션) ──
async function buildWorkspaceMembers(businessId, periodType, periodStart) {
  const { start, end } = periodBounds(periodType, periodStart);
  const today = todayInTz('Asia/Seoul');
  const members = await BusinessMember.findAll({
    where: { business_id: businessId, role: { [Op.ne]: 'ai' } },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'name_localized'], required: false }],
  });
  const ids = members.map((m) => m.user_id).filter(Boolean);
  let tp = [];
  if (ids.length) {
    const tasks = await Task.findAll({
      where: { business_id: businessId, assignee_id: { [Op.in]: ids }, status: { [Op.ne]: 'canceled' } },
      attributes: ['id', 'status', 'due_date', 'progress_percent', 'assignee_id', 'completed_at'],
    });
    tp = tasks.map((t) => t.toJSON());
  }
  return members.map((m) => {
    const mine = tp.filter((t) => t.assignee_id === m.user_id);
    return {
      user_id: m.user_id, name: m.name || displayName(m.user, m.user_id),
      total: mine.length,
      active: mine.filter((t) => t.status !== 'completed').length,
      completed: mine.filter((t) => t.status === 'completed').length,
      overdue: mine.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed').length,
      completed_in_period: mine.filter((t) => t.status === 'completed' && inRange(t.completed_at, start, end)).length,
    };
  });
}

// ── 디스패처 ── (부서 제거 — 피드백: 부서 차원 없앰. member 통일)
async function buildAutoSnapshot(businessId, scope, refId, periodType, periodStart) {
  if (scope === 'project') return buildProjectSnapshot(businessId, refId, periodType, periodStart);
  if (scope === 'member') return buildMemberSnapshot(businessId, refId, periodType, periodStart);
  return null;
}

module.exports = { buildAutoSnapshot, buildProjectSnapshot, buildMemberSnapshot, buildWorkspaceMembers, periodBounds, SCHEMA_VERSION };
