// reportUnitSnapshot.js — 단위 보고서(ReportUnit) 자동 초안 빌더 (R2, 마스터설계 §4.2·§7.0)
//   scope = project / department. KPI 수치는 fetchProjectStats 단일 원천 재사용(P4).
//   주간/월간 period 경계 안에서 하이라이트·리스크·차기 계획·팀/멤버 롤업 집계.
const { myAssignedWeekWhere } = require('./weekTaskSet');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Project, Task, User, ProjectMember, BusinessMember, Department, ProjectIssue, Post, Document,
  ProjectWorkstream, ProjectClient, TaskDailyProgress,
} = require('../models');
const { fetchProjectStats } = require('./weeklyReviewSnapshot');
const { todayInTz, mondayOfDateStr, addDaysStr } = require('../utils/datetime');
const { getProgressBaselines, estDoneOf } = require('./progressBaseline');
const capacityService = require('./memberCapacity');

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
    // /documents/:id 뷰어 라우트는 프론트에 없다 — 같은 프로젝트 문서 탭으로 착지(#246 계열)
    ...docs.map((d) => ({ kind: 'document', id: d.id, title: d.title, link: `/projects/p/${projectId}?tab=docs` })),
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
  const in_progress = tp.filter((t) => t.status === 'in_progress' || t.status === 'reviewing' || t.status === 'external_review').map(briefTask).slice(0, 20);
  const risks = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed' && t.status !== 'canceled').map(briefTask).slice(0, 20);
  const blockers = tp.filter((t) => t.status === 'waiting' || t.status === 'revision_requested' || t.status === 'on_hold').map(briefTask).slice(0, 15);
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
    // #288 — 멤버 쪽만 today 를 넘기고 있었다(148행 주석의 수리가 여기엔 적용 안 됨).
    //   안 넘기면 아직 오지 않은 요일까지 평평한 선이 이어져 "이번 주가 벌써 끝난 것처럼" 보인다.
    //   프로젝트 차트에는 capacity 를 싣지 않는다 — 참여율은 워크스페이스 단위라 프로젝트로 쪼갤 수 없고,
    //   팀원 캐파를 프로젝트마다 합산하면 같은 사람의 시간이 여러 섹션에 중복 계상된다(Fable 설계).
    progress_series: await buildProgressSeries(tasks.map((x) => x.id), start, end, today),
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

