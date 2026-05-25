// weeklyReviewSnapshot.js — 주간 보고 스냅샷 빌드 (사이클 N+18 확장)
//
// 개인본:    buildSnapshot(userId, businessId, monday, friday)
//   → tasks / summary / burndown
//   + projects / issues / risks / blockers / next_week_focus / key_completions
//
// 통합본:    buildWorkspaceSnapshot(businessId, monday)
//   → schema_version, period, kpi (delta), highlights, risks, blockers, issues,
//     next_week_focus, portfolio (health), member_utilization, team_highlights,
//     decisions_required
//
// 데이터 산출 룰:
//   - overdue:           due_date < monday AND status NOT IN (completed,canceled)
//   - stalled:           in_progress AND TaskDailyProgress 7일+ 변화 없음
//   - due_soon_low_prog: due_date BETWEEN today AND today+3 AND progress < 50
//   - blockers:          status IN (waiting, revision_requested) + TaskStatusHistory 로 since
//   - portfolio.health:  green/yellow/red 룰 (§B.3.5)
//   - member util:       capacity vs Σ TaskDailyProgress.actual_hours (해당 주차)

const { Op } = require('sequelize');
const {
  Task, Project, TaskDailyProgress, BusinessMember, ProjectIssue,
  TaskStatusHistory, TaskComment, BusinessWeeklyReport, WeeklyReview,
  User, ProjectMember,
} = require('../models');

// ─────────────────────────────────────────────────────────────
// 날짜 유틸
// ─────────────────────────────────────────────────────────────
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fridayOf(mondayStr) { return addDaysStr(mondayStr, 4); }
function sundayOf(mondayStr) { return addDaysStr(mondayStr, 6); }
function prevMonday(mondayStr) { return addDaysStr(mondayStr, -7); }
function daysBetween(a, b) {
  const da = new Date(a), db = new Date(b);
  return Math.round((db - da) / 86400000);
}

// 이름 추출 (BusinessMember.name → User.display_name → User.name)
function pickMemberName(user, member) {
  return member?.name || user?.name || '—';
}

// ─────────────────────────────────────────────────────────────
// 개인본 (기존 + 확장)
// ─────────────────────────────────────────────────────────────
async function buildSnapshot(userId, businessId, weekStart) {
  const monday = weekStart;
  const friday = fridayOf(monday);
  const sunday = sundayOf(monday);

  // 1) 본인 이번 주 task (기존 로직 유지)
  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      assignee_id: userId,
      [Op.or]: [
        { planned_week_start: monday },
        { start_date: { [Op.between]: [monday, friday] } },
        { due_date: { [Op.between]: [monday, friday] } },
        { due_date: { [Op.lt]: monday }, status: { [Op.notIn]: ['completed', 'canceled'] } },
        { completed_at: { [Op.between]: [`${monday} 00:00:00`, `${friday} 23:59:59`] } },
        { start_date: null, due_date: null, status: { [Op.notIn]: ['completed', 'canceled'] } },
      ],
    },
    include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    order: [['priority_order', 'ASC'], ['due_date', 'ASC']],
  });

  // 2) summary (기존)
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const estimated_total = tasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  const actual_total = tasks.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0);
  const capacity_hours = await getUserCapacity(userId, businessId);
  const utilization_pct = capacity_hours > 0 ? Math.round((actual_total / capacity_hours) * 100) : 0;

  // 3) burndown (기존)
  const burndown = await buildBurndownData(tasks.map(t => t.id), monday);

  // 4) 본인 관여 active 프로젝트 + 통계
  const projectIdsFromTasks = [...new Set(tasks.map(t => t.project_id).filter(Boolean))];
  const memberProjects = await ProjectMember.findAll({
    where: { user_id: userId },
    attributes: ['project_id'],
  });
  const projectIds = [...new Set([
    ...projectIdsFromTasks,
    ...memberProjects.map(m => m.project_id),
  ])];
  const projects = projectIds.length > 0
    ? await fetchProjectStats(businessId, projectIds, monday)
    : [];

  // 5) 본인 프로젝트 한정 미해결 이슈
  const issues = projectIds.length > 0
    ? await fetchOpenIssues(businessId, projectIds)
    : [];

  // 6) risks (본인 한정)
  const risks = await fetchRisks(businessId, monday, sunday, userId);

  // 7) blockers (본인 한정)
  const blockers = await fetchBlockers(businessId, userId);

  // 8) next_week_focus (다음 주 본인 task)
  const nextWeekMonday = addDaysStr(monday, 7);
  const next_week_focus = await fetchNextWeekFocus(businessId, nextWeekMonday, userId);

  // 9) key_completions — 본인 이번 주 완료 중 estimated_hours top 3
  const key_completions = tasks
    .filter(t => t.status === 'completed')
    .sort((a, b) => (Number(b.estimated_hours) || 0) - (Number(a.estimated_hours) || 0))
    .slice(0, 3)
    .map(t => ({
      task_id: t.id, title: t.title, project_name: t.Project?.name || null,
      estimated_hours: Number(t.estimated_hours) || 0,
    }));

  return {
    schema_version: 1,
    tasks: tasks.map(serializeTaskForSnapshot),
    summary: {
      total, completed, incomplete: total - completed,
      estimated_total: Math.round(estimated_total * 10) / 10,
      actual_total: Math.round(actual_total * 10) / 10,
      utilization_pct, capacity_hours,
    },
    burndown,
    projects,
    issues,
    risks,
    blockers,
    next_week_focus,
    key_completions,
  };
}

