#!/usr/bin/env node
// calendar_events.task_id — 일정 ↔ 업무 연결(2026-10-07, Irene «응. 추가해야 하지 않아?»). 멱등.
//
// ★ **코드 배포 전에** 돌린다. 모델이 이 칸을 SELECT 하므로 칸이 없는 채 새 코드가 뜨면 캘린더 전체가 500 이다.
//   ① task_id INT NULL — 기존 행은 전부 NULL(넓히는 변경, 기존 일정의 뜻이 바뀌지 않는다)
//   ② (business_id, task_id) 인덱스 — 업무 쪽에서 «이 업무의 일정» 을 찾을 때 쓴다.
//   외래키는 두지 않는다 — 업무는 휴지통(soft delete)이라 행이 남고, 보여줄 때 접근 판정으로 거른다.
// 롤백: 코드만 되돌리면 된다(칸은 NULL 이라 남아도 무해). 지우려면 DROP INDEX + DROP COLUMN.
//
// 사용:  node scripts/migrate-calendar-task-link.js         (적용)
//        node scripts/migrate-calendar-task-link.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[calendar-task-link]', ...a);
const IDX = 'calendar_events_biz_task';

(async () => {
  try {
    const read = async () => {
      const [[col]] = await sequelize.query("SHOW COLUMNS FROM calendar_events WHERE Field = 'task_id'");
      const [idx] = await sequelize.query(`SHOW INDEX FROM calendar_events WHERE Key_name = '${IDX}'`);
      return { col, idx: idx.length > 0 };
    };
    const before = await read();
    if (before.col && before.idx) { log('이미 적용됨 — 하는 일 없음', JSON.stringify(before.col.Type), 'NULL:', before.col.Null); process.exit(0); }
    const steps = [];
    if (!before.col) steps.push('ALTER TABLE calendar_events ADD COLUMN task_id INT NULL DEFAULT NULL');
    if (!before.idx) steps.push(`CREATE INDEX ${IDX} ON calendar_events (business_id, task_id)`);
    for (const sql of steps) { log(DRY ? '(dry) ' : '', sql); if (!DRY) await sequelize.query(sql); }
    if (DRY) process.exit(0);
    const after = await read();
    if (!after.col || !after.idx || after.col.Null !== 'YES') { log('검증 실패', JSON.stringify(after)); process.exit(1); }
    const [[{ n }]] = await sequelize.query('SELECT COUNT(*) n FROM calendar_events WHERE task_id IS NOT NULL');
    log('OK — task_id', JSON.stringify(after.col.Type), 'NULL 허용 · 인덱스 있음 · 연결된 일정', n);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[calendar-task-link] 실패:', e.message); process.exit(1); }
})();
