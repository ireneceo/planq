// 이미지 보안 Stage 2a 킬스위치 컬럼 — platform_settings.image_gate_l1_off_until (DATETIME NULL). 멱등. 2026-09-24.
//   NULL = 게이트 켬. 코드는 컬럼이 없어도 **켬**으로 동작하므로 배포 순서 제약은 없다(있으면 끌 수 있을 뿐).
//   롤백: additive — 코드만 되돌리고 컬럼은 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');
(async () => {
  try {
    const [rows] = await sequelize.query(
      `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'platform_settings' AND COLUMN_NAME = 'image_gate_l1_off_until'`);
    if (rows.length) console.log('[migrate-image-gate-flag] 이미 있음 — skip');
    else {
      await sequelize.query('ALTER TABLE platform_settings ADD COLUMN image_gate_l1_off_until DATETIME NULL DEFAULT NULL');
      console.log('[migrate-image-gate-flag] 컬럼 추가');
    }
    const [again] = await sequelize.query(
      `SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'platform_settings' AND COLUMN_NAME = 'image_gate_l1_off_until'`);
    if (Number(again[0].n) !== 1) { console.error('[migrate-image-gate-flag] 확인 실패'); process.exit(1); }
    process.exit(0);
  } catch (e) { console.error('[migrate-image-gate-flag]', e.message); process.exit(1); }
})();