function serializeTaskForSnapshot(t) {
  return {
    id: t.id, title: t.title, status: t.status,
    estimated_hours: Number(t.estimated_hours) || 0,
    actual_hours: Number(t.actual_hours) || 0,
    progress_percent: Number(t.progress_percent) || 0,
    due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
    start_date: t.start_date ? String(t.start_date).slice(0, 10) : null,
    project_id: t.project_id,
    project_name: t.Project?.name || null,
    priority_order: t.priority_order,
  };
}

async function buildBurndownData(taskIds, monday) {
  if (taskIds.length === 0) return [];
  const sunday = sundayOf(monday);
  const progresses = await TaskDailyProgress.findAll({
    where: { task_id: { [Op.in]: taskIds }, snapshot_date: { [Op.between]: [monday, sunday] } },
    order: [['snapshot_date', 'ASC']],
  });
  const result = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(monday, i);
    const dayProgs = progresses.filter(p => String(p.snapshot_date) === date);
    const estimated_cumulative = dayProgs.reduce((s, p) => s + (Number(p.estimated_hours) || 0), 0);
    const actual_cumulative = dayProgs.reduce((s, p) => s + (Number(p.actual_hours) || 0), 0);
    result.push({
      date,
      estimated_cumulative: Math.round(estimated_cumulative * 10) / 10,
      actual_cumulative: Math.round(actual_cumulative * 10) / 10,
    });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// 통합본 (워크스페이스 × 주차 = 1)
// ─────────────────────────────────────────────────────────────
async function buildWorkspaceSnapshot(businessId, weekStart) {
  const monday = weekStart;
  const friday = fridayOf(monday);
  const sunday = sundayOf(monday);
  const nextWeekMonday = addDaysStr(monday, 7);

  // 모든 active 프로젝트
  const activeProjects = await Project.findAll({
    where: { business_id: businessId, status: 'active' },
    attributes: ['id', 'name', 'status', 'start_date', 'end_date'],
  });
  const projectIds = activeProjects.map(p => p.id);

  // portfolio (모든 active 프로젝트 통계 + 전주 비교)
  const portfolio = await fetchProjectStats(businessId, projectIds, monday, /*withHealth*/ true);

  // 멤버 utilization
  const member_utilization = await fetchMemberUtilization(businessId, monday, sunday);

  // 모든 워크스페이스의 risks / blockers / next_week / issues
  const risks = await fetchRisks(businessId, monday, sunday, null);
  const blockers = await fetchBlockers(businessId, null);
  const issues = await fetchOpenIssues(businessId, null);
  const next_week_focus = await fetchNextWeekFocus(businessId, nextWeekMonday, null);

  // KPI
  const completedTasksThisWeek = await Task.count({
    where: {
      business_id: businessId, status: 'completed',
      completed_at: { [Op.between]: [`${monday} 00:00:00`, `${friday} 23:59:59`] },
    },
  });
  const avgUtil = member_utilization.length > 0
    ? Math.round(member_utilization.reduce((s, m) => s + m.utilization_pct, 0) / member_utilization.length)
    : 0;
  const overdueCount = risks.filter(r => r.kind === 'overdue').length;

  const currKpi = {
    completed_tasks: completedTasksThisWeek,
    active_projects: activeProjects.length,
    avg_utilization_pct: avgUtil,
    open_issues: issues.length,
    overdue_tasks: overdueCount,
  };

  // 전주 KPI 비교 (delta) — snapshot_data 가 string 으로 올 수 있어 안전 parse
  const prev = await BusinessWeeklyReport.findOne({
    where: { business_id: businessId, week_start: prevMonday(monday) },
  });
  const prevSnap = prev
    ? (typeof prev.snapshot_data === 'string' ? JSON.parse(prev.snapshot_data) : prev.snapshot_data)
    : null;
  const prevKpi = prevSnap?.kpi;
  const kpi = {
    completed_tasks: { value: currKpi.completed_tasks, delta: deltaOrNull(currKpi.completed_tasks, prevKpi?.completed_tasks?.value) },
    active_projects: { value: currKpi.active_projects, delta: deltaOrNull(currKpi.active_projects, prevKpi?.active_projects?.value) },
    avg_utilization_pct: { value: currKpi.avg_utilization_pct, delta: deltaOrNull(currKpi.avg_utilization_pct, prevKpi?.avg_utilization_pct?.value) },
    open_issues: { value: currKpi.open_issues, delta: deltaOrNull(currKpi.open_issues, prevKpi?.open_issues?.value) },
    overdue_tasks: { value: currKpi.overdue_tasks, delta: deltaOrNull(currKpi.overdue_tasks, prevKpi?.overdue_tasks?.value) },
  };

  // highlights — 이번 주 완료 task 중 estimated_hours top 5
  const completedTasks = await Task.findAll({
    where: {
      business_id: businessId, status: 'completed',
      completed_at: { [Op.between]: [`${monday} 00:00:00`, `${friday} 23:59:59`] },
    },
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { association: 'assignee', attributes: ['id', 'name'], required: false },
    ],
    order: [['estimated_hours', 'DESC']],
    limit: 5,
  });
  const highlights = completedTasks.map(t => ({
    task_id: t.id, title: t.title, project_name: t.Project?.name || null,
    assignee_name: t.assignee?.name || '—',
    estimated_hours: Number(t.estimated_hours) || 0,
  }));

  // team_highlights — 각 멤버별 top completion + 개인본 retro_excerpt
  const team_highlights = await fetchTeamHighlights(businessId, monday, friday, member_utilization);

  // decisions_required
  const decisions_required = await fetchDecisionsRequired(businessId, monday);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    period: { week_start: monday, week_end: sunday },
    kpi,
    highlights,
    risks,
    blockers,
    issues,
    next_week_focus,
    portfolio,
    member_utilization,
    team_highlights,
    decisions_required,
  };
}