// ── 진척 시리즈(번업) — 보고서에 그래프를 넣기 위한 **박제 데이터**.
//   Irene: "우측패널에 나오는 주간 업무 진척 그래프가 캡쳐돼서 업무보고에 포함되어야 해. 캡처시점 제대로 맞춰서."
//   그래서 이미지가 아니라 **그 기간의 일별 시리즈를 스냅샷에 굳혀** 저장한다 — 나중에 업무가 바뀌어도
//   보고서의 그래프는 그 주의 사실 그대로 남는다 (이미지 캡처는 다시 그릴 수도, 확대할 수도 없다).
//   정의는 Q Task 라이브 그래프와 동일: est = Σ(예측시간 × 진행률), act = Σ(실제시간). 누적(단조증가).
// 기간 진척선 — **그 기간에 새로 만든 진척·투입**을 0 에서 시작해 그린다(번업).
//
// ★ #223 — 여태 task_daily_progress 값을 그대로 합산했는데, 그 행은 업무별 **일생 누적치**다.
//   그래서 이월 업무가 주 시작 시점에 이미 안고 있던 시간이 첫날부터 통째로 들어와
//   선이 0 이 아니라 195h(운영)·2244h(dev) 에서 시작했고, running-max 가 그 값을 주 내내 고정해
//   **평평한 선**이 됐다. 정작 그 주 진척(수 h)은 200h y축에 묻혀 안 보였다 — 신고 증상 그대로.
//   대상을 주 무대 업무로 좁히는 것만으로는 안 풀린다(운영·dev 양쪽 실측으로 반증됨).
//   → 업무별 기준선(기간 시작 이전 최신 값)을 빼서 Δ 를 그린다. 부수 효과로 폐기된 자동누적
//     시절의 부풀린 과거 값도 기준선에 갇혀 상쇄된다 — 데이터를 고치지 않고 정의로 면역을 얻는다.
//
// 기준선은 `start - 1일` 고정이 아니라 **`snapshot_date < start` 의 업무별 최신 행**이다.
//   하루 고정이면 cron 이 그 하루를 걸렀을 때 그 업무의 일생 누적이 Δ 로 재유입된다(뒷문).
//   기준 행이 없는 업무(기간 중 생성)는 기준 0 — 처음부터 쌓인 것이 맞다.
//
// 클램프는 **업무별**로 한다. 집계 후 클램프는 오답이다: 한 업무의 하향 정정(-3.2h)이 다른 업무의
//   진척(+4.6h)을 잡아먹어 합계가 과소·음수가 된다(운영 실측 반례). 하향 정정은 *과거 기록의 수정*이지
//   그 주의 음(−)의 노동이 아니므로 0 으로 눕힌다.
//
// @param today 'YYYY-MM-DD'. 주면 오늘 이후 요일은 방출하지 않는다 — 아직 오지 않은 날에
//   running-max 가 이전 피크를 밀어넣어 주 전체 폭의 평평한 선을 그리던 것을 막는다
//   (라이브 그래프는 이미 미래를 null 처리한다. 보고서만 안 하고 있었다).
async function buildProgressSeries(taskIds, start, end, today = null) {
  if (!taskIds.length) return [];
  const rows = await TaskDailyProgress.findAll({
    where: { task_id: { [Op.in]: taskIds }, snapshot_date: { [Op.between]: [start, end] } },
    order: [['snapshot_date', 'ASC']],
  });

  // 업무별 기준선 — services/progressBaseline 단일 원천 (라이브 그래프·개인 주간보고가 같은 함수를 쓴다)
  const { baseAct, baseEst, estNow } = await getProgressBaselines(taskIds, start);

  // snapshot_date 가 Date 로 역직렬화되면 String 비교가 항상 실패한다 (옛 그래프 빈화면 원인) → 정규화
  const dayKey = (sd) => (sd instanceof Date ? sd.toISOString().slice(0, 10) : String(sd).slice(0, 10));
  const out = [];
  let cursor = start;
  let maxEst = 0;
  let maxAct = 0;
  while (cursor <= end) {
    // #288 — 아직 오지 않은 날은 **축에는 남기되 값은 null**. break 로 잘라내면 기간이 짧아 보여
    //   "이번 주가 벌써 끝난 것처럼" 읽히고, 0 으로 채우면 하지도 않은 날에 0 선이 그려진다.
    if (today && cursor > today) {
      out.push({ date: cursor, estimated_cumulative: null, actual_cumulative: null });
      cursor = addDaysStr(cursor, 1);
      continue;
    }
    const day = rows.filter((r) => dayKey(r.snapshot_date) === cursor);
    const est = day.reduce((sum, r) => {
      // 예측 정정 면역 — 지금 예측 × 그날 진행률 (기준선과 같은 축). progressBaseline 정본.
      const v = estDoneOf(estNow, r.task_id, r.progress_percent, r.estimated_hours);
      return sum + Math.max(0, v - (baseEst.get(r.task_id) || 0));
    }, 0);
    const act = day.reduce((sum, r) => {
      const v = Number(r.actual_hours) || 0;
      return sum + Math.max(0, v - (baseAct.get(r.task_id) || 0));
    }, 0);
    maxEst = Math.max(maxEst, est);   // 누적은 줄지 않는다 (되돌림이 있어도 라인은 피크 유지)
    maxAct = Math.max(maxAct, act);
    out.push({
      date: cursor,
      estimated_cumulative: Math.round(maxEst * 10) / 10,
      actual_cumulative: Math.round(maxAct * 10) / 10,
    });
    cursor = addDaysStr(cursor, 1);
  }
  return out;
}

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
  const in_progress = tp.filter((t) => t.status === 'in_progress' || t.status === 'reviewing' || t.status === 'external_review').map(briefTask).slice(0, 20);
  const risks = tp.filter((t) => t.due_date && ymd(t.due_date) < today && t.status !== 'completed').map(briefTask).slice(0, 20);
  const blockers = tp.filter((t) => t.status === 'waiting' || t.status === 'revision_requested' || t.status === 'on_hold').map(briefTask).slice(0, 15);
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
    // ★ #223 — 진척선의 대상은 **그 기간 무대에 오른 업무**여야 한다.
    //   여태 `tasks`(본인 전체 업무) 를 그대로 넘겼는데, task_daily_progress 행은 업무별 *일생 누적치*라
    //   Σ 가 포트폴리오 총합(운영 실측 ~195h)이 되어 7일 내내 평평했고, 정작 그 주 진척(+4.6h)은
    //   200h y축에 묻혀 보이지 않았다 — "진척 그래프가 제대로 표시되지 않음" 의 실체.
    //   같은 병리를 routes/tasks.js:1855 가 이미 한 번 잡았다("안 좁히면 153h 로 박힌다").
    //   선정은 services/weekTaskSet.js 정본을 쓴다(주간). 월간은 같은 규칙을 월 경계로 적용.
    progress_series: await buildProgressSeries(await periodTaskIds(businessId, userId, start, end), start, end, today),
    // #288 — "합리적이고 정확한 기준(설정에서 가져와서)". 그 사람의 실제 근무 설정에서 온 값을
    //   **생성 시점에 박제**한다(확정본은 나중에 설정이 바뀌어도 그때의 기준을 유지해야 한다).
    //   월간은 주간 캐파를 기간 길이로 환산 — 규칙은 services/memberCapacity.periodHours 한 곳.
    capacity_hours: capacityService.periodHours(
      (await capacityService.getMemberCapacity(userId, businessId)).weekly, start, end,
    ),
    highlights, in_progress, risks, blockers, next,
  };
}

// 기간 무대 업무 id — 진척선 전용 스코프. 섹션 리스트(highlights 등)는 종전대로 전체에서 필터한다.
async function periodTaskIds(businessId, userId, start, end) {
  const rows = await Task.findAll({
    where: { business_id: businessId, ...myAssignedWeekWhere(userId, start, end, { createdBefore: `${end} 23:59:59` }) },
    attributes: ['id'],
  });
  return rows.map((r) => r.id);
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

module.exports = {
  buildAutoSnapshot, buildProjectSnapshot, buildMemberSnapshot, buildWorkspaceMembers, periodBounds, SCHEMA_VERSION,
  // 진척선 계산은 기준선·클램프 규칙이 얽혀 있어 단위 반증이 필요하다(#223) — 테스트 전용 노출.
  __test: { buildProgressSeries },
};
