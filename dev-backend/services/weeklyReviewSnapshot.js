// weeklyReviewSnapshot.js — 주간 보고 스냅샷 빌드
//
// "이번 주 내 업무" 탭과 동일한 로직으로 task 조회 후
// snapshot_data JSON 구조로 변환.

const { Op } = require('sequelize');
const { Task, Project, TaskDailyProgress, BusinessMember } = require('../models');

// 날짜 유틸 (서버 사이드)
function addDaysStr(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fridayOf(mondayStr) {
  return addDaysStr(mondayStr, 4);
}

// ─── 스냅샷 빌드 ───
async function buildSnapshot(userId, businessId, weekStart, weekEnd) {
  const monday = weekStart;
  const friday = fridayOf(monday);

  // 1. tasks — "이번 주 내 업무" 탭 (QTaskPage week 탭) 필터와 동일하게:
  //   assignee_id = userId AND
  //   ( planned_week_start = monday
  //     OR start_date in [monday, friday]
  //     OR due_date in [monday, friday]
  //     OR (due_date < monday AND status not in completed/canceled)  -- overdue 미완료
  //     OR (completed_at in [monday, friday])  -- 이번 주에 완료한 것
  //     OR (start_date IS NULL AND due_date IS NULL AND status not in completed/canceled)  -- 기간 미정 미완료
  //   )
  const tasks = await Task.findAll({
    where: {
      business_id: businessId,
      assignee_id: userId,
      [Op.or]: [
        { planned_week_start: monday },
        { start_date: { [Op.between]: [monday, friday] } },
        { due_date: { [Op.between]: [monday, friday] } },
        // overdue 미완료
        {
          due_date: { [Op.lt]: monday },
          status: { [Op.notIn]: ['completed', 'canceled'] },
        },
        // 이번 주 완료
        { completed_at: { [Op.between]: [`${monday} 00:00:00`, `${friday} 23:59:59`] } },
        // 기간 미정 미완료
        {
          start_date: null,
          due_date: null,
          status: { [Op.notIn]: ['completed', 'canceled'] },
        },
      ],
    },
    include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    order: [['priority_order', 'ASC'], ['due_date', 'ASC']],
  });

  // 2. summary
  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;
  const estimated_total = tasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  const actual_total = tasks.reduce((s, t) => s + (Number(t.actual_hours) || 0), 0);

  // 3. capacity (BusinessMember daily_work_hours × business_days × efficiency_rate)
  // 또는 기본값 8 × 5 = 40
  let capacity_hours = 40;
  try {
    const member = await BusinessMember.findOne({
      where: { user_id: userId, business_id: businessId },
      attributes: ['daily_work_hours', 'weekly_work_days'],
    });
    if (member) {
      const daily = Number(member.daily_work_hours) || 8;
      const days = Number(member.weekly_work_days) || 5;
      capacity_hours = Math.round(daily * days);
    }
  } catch (e) {
    console.error('[weeklyReviewSnapshot] capacity fetch error:', e.message);
  }

  const utilization_pct = capacity_hours > 0
    ? Math.round((actual_total / capacity_hours) * 100)
    : 0;

  // 4. burndown — TaskDailyProgress 누적 (월~금 5일)
  const burndown = await buildBurndownData(tasks, monday, friday);

  return {
    tasks: tasks.map(serializeTaskForSnapshot),
    summary: {
      total,
      completed,
      incomplete: total - completed,
      estimated_total: Math.round(estimated_total * 10) / 10,
      actual_total: Math.round(actual_total * 10) / 10,
      utilization_pct,
      capacity_hours,
    },
    burndown,
  };
}

// task → snapshot 용 직렬화
function serializeTaskForSnapshot(t) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
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

// burndown 데이터 빌드 (월~일 7일)
async function buildBurndownData(tasks, monday, friday) {
  const taskIds = tasks.map(t => t.id);
  if (taskIds.length === 0) return [];

  // 해당 주간의 모든 daily_progress 조회
  const sunday = addDaysStr(monday, 6);
  const progresses = await TaskDailyProgress.findAll({
    where: {
      task_id: { [Op.in]: taskIds },
      snapshot_date: { [Op.between]: [monday, sunday] },
    },
    order: [['snapshot_date', 'ASC']],
  });

  // 일별 집계
  const result = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(monday, i);
    const dayProgs = progresses.filter(p => String(p.snapshot_date) === date);

    // 해당 날짜의 누적 estimated/actual
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

// ─── 사용자의 그 주 capacity 조회 ───
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
  getUserCapacity,
};