function deltaOrNull(curr, prev) {
  if (prev === undefined || prev === null) return null;
  return curr - prev;
}

// ─────────────────────────────────────────────────────────────
// 공통 헬퍼 — projects, issues, risks, blockers, next_week_focus
// ─────────────────────────────────────────────────────────────

// 프로젝트 통계 (개인본·통합본 공용)
async function fetchProjectStats(businessId, projectIds, monday, withHealth = false) {
  if (projectIds.length === 0) return [];
  const projects = await Project.findAll({
    where: { id: { [Op.in]: projectIds }, business_id: businessId },
    attributes: ['id', 'name', 'status', 'start_date', 'end_date'],
  });
  const tasksByProject = await Task.findAll({
    where: { project_id: { [Op.in]: projectIds }, business_id: businessId },
    attributes: ['id', 'project_id', 'status', 'progress_percent', 'due_date'],
  });
  const issuesByProject = await ProjectIssue.findAll({
    where: { project_id: { [Op.in]: projectIds } },
    attributes: ['id', 'project_id'],
  });

  const today = new Date().toISOString().slice(0, 10);
  const prevWeekMonday = prevMonday(monday);

  // 전주 progress (TaskDailyProgress 마지막 일요일 데이터)
  const prevWeekSunday = addDaysStr(prevWeekMonday, 6);
  const prevProgresses = await TaskDailyProgress.findAll({
    where: {
      task_id: { [Op.in]: tasksByProject.map(t => t.id) },
      snapshot_date: prevWeekSunday,
    },
    attributes: ['task_id', 'progress_percent'],
  });
  const prevProgMap = new Map(prevProgresses.map(p => [p.task_id, Number(p.progress_percent) || 0]));

  return projects.map(p => {
    const tasks = tasksByProject.filter(t => t.project_id === p.id);
    const active = tasks.filter(t => t.status !== 'canceled');
    const total_tasks = active.length;
    const completed_tasks = active.filter(t => t.status === 'completed').length;
    const overdue_count = active.filter(t =>
      t.due_date && String(t.due_date).slice(0, 10) < today && t.status !== 'completed'
    ).length;
    const progress_percent = total_tasks === 0 ? 0 : Math.round(
      active.reduce((s, t) => s + (t.status === 'completed' ? 100 : (Number(t.progress_percent) || 0)), 0) / total_tasks
    );
    // 전주 평균 progress
    const prevAvg = total_tasks === 0 ? 0 : Math.round(
      active.reduce((s, t) => s + (prevProgMap.get(t.id) || 0), 0) / total_tasks
    );
    const progress_delta = progress_percent - prevAvg;

    const open_issues = issuesByProject.filter(i => i.project_id === p.id).length;
    const end_date = p.end_date ? String(p.end_date).slice(0, 10) : null;
    const d_day = end_date ? daysBetween(today, end_date) : null;

    let health = 'yellow';
    if (withHealth) {
      if (progress_delta >= 0 && overdue_count === 0 && open_issues === 0) health = 'green';
      else if (overdue_count >= 3 || (d_day != null && d_day < 7 && progress_percent < 70)) health = 'red';
      else health = 'yellow';
    }

    return {
      project_id: p.id, name: p.name, status: p.status,
      progress_percent, progress_delta,
      completed_tasks, total_tasks, overdue_count, open_issues,
      end_date, d_day,
      ...(withHealth ? { health } : {}),
    };
  });
}

