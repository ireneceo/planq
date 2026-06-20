// reportUnitSnapshot.js — 단위 보고서(ReportUnit) 자동 초안 빌더 (R2, 마스터설계 §4.2·§7.0)
//   scope = project / department. KPI 수치는 fetchProjectStats 단일 원천 재사용(P4).
//   주간/월간 period 경계 안에서 하이라이트·리스크·차기 계획·팀/멤버 롤업 집계.
const { Op } = require('sequelize');
const {
  Project, Task, User, ProjectMember, BusinessMember, Department, ProjectIssue, Post, Document,
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
const briefTask = (t) => ({ id: t.id, title: t.title, status: t.status, due_date: ymd(t.due_date), assignee_name: t.assignee?.name || null, workstream_id: t.workstream_id ?? null });
const displayName = (u, uid) => u?.name_localized?.ko || u?.name || `user ${uid}`;

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
    attributes: ['id', 'title', 'status', 'due_date', 'planned_week_start', 'assignee_id', 'workstream_id', 'completed_at'],
    include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false }],
  });
  const tp = tasks.map((t) => t.toJSON());

  const highlights = tp.filter((t) => t.status === 'completed' && inRange(t.completed_at, start, end)).map(briefTask).slice(0, 15);
  const risks = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed' && t.status !== 'canceled').map(briefTask).slice(0, 15);
  // 리뷰 M6 — 주간: 차주 정확 매치 / 월간: 익월(YYYY-MM) 내 계획 (planned_week_start 는 주 월요일이라 월 1일과 정확매치 불가)
  const inNext = (d) => { const v = ymd(d); if (!v) return false; return periodType === 'monthly' ? v.slice(0, 7) === nextStart.slice(0, 7) : v === nextStart; };
  const next = tp.filter((t) => inNext(t.planned_week_start) && t.status !== 'canceled').map(briefTask).slice(0, 15);

  // 팀 — 프로젝트 멤버별 active/완료
  const pms = await ProjectMember.findAll({ where: { project_id: project.id }, include: [{ model: User, attributes: ['id', 'name', 'name_localized'], required: false }] });
  const team = pms.map((pm) => {
    const mine = tp.filter((t) => t.assignee_id === pm.user_id && t.status !== 'canceled');
    return { user_id: pm.user_id, name: displayName(pm.User, pm.user_id), active: mine.filter((t) => t.status !== 'completed').length, completed: mine.filter((t) => t.status === 'completed').length };
  });

  return {
    schema_version: SCHEMA_VERSION, scope: 'project', ref_id: project.id,
    period: { type: periodType, start, end },
    subject: { id: project.id, name: project.name, status: project.status, start_date: ymd(project.start_date), end_date: ymd(project.end_date), owner_user_id: project.owner_user_id },
    kpi: {
      progress_percent: stats.progress_percent, progress_delta: stats.progress_delta,
      completed_tasks: stats.completed_tasks, total_tasks: stats.total_tasks,
      overdue_count: stats.overdue_count, open_issues: stats.open_issues, health: stats.health, d_day: stats.d_day,
      completed_in_period: highlights.length,
    },
    highlights, risks, next, team,
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

// ── 디스패처 ──
async function buildAutoSnapshot(businessId, scope, refId, periodType, periodStart) {
  if (scope === 'project') return buildProjectSnapshot(businessId, refId, periodType, periodStart);
  if (scope === 'department') return buildDepartmentSnapshot(businessId, refId, periodType, periodStart);
  return null;  // member 는 v1 에서 WeeklyReview 유지
}

module.exports = { buildAutoSnapshot, buildProjectSnapshot, buildDepartmentSnapshot, buildWorkspaceMembers, periodBounds, SCHEMA_VERSION };
