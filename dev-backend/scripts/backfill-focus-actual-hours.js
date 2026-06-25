// 운영 #94 백필 — computeActualSeconds 방치 캡 적용 후, focus 기반으로 자동 누적된
// task.actual_hours 를 재계산해 부풀린 값(예: 153.6h)을 현실값으로 교정한다.
//   - actual_source='user' (사용자 직접 입력) 는 recompute 가 건드리지 않음(보호).
//   - idempotent: 여러 번 돌려도 안전(값 동일하면 update 스킵).
// 사용: node scripts/backfill-focus-actual-hours.js
const { sequelize } = require('../config/database');
const { Task, FocusSession } = require('../models');
const { recomputeActualHoursFromHistory } = require('../services/taskActualHours');

(async () => {
  // 대상 = focus 세션이 붙은 task 만 (computeActualSeconds 캡이 영향을 주는 정확한 범위).
  //   focus 없는 task 는 status_history 경로라 이 fix 와 무관 → 건드리지 않음(방치 in_progress 의
  //   status_history live 누적 같은 별개 이슈를 잘못 트리거하지 않도록 스코프 한정).
  const focusTaskRows = await FocusSession.findAll({
    attributes: [[sequelize.fn('DISTINCT', sequelize.col('task_id')), 'task_id']],
    where: { task_id: { [require('sequelize').Op.ne]: null } },
    raw: true,
  });
  const ids = [...new Set(focusTaskRows.map(r => r.task_id))];

  console.log(`대상(focus 세션 보유) task: ${ids.length}건 재계산 시작`);
  let changed = 0;
  const diffs = [];
  for (const id of ids) {
    const before = await Task.findByPk(id, { attributes: ['id', 'actual_hours', 'actual_source'], raw: true });
    if (!before) continue;
    const after = await recomputeActualHoursFromHistory(id);  // null = user 입력(스킵) 또는 task 없음
    if (after == null) continue;
    const beforeH = Number(before.actual_hours);
    if (Math.abs(beforeH - after) >= 0.05) {
      changed++;
      diffs.push({ id, before: beforeH, after });
    }
  }
  // 큰 교정부터 표시
  diffs.sort((a, b) => (b.before - b.after) - (a.before - a.after));
  console.log(`\n변경된 task: ${changed}건`);
  diffs.slice(0, 40).forEach(d => console.log(`  task${d.id}: ${d.before}h → ${d.after}h`));

  // 검증 — 캡 후에도 24h 초과 actual_hours 남아있나
  const [stillBad] = await sequelize.query("SELECT id, actual_hours, actual_source FROM tasks WHERE actual_hours > 24 AND actual_source='auto'");
  console.log(`\n남은 auto actual_hours>24h: ${stillBad.length}건 ${stillBad.length ? JSON.stringify(stillBad) : '(정상)'}`);

  await sequelize.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