// 미해결 이슈 — ProjectIssue 에 status 컬럼 없어 모든 row 를 open 으로 간주.
// severity 미존재 → 'medium' default. 미래에 severity/status 추가 시 자동 활용.
async function fetchOpenIssues(businessId, projectIdsFilter) {
  const where = {};
  if (projectIdsFilter) {
    where.project_id = { [Op.in]: projectIdsFilter };
  } else {
    // workspace 전체 — businessId 의 프로젝트들
    const projs = await Project.findAll({
      where: { business_id: businessId },
      attributes: ['id'],
    });
    if (projs.length === 0) return [];
    where.project_id = { [Op.in]: projs.map(p => p.id) };
  }
  const issues = await ProjectIssue.findAll({
    where,
    include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    order: [['created_at', 'DESC']],
    limit: 30,
  });
  const today = new Date();
  return issues.map(i => ({
    id: i.id,
    title: (i.body || '').slice(0, 100),
    severity: 'medium',
    project_id: i.project_id,
    project_name: i.Project?.name || null,
    opened_at: i.created_at,
    days_open: Math.max(0, Math.round((today - new Date(i.created_at)) / 86400000)),
  }));
}

// risks — overdue + stalled + due_soon_low_progress
async function fetchRisks(businessId, monday, sunday, userIdFilter) {
  const today = new Date().toISOString().slice(0, 10);
  const inThreeDays = addDaysStr(today, 3);

  const baseWhere = {
    business_id: businessId,
    status: { [Op.notIn]: ['completed', 'canceled'] },
  };
  if (userIdFilter) baseWhere.assignee_id = userIdFilter;

  // overdue
  const overdueTasks = await Task.findAll({
    where: { ...baseWhere, due_date: { [Op.lt]: today, [Op.ne]: null } },
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { association: 'assignee', attributes: ['id', 'name'], required: false },
    ],
    order: [['due_date', 'ASC']],
    limit: 15,
  });
  const overdue = overdueTasks.map(t => {
    const daysLate = daysBetween(String(t.due_date).slice(0, 10), today);
    return {
      kind: 'overdue',
      task_id: t.id, title: t.title,
      project_name: t.Project?.name || null,
      assignee_name: t.assignee?.name || '—',
      detail: `마감 ${daysLate}일 지남`,
      severity: daysLate >= 7 ? 'high' : (daysLate >= 3 ? 'medium' : 'low'),
    };
  });

  // due soon + low progress
  const dueSoonTasks = await Task.findAll({
    where: {
      ...baseWhere,
      due_date: { [Op.between]: [today, inThreeDays] },
      progress_percent: { [Op.lt]: 50 },
    },
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { association: 'assignee', attributes: ['id', 'name'], required: false },
    ],
    order: [['due_date', 'ASC']],
    limit: 10,
  });
  const dueSoon = dueSoonTasks.map(t => {
    const dd = daysBetween(today, String(t.due_date).slice(0, 10));
    return {
      kind: 'due_soon_low_progress',
      task_id: t.id, title: t.title,
      project_name: t.Project?.name || null,
      assignee_name: t.assignee?.name || '—',
      detail: `D-${dd}, 진행률 ${Number(t.progress_percent) || 0}%`,
      severity: dd <= 1 ? 'high' : 'medium',
    };
  });

  // stalled — TaskDailyProgress 7일+ 변화 없음
  const sevenDaysAgo = addDaysStr(today, -7);
  const stalledCandidates = await Task.findAll({
    where: { ...baseWhere, status: 'in_progress' },
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { association: 'assignee', attributes: ['id', 'name'], required: false },
    ],
    limit: 50,
  });
  const stalled = [];
  for (const t of stalledCandidates) {
    const progs = await TaskDailyProgress.findAll({
      where: { task_id: t.id, snapshot_date: { [Op.between]: [sevenDaysAgo, today] } },
      attributes: ['progress_percent', 'snapshot_date'],
      order: [['snapshot_date', 'ASC']],
    });
    if (progs.length < 7) continue; // 데이터 부족
    const pcts = progs.map(p => Number(p.progress_percent) || 0);
    if (Math.max(...pcts) === Math.min(...pcts)) {
      stalled.push({
        kind: 'stalled',
        task_id: t.id, title: t.title,
        project_name: t.Project?.name || null,
        assignee_name: t.assignee?.name || '—',
        detail: `7일째 진행률 ${pcts[0]}% 고정`,
        severity: 'medium',
      });
    }
    if (stalled.length >= 10) break;
  }

  return [...overdue, ...dueSoon, ...stalled];
}

