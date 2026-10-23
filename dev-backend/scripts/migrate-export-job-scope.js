// 워크스페이스 백업을 백그라운드 작업으로 — 스키마. 멱등. 2026-10-23 (docs/TRUST_SERVICES_DESIGN.md D3 · Fable 설계 PASS).
//   export_jobs.scope ENUM('me','workspace') NOT NULL DEFAULT 'me' — 옛 행은 전부 개인 내보내기(me).
// **코드 배포 전에** 실행한다 — 모델이 scope 를 SELECT 하므로 칸이 없으면 내보내기 화면·워커가 500 이다.
// 롤백: additive — 코드만 되돌리고 칸은 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function colType(table, col) {
  const [rows] = await sequelize.query(
    'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    { replacements: [table, col] });
  return rows[0] ? String(rows[0].COLUMN_TYPE) : null;
}

(async () => {
  try {
    if (!(await colType('export_jobs', 'id'))) throw new Error('export_jobs 없음');
    if (!(await colType('export_jobs', 'scope'))) {
      await sequelize.query("ALTER TABLE export_jobs ADD COLUMN scope ENUM('me','workspace') NOT NULL DEFAULT 'me' AFTER kind");
      console.log('[migrate-export-job-scope] scope 추가');
    } else console.log('[migrate-export-job-scope] scope 이미 있음 — skip');
    const after = await colType('export_jobs', 'scope');
    if (!after || !after.includes("'workspace'")) { console.error('[migrate-export-job-scope] 검증 실패'); process.exit(1); }
    console.log('[migrate-export-job-scope] OK');
    process.exit(0);
  } catch (e) {
    console.error('[migrate-export-job-scope] 실패:', e.message);
    process.exit(1);
  }
})();
