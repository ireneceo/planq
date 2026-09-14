// platform_settings.stripe_card_enabled 추가 — 카드 결제 사용 스위치. (2026-09-15)
//   멱등: 이미 있으면 아무것도 하지 않는다. **코드 배포 전에** 돌린다(모델이 선언하므로 없으면 500).
//   기본 TRUE — 이 칸이 생기기 전 동작(키가 있으면 켜짐)을 그대로 유지한다.
const { sequelize } = require('../config/database');

(async () => {
  try {
    const [c] = await sequelize.query("SHOW COLUMNS FROM platform_settings LIKE 'stripe_card_enabled'");
    if (c.length) { console.log('· stripe_card_enabled 이미 있음 — 건너뜀'); process.exit(0); }
    await sequelize.query('ALTER TABLE platform_settings ADD COLUMN stripe_card_enabled TINYINT(1) NOT NULL DEFAULT 1');
    console.log('✓ platform_settings.stripe_card_enabled 추가 (기본 ON)');
    process.exit(0);
  } catch (e) { console.error('✗ 실패:', e.message); process.exit(1); }
})();
