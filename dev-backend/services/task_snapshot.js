// 매일 00시 전체 업무의 진행율/실제시간 스냅샷
// 과거 어느 날 시점의 업무 궤적을 그릴 수 있게 함
//
// 멀티테넌트 타임존 처리: 각 업무는 소속 워크스페이스(business)의 타임존 기준 "오늘" 날짜로
// 스냅샷을 저장한다. 크론은 서버 UTC 기준으로 돌지만, 업무별 날짜는 워크스페이스 tz 로 계산.

// ★ 모델은 **지연 로드**한다. models/index.js 가 아래 registerTaskSnapshotHook 을 부르므로
//   여기서 최상위 require('../models') 를 하면 순환이 된다 — 그리고 그 순환은 **로드 순서에 따라서만**
//   터진다(models 를 먼저 부르면 통과, task_snapshot 을 먼저 부르면 undefined). 실제로 그렇게 한 번 터졌다.
const { Op } = require('sequelize');
const { dateStrInTz } = require('../utils/datetime');

let _m = null;
const models = () => (_m || (_m = require('../models')));

async function snapshotAllTasks(targetDate) {
  const { Task, TaskDailyProgress, Business } = models();
  const ref = targetDate || new Date();
  // 워크스페이스별 tz 매핑
  const businesses = await Business.findAll({ attributes: ['id', 'timezone'] });
  const tzByBiz = new Map(businesses.map(b => [b.id, b.timezone || 'Asia/Seoul']));

  const tasks = await Task.findAll({
    where: { status: { [Op.notIn]: ['canceled'] } },
    attributes: ['id', 'business_id', 'progress_percent', 'actual_hours', 'estimated_hours', 'status'],
  });
  let created = 0, updated = 0;
  const datesSeen = new Set();
  for (const t of tasks) {
    const tz = tzByBiz.get(t.business_id) || 'Asia/Seoul';
    const date = dateStrInTz(ref, tz);
    datesSeen.add(date);
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
  return { dates: [...datesSeen], created, updated, total: tasks.length };
}

// 과거 데이터 백필 — Period 내 업무에 대해 진행율 기반으로 추정 스냅샷 생성
async function backfillPeriod(fromDate, toDate) {
  const { Task, TaskDailyProgress } = models();
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

// ─── 같은 날 안의 정정을 그 날 행에 반영 (2026-08-24) ────────────────────────
//
// 왜 필요한가:
//   자정 cron 이 만드는 D 일자 행은 **D 00:00 시점 값** — 즉 D-1 의 마감 상태다.
//   그래프가 기준선 차감(Δ)을 쓰던 동안은 이 어긋남이 상쇄돼 보이지 않았는데,
//   Irene 정의(2026-08-24)로 두 선이 **절대값**이 되면서 그대로 드러났다:
//   운영 실측 — lua 가 8/24 낮에 실제시간을 5h → 1h 로 정정했지만 8/24 행은 5h 인 채라,
//   "오늘" 은 라이브(1h)로 맞게 그려지다가 **내일이 되는 순간 그 자리가 5h 로 튀어오른다.**
//
// 그래서 D 일자 행의 의미를 "D 00:00 의 사진" 에서 **"D 에 대해 지금까지 알려진 최신 상태"** 로 옮긴다.
//   cron 이 아침에 행을 만들고(그 시점엔 전날 마감값이 맞다), 그 날 안의 변경이 같은 행을 갱신한다.
//   과거 날짜 행은 건드리지 않는다 — 지나간 날의 기록은 그대로 둔다.
const tzCache = new Map();   // business_id → timezone (프로세스 수명 캐시. 워크스페이스 tz 는 거의 안 바뀐다)
async function touchTodaySnapshot(task) {
  try {
    if (!task || !task.id || !task.business_id) return;
    const { TaskDailyProgress, Business } = models();
    let tz = tzCache.get(task.business_id);
    if (!tz) {
      const biz = await Business.findByPk(task.business_id, { attributes: ['timezone'] });
      tz = biz?.timezone || 'Asia/Seoul';
      tzCache.set(task.business_id, tz);
    }
    const date = dateStrInTz(new Date(), tz);
    const values = {
      progress_percent: task.progress_percent || 0,
      actual_hours: Number(task.actual_hours) || 0,
      estimated_hours: task.estimated_hours,
      status: task.status,
    };
    const [row, isNew] = await TaskDailyProgress.findOrCreate({
      where: { task_id: task.id, snapshot_date: date },
      defaults: values,
    });
    if (!isNew) await row.update(values);
  } catch (e) {
    // 스냅샷 갱신 실패가 업무 저장 자체를 깨뜨리면 안 된다 — 기록만 남기고 삼킨다.
    console.error('[taskSnapshot] touchTodaySnapshot failed:', task && task.id, e.message);
  }
}

/** Task 모델에 afterSave 훅을 건다 — 진척·시간·상태가 바뀐 저장에만 반응(단일 착지점). */
function registerTaskSnapshotHook(Task) {
  Task.addHook('afterSave', 'touchTodaySnapshot', async (instance) => {
    const watched = ['progress_percent', 'actual_hours', 'estimated_hours', 'status'];
    // 신규 생성이거나, 지켜보는 필드가 실제로 바뀐 저장일 때만.
    if (!instance.isNewRecord && !watched.some(f => instance.changed(f))) return;
    await touchTodaySnapshot(instance);
  });
}

module.exports = { snapshotAllTasks, backfillPeriod, touchTodaySnapshot, registerTaskSnapshotHook };