// blockers — waiting / revision_requested
async function fetchBlockers(businessId, userIdFilter) {
  const where = {
    business_id: businessId,
    status: { [Op.in]: ['waiting', 'revision_requested'] },
  };
  if (userIdFilter) where.assignee_id = userIdFilter;
  const tasks = await Task.findAll({
    where,
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { association: 'assignee', attributes: ['id', 'name'], required: false },
    ],
    limit: 15,
  });
  const results = [];
  for (const t of tasks) {
    const lastTransition = await TaskStatusHistory.findOne({
      where: { task_id: t.id, to_status: t.status },
      order: [['created_at', 'DESC']],
      attributes: ['created_at'],
    });
    const since = lastTransition?.created_at || t.updated_at;
    const daysBlocked = since ? Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 86400000)) : 0;
    let reasonSnippet = null;
    if (t.status === 'revision_requested') {
      const lastComment = await TaskComment.findOne({
        where: { task_id: t.id },
        order: [['created_at', 'DESC']],
        attributes: ['content'],  // N+63 — task_comments 컬럼은 'body' 가 아닌 'content'. cron error 'Unknown column body' 회귀 fix.
      });
      if (lastComment?.content) reasonSnippet = String(lastComment.content).slice(0, 80);
    }
    results.push({
      task_id: t.id, title: t.title,
      project_name: t.Project?.name || null,
      assignee_name: t.assignee?.name || '—',
      blocked_status: t.status,
      blocked_since: since,
      days_blocked: daysBlocked,
      reason_snippet: reasonSnippet,
    });
  }
  // 오래 막힌 순
  results.sort((a, b) => b.days_blocked - a.days_blocked);
  return results;
}

