#!/usr/bin/env node
// 근태 고정 근무 일정·지각 — 새 표 2개. 멱등(있으면 건너뛴다). 기존 행·칸은 한 줄도 바꾸지 않는다.
//
//   설계: docs/ATTENDANCE_FIXED_SCHEDULE_DESIGN.md §2 · §9
//
// ★ **코드 배포 전에** 돌린다 — 근태 조회가 새 표를 읽으므로 없으면 /today·/stats 가 500.
// ★ sync-database.js 에 맡기지 않는다(모델에 없는 컬럼 DROP 전례). 백필 없음 — 행이 없으면 유연 = 지금 그대로.
//
// 사용:  node scripts/migrate-attendance-fixed-schedule.js         (적용)
//        node scripts/migrate-attendance-fixed-schedule.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[attendance-fixed-schedule]', ...a);

const SCHED_SQL = `CREATE TABLE IF NOT EXISTS attendance_schedules (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NULL,
  effective_from DATE NOT NULL,
  mode VARCHAR(10) NOT NULL,
  schedule JSON NULL,
  grace_min INT NOT NULL DEFAULT 0,
  half_day_at DECIMAL(3,1) NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY att_sched_uniq (business_id, user_id, effective_from),
  KEY att_sched_biz_from (business_id, effective_from),
  CONSTRAINT att_sched_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const EXC_SQL = `CREATE TABLE IF NOT EXISTS attendance_exceptions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  work_date DATE NOT NULL,
  reason VARCHAR(300) NULL,
  reason_at DATETIME NULL,
  excused TINYINT(1) NOT NULL DEFAULT 0,
  excused_by INT NULL,
  excused_at DATETIME NULL,
  excuse_note VARCHAR(300) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY att_exc_uniq (business_id, user_id, work_date),
  CONSTRAINT att_exc_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function hasTable(t) {
  const [rows] = await sequelize.query('SHOW TABLES LIKE ?', { replacements: [t] });
  return rows.length > 0;
}

(async () => {
  try {
    const steps = [];
    if (!(await hasTable('attendance_schedules'))) steps.push(SCHED_SQL);
    if (!(await hasTable('attendance_exceptions'))) steps.push(EXC_SQL);
    if (!steps.length) { log('이미 있음 — 할 일 없음'); process.exit(0); }
    if (DRY) { log(`할 것 ${steps.length}개:\n` + steps.join(';\n')); process.exit(0); }
    for (const s of steps) { await sequelize.query(s); log('✓', s.split('\n')[0].slice(0, 90)); }
    const ok = (await hasTable('attendance_schedules')) && (await hasTable('attendance_exceptions'));
    log(ok ? '완료 ✓' : '실패 — 빠진 것이 있다');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('[attendance-fixed-schedule] 실패:', e.message);
    process.exit(1);
  }
})();
