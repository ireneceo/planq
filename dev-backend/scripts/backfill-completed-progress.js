// #385 백필 — 완료인데 진행률이 0/미달인 업무를 100 으로.
//
// 왜: 체크박스 빠른완료 경로가 progress_percent 를 안 채웠다(services/actions/task_actions.js).
//   그래프가 `예측시간 × 진행률` 이라 **완료해도 진척이 0** 으로 잡혔다.
//   쓰기측(P1)은 고쳤지만 그건 **앞으로만** 유효하다 — 이미 쌓인 것은 여기서 정리한다.
//   ★ 쓰기측을 먼저 고치지 않고 백필만 하면 같은 결손이 다시 쌓인다
//     (memory feedback_backfill_needs_write_side_fix).
//
// 무엇을 고치나 (두 겹):
//   ① tasks.progress_percent — 지금 데이터. 오늘·앞으로의 그래프가 정상이 된다
//   ② task_daily_progress.progress_percent — **이미 찍힌 지난 날짜 스냅샷**.
//      이걸 안 고치면 지난 주 그래프는 계속 증발 상태로 남는다.
//      ★ 완료일 **이후** 스냅샷만 고친다 — 완료 전 날짜는 실제로 진행 중이었으므로
//        그때 기록이 100 이면 그게 거짓이 된다. "지나간 기록" 을 존중하는 절충.
//
// 멱등: 이미 100 이면 건드리지 않는다. 재실행 변경 0 이어야 한다.
// 사용: node scripts/backfill-completed-progress.js            (dry-run · 기본)
//       node scripts/backfill-completed-progress.js --apply    (실제 적용)
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');

(async () => {
  console.log(APPLY ? '=== 적용 모드 ===' : '=== DRY-RUN (변경 없음) ===');

  // ① 대상 업무
  const [tasks] = await sequelize.query(`
    SELECT id, business_id, LEFT(title,40) title, progress_percent, estimated_hours,
           DATE(completed_at) done_on
    FROM tasks
    WHERE status = 'completed' AND (progress_percent IS NULL OR progress_percent < 100)
    ORDER BY business_id, id`);
  console.log(`\n① 완료인데 진행률 100 미만: ${tasks.length}건`);
  const byBiz = {};
  tasks.forEach(t => { byBiz[t.business_id] = (byBiz[t.business_id] || 0) + 1; });
  console.log('   워크스페이스별:', JSON.stringify(byBiz));
  const estSum = tasks.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
  console.log(`   합산 예측시간: ${estSum.toFixed(1)}h  ← 지금 그래프에서 0 으로 잡히는 양`);
  tasks.slice(0, 8).forEach(t => console.log(`   #${t.id} ${String(t.progress_percent).padStart(3)}% 예측${t.estimated_hours}h 완료일 ${t.done_on || '없음'} "${t.title}"`));
  if (tasks.length > 8) console.log(`   … 외 ${tasks.length - 8}건`);

  // ② 대상 스냅샷 — 완료일 이후 행만
  const [snaps] = await sequelize.query(`
    SELECT COUNT(*) n FROM task_daily_progress p
    JOIN tasks t ON t.id = p.task_id
    WHERE t.status = 'completed' AND (p.progress_percent IS NULL OR p.progress_percent < 100)
      AND t.completed_at IS NOT NULL AND p.snapshot_date >= DATE(t.completed_at)`);
  console.log(`\n② 완료일 이후 스냅샷 중 진행률 미달: ${snaps[0].n}행`);
  console.log('   (완료 前 날짜 스냅샷은 건드리지 않는다 — 그때는 실제로 진행 중이었다)');

  if (!APPLY) {
    console.log('\n적용하려면 --apply 를 붙여 다시 실행하십시오.');
    process.exit(0);
  }

  const t1 = await sequelize.query(`
    UPDATE tasks SET progress_percent = 100
    WHERE status = 'completed' AND (progress_percent IS NULL OR progress_percent < 100)`);
  const t2 = await sequelize.query(`
    UPDATE task_daily_progress p
    JOIN tasks t ON t.id = p.task_id
    SET p.progress_percent = 100
    WHERE t.status = 'completed' AND (p.progress_percent IS NULL OR p.progress_percent < 100)
      AND t.completed_at IS NOT NULL AND p.snapshot_date >= DATE(t.completed_at)`);
  console.log(`\n적용 완료 — 업무 ${tasks.length}건 · 스냅샷 ${snaps[0].n}행`);
  console.log('재실행하면 변경 0 이어야 합니다(멱등 확인).');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