async function fetchNextWeekFocus(businessId, nextMonday, userIdFilter) {
  const nextFriday = fridayOf(nextMonday);
  const where = {
    business_id: businessId,
    due_date: { [Op.between]: [nextMonday, nextFriday] },
    status: { [Op.notIn]: ['completed', 'canceled'] },
  };
  if (userIdFilter) where.assignee_id = userIdFilter;
  const tasks = await Task.findAll({
    where,
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { association: 'assignee', attributes: ['id', 'name'], required: false },
    ],
    order: [['priority_order', 'ASC'], ['due_date', 'ASC']],
    limit: 10,
  });
  const today = new Date().toISOString().slice(0, 10);
  return tasks.map(t => ({
    task_id: t.id, title: t.title,
    due_date: String(t.due_date).slice(0, 10),
    days_until: daysBetween(today, String(t.due_date).slice(0, 10)),
    assignee_name: t.assignee?.name || '—',
    project_name: t.Project?.name || null,
    priority_order: t.priority_order,
  }));
}

// 멤버 utilization — capacity vs Σ TaskDailyProgress.actual_hours
async function fetchMemberUtilization(businessId, monday, sunday) {
  const members = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    attributes: ['user_id', 'name', 'daily_work_hours', 'weekly_work_days'],
  });
  // 멤버 task 의 daily_progress 의 actual_hours 합산
  const memberStats = [];
  for (const m of members) {
    const tasks = await Task.findAll({
      where: { business_id: businessId, assignee_id: m.user_id },
      attributes: ['id', 'status', 'due_date'],
    });
    const taskIds = tasks.map(t => t.id);
    let actual_hours = 0;
    if (taskIds.length > 0) {
      const sumRow = await TaskDailyProgress.sum('actual_hours', {
        where: {
          task_id: { [Op.in]: taskIds },
          snapshot_date: { [Op.between]: [monday, sunday] },
        },
      });
      actual_hours = Number(sumRow) || 0;
    }
    const capacity_hours = Math.round(
      (Number(m.daily_work_hours) || 8) * (Number(m.weekly_work_days) || 5)
    );
    const utilization_pct = capacity_hours > 0 ? Math.round((actual_hours / capacity_hours) * 100) : 0;
    const today = new Date().toISOString().slice(0, 10);
    const completed_tasks = tasks.filter(t => t.status === 'completed').length;
    const overdue_tasks = tasks.filter(t =>
      t.due_date && String(t.due_date).slice(0, 10) < today && !['completed', 'canceled'].includes(t.status)
    ).length;
    let status = 'normal';
    if (utilization_pct > 100) status = 'overloaded';
    else if (utilization_pct < 60) status = 'underloaded';
    memberStats.push({
      user_id: m.user_id,
      name: pickMemberName(m.user, m),
      capacity_hours, actual_hours: Math.round(actual_hours * 10) / 10,
      utilization_pct, completed_tasks, overdue_tasks, status,
    });
  }
  // utilization 높은 순 (과부하 위 표시)
  memberStats.sort((a, b) => b.utilization_pct - a.utilization_pct);
  return memberStats;
}

