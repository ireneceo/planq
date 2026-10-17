// platform_settings.gtm_container_id VARCHAR(20) NULL — 멱등. 2026-10-17 (랜딩 마케팅 측정, docs/MARKETING_TRACKING_DESIGN.md).
//   기존 행은 NULL = 꺼짐 — 백필 없음. 켜는 것은 플랫폼 관리자 > 플랫폼 설정에서 ID 입력(Irene 승인 뒤).
// ★ 순서: PM2 reload 보다 먼저 — 모델이 이 칸을 선언하므로 없으면 platform_settings 조회가 500.
// 롤백: additive 컬럼이라 옛 코드에 무해. 코드만 되돌리고 컬럼은 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'platform_settings' AND COLUMN_NAME = 'gtm_container_id'`);
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query('ALTER TABLE platform_settings ADD COLUMN gtm_container_id VARCHAR(20) NULL');
      console.log('[migrate-marketing-tags] gtm_container_id 추가');
    } else console.log('[migrate-marketing-tags] gtm_container_id 이미 있음 — skip');
    const t = await has();
    if (!t || !/varchar\(20\)/i.test(t)) { console.error('[migrate-marketing-tags] 검증 실패', t); process.exit(1); }
    console.log('[migrate-marketing-tags] OK', t);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-marketing-tags] 실패:', e.message); process.exit(1); }
})();
