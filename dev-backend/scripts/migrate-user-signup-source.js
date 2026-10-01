// users.signup_source VARCHAR(80) NULL — 멱등. 2026-10-01 (가입 출처 기록).
//   기존 행은 NULL(기록 이전) — 백필 없음. 재조회로 판정하고 미충족이면 exit 1.
// ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 선언하므로 없으면 users 조회 전체가 500.
// 롤백: additive 컬럼이라 옛 코드에 무해. **코드만 되돌리고 컬럼은 남긴다**
//   (models/User.js 선언까지 되돌리면 sync 가 컬럼을 DROP 해 기록이 사라진다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'signup_source'`);
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query('ALTER TABLE users ADD COLUMN signup_source VARCHAR(80) NULL');
      console.log('[migrate-user-signup-source] signup_source 추가');
    } else console.log('[migrate-user-signup-source] signup_source 이미 있음 — skip');
    const t = await has();
    if (!t || !/varchar\(80\)/i.test(t)) { console.error('[migrate-user-signup-source] 검증 실패', t); process.exit(1); }
    console.log('[migrate-user-signup-source] OK', t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-user-signup-source] 실패:', e.message); process.exit(1); }
})();