// team_highlights — 멤버별 top completion + 개인본 retro_excerpt
async function fetchTeamHighlights(businessId, monday, friday, members) {
  const result = [];
  for (const m of members) {
    const topTask = await Task.findOne({
      where: {
        business_id: businessId,
        assignee_id: m.user_id,
        status: 'completed',
        completed_at: { [Op.between]: [`${monday} 00:00:00`, `${friday} 23:59:59`] },
      },
      order: [['estimated_hours', 'DESC']],
      attributes: ['id', 'title'],
    });
    const personal = await WeeklyReview.findOne({
      where: { business_id: businessId, user_id: m.user_id, week_start: monday },
      attributes: ['retro_note'],
    });
    const retro = personal?.retro_note ? String(personal.retro_note).slice(0, 80) : null;
    // 완료 task 도 없고 retro 도 없으면 skip
    if (!topTask && !retro) continue;
    result.push({
      user_id: m.user_id, name: m.name,
      top_completion: topTask ? { task_id: topTask.id, title: topTask.title } : null,
      retro_excerpt: retro,
    });
  }
  return result;
}

// decisions_required — 결정 필요 항목 추출
async function fetchDecisionsRequired(businessId, monday) {
  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  // 1) revision_requested 7일+ 막힘
  const revisionStuck = await Task.findAll({
    where: {
      business_id: businessId, status: 'revision_requested',
      updated_at: { [Op.lt]: addDaysStr(today, -7) + ' 00:00:00' },
    },
    include: [{ model: Project, attributes: ['name'], required: false }],
    limit: 10,
  });
  for (const t of revisionStuck) {
    const days = Math.round((Date.now() - new Date(t.updated_at).getTime()) / 86400000);
    results.push({
      kind: 'revision_blocked',
      task_id: t.id, title: t.title,
      project_name: t.Project?.name || null,
      days_pending: days,
      suggested_action: '컨펌자 결정 또는 담당자 재배정 필요',
    });
  }

  // 2) 마감 임박 + 담당자 미지정
  const unassignedDue = await Task.findAll({
    where: {
      business_id: businessId,
      due_date: { [Op.between]: [today, addDaysStr(today, 7)] },
      assignee_id: null,
      status: { [Op.notIn]: ['completed', 'canceled'] },
    },
    include: [{ model: Project, attributes: ['name'], required: false }],
    limit: 10,
  });
  for (const t of unassignedDue) {
    const dd = daysBetween(today, String(t.due_date).slice(0, 10));
    results.push({
      kind: 'unassigned_due_soon',
      task_id: t.id, title: t.title,
      project_name: t.Project?.name || null,
      days_pending: dd,
      suggested_action: '담당자 지정 필요',
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// 사용자 capacity (개인본)
// ─────────────────────────────────────────────────────────────
async function getUserCapacity(userId, businessId) {
  try {
    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id: businessId },
      attributes: ['daily_work_hours', 'weekly_work_days'],
    });
    if (member) {
      const daily = Number(member.daily_work_hours) || 8;
      const days = Number(member.weekly_work_days) || 5;
      return Math.round(daily * days);
    }
  } catch (e) {
    console.error('[weeklyReviewSnapshot] getUserCapacity error:', e.message);
  }
  return 40;
}

module.exports = {
  buildSnapshot,
  buildWorkspaceSnapshot,
  getUserCapacity,
};
