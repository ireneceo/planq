// tasks.security_level ENUM('general','internal') NOT NULL DEFAULT 'general' — 멱등. 2026-10-12.
//   설계 docs/TASK_SECURITY_LEVEL_DESIGN.md (Fable). «내부 업무» = 프로젝트 고객·게스트·공개 링크에 안 보인다(멤버는 그대로).
//   기존 행은 전부 'general'(기본값) — 넓히지도 좁히지도 않는다. 재조회로 판정하고 미충족이면 exit 1.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/Task.js 선언까지 되돌리면 sync 가 컬럼을 DROP 해 내부 업무 표시가 사라진다 → 고객에게 다시 보인다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t, COLUMN_DEFAULT d, IS_NULLABLE n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'security_level'`);
  return r[0] || null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query("ALTER TABLE tasks ADD COLUMN security_level ENUM('general','internal') NOT NULL DEFAULT 'general' AFTER share_expires_at");
      console.log('[migrate-task-security-level] security_level 추가');
    } else console.log('[migrate-task-security-level] security_level 이미 있음 — skip');
    const c = await has();
    if (!c || !/'general'/.test(c.t) || !/'internal'/.test(c.t) || c.n !== 'NO' || String(c.d).replace(/'/g, '') !== 'general') {
      console.error('[migrate-task-security-level] 검증 실패', c); process.exit(1);
    }
    const [[{ n }]] = await sequelize.query("SELECT COUNT(*) n FROM tasks WHERE security_level IS NULL OR security_level = ''");
    if (Number(n) > 0) { console.error('[migrate-task-security-level] 빈 값 행', n); process.exit(1); }
    console.log('[migrate-task-security-level] OK', c.t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-task-security-level] 실패:', e.message); process.exit(1); }
})();
