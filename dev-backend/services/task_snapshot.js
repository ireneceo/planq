// 매일 00시 전체 업무의 진행율/실제시간 스냅샷
// 과거 어느 날 시점의 업무 궤적을 그릴 수 있게 함

const { Task, TaskDailyProgress } = require('../models');
const { Op } = require('sequelize');

async function snapshotAllTasks(targetDate) {
  const date = (targetDate || new Date()).toISOString().slice(0, 10);
  const tasks = await Task.findAll({
    where: { status: { [Op.notIn]: ['canceled'] } },
    attributes: ['id', 'progress_percent', 'actual_hours', 'estimated_hours', 'status'],
  });
  let created = 0, updated = 0;
  for (const t of tasks) {
    const [row, isNew] = await TaskDailyProgress.findOrCreate({
      where: { task_id: t.id, snapshot_date: date },
      defaults: {
        progress_percent: t.progress_percent || 0,
        actual_hours: Number(t.actual_hours) || 0,
        estimated_hours: t.estimated_hours,
        status: t.status,
      },
    });
    if (isNew) created++;
    else {
      await row.update({
        progress_percent: t.progress_percent || 0,
        actual_hours: Number(t.actual_hours) || 0,
        estimated_hours: t.estimated_hours,
        status: t.status,
      });
      updated++;
    }
  }
  return { date, created, updated, total: tasks.length };
}

// 과거 데이터 백필 — Period 내 업무에 대해 진행율 기반으로 추정 스냅샷 생성
async function backfillPeriod(fromDate, toDate) {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  const tasks = await Task.findAll({
    where: { status: { [Op.notIn]: ['canceled'] } },
    attributes: ['id', 'progress_percent', 'actual_hours', 'estimated_hours', 'status', 'start_date', 'due_date'],
  });
  const today = new Date().toISOString().slice(0, 10);
  let created = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    if (ds > today) break; // 미래는 스냅샷 없음
    for (const t of tasks) {
      const ts = t.start_date?.toISOString().slice(0, 10) || t.due_date?.toISOString().slice(0, 10);
      const te = t.due_date?.toISOString().slice(0, 10) || t.start_date?.toISOString().slice(0, 10);
      if (!ts || !te || ds < ts || ds > te) continue;
      const exists = await TaskDailyProgress.findOne({ where: { task_id: t.id, snapshot_date: ds } });
      if (exists) continue;
      // 선형 분배 추정
      const startDt = new Date(ts), endDt = new Date(te);
      const durDays = Math.max(1, Math.round((endDt - startDt) / 86400000) + 1);
      const daysSoFar = Math.round((d - startDt) / 86400000) + 1;
      const ratio = Math.min(1, daysSoFar / durDays);
      const currProg = t.progress_percent || 0;
      const currAct = Number(t.actual_hours) || 0;
      await TaskDailyProgress.create({
        task_id: t.id,
        snapshot_date: ds,
        progress_percent: Math.round(currProg * ratio),
        actual_hours: Math.round(currAct * ratio * 10) / 10,
        estimated_hours: t.estimated_hours,
        status: t.status,
      });
      created++;
    }
  }
  return { created };
}

module.exports = { snapshotAllTasks, backfillPeriod };
