#!/usr/bin/env node
// 근태 출근 묻기·시각 수정 표시·관리자 확인 — 새 표 2개 + 새 칸 3개. 멱등(있으면 건너뛴다).
//
//   설계: docs/ATTENDANCE_CHECKIN_PROMPT_DESIGN.md §6.2
//
// ★ **코드 배포 전에** 돌린다 — 모델이 새 칸을 SELECT 하므로 없으면 근태·워크스페이스·사용자 조회가 500.
// ★ sync-database.js 에 맡기지 않는다(모델에 없는 컬럼 DROP 전례 — memory feedback_sync_drops_columns_not_in_model).
// ★ 표 만들기 + 칸 더하기뿐. 기존 행은 한 줄도 바꾸지 않는다.
//
// 사용:  node scripts/migrate-attendance-checkin.js         (적용)
//        node scripts/migrate-attendance-checkin.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[attendance-checkin]', ...a);

const FIX_SQL = `CREATE TABLE IF NOT EXISTS attendance_fix_requests (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  attendance_day_id INT NOT NULL,
  work_date DATE NOT NULL,
  origin VARCHAR(16) NOT NULL,
  \`before\` JSON NULL,
  events JSON NOT NULL,
  reason VARCHAR(300) NULL,
  status VARCHAR(16) NOT NULL,
  decided_by INT NULL,
  decided_at DATETIME NULL,
  decide_note VARCHAR(300) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY att_fix_biz_status (business_id, status, work_date),
  KEY att_fix_day (attendance_day_id),
  CONSTRAINT att_fix_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  CONSTRAINT att_fix_day_fk FOREIGN KEY (attendance_day_id) REFERENCES attendance_days(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ACT_SQL = `CREATE TABLE IF NOT EXISTS attendance_activity (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_id INT NOT NULL,
  user_id INT NOT NULL,
  work_date DATE NOT NULL,
  first_seen_at DATETIME NULL,
  last_act_at DATETIME NULL,
  prompt_answer VARCHAR(16) NULL,
  prompt_count INT NOT NULL DEFAULT 0,
  prompt_snooze_until DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY att_act_uniq (business_id, user_id, work_date),
  KEY att_act_date (work_date),
  CONSTRAINT att_act_business_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const COLS = [
  ['attendance_days', 'close_confirmed_at', 'DATETIME NULL'],
  ['businesses', 'attendance_fix_approval', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['users', 'attendance_prompt_on', 'TINYINT(1) NOT NULL DEFAULT 1'],
];

async function hasTable(t) {
  const [rows] = await sequelize.query('SHOW TABLES LIKE ?', { replacements: [t] });
  return rows.length > 0;
}
async function hasCol(table, col) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} WHERE Field = ?`, { replacements: [col] });
  return rows.length > 0;
}

(async () => {
  try {
    const steps = [];
    if (!(await hasTable('attendance_fix_requests'))) steps.push(FIX_SQL);
    if (!(await hasTable('attendance_activity'))) steps.push(ACT_SQL);
    for (const [t, c, def] of COLS) {
      if (!(await hasCol(t, c))) steps.push(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
    }
    if (!steps.length) { log('이미 있음 — 할 일 없음'); process.exit(0); }
    if (DRY) { log(`할 것 ${steps.length}개:\n` + steps.join(';\n')); process.exit(0); }
    for (const s of steps) { await sequelize.query(s); log('✓', s.split('\n')[0].slice(0, 90)); }
    let ok = (await hasTable('attendance_fix_requests')) && (await hasTable('attendance_activity'));
    for (const [t, c] of COLS) ok = ok && (await hasCol(t, c));
    log(ok ? '완료 ✓' : '실패 — 빠진 것이 있다');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('[attendance-checkin] 실패:', e.message);
    process.exit(1);
  }
})();
