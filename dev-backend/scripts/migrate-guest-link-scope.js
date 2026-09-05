#!/usr/bin/env node
// guest_links.scope 컬럼 추가 — 운영 ALTER (멱등).
//
//   docs/PROJECT_EXTERNAL_VIEW_DESIGN.md 1차. `sync-database.js` 에 맡기지 않는 이유:
//   그 스크립트는 모델에 없는 컬럼을 DROP 한 전례가 있고(memory feedback_sync_drops_columns_not_in_model),
//   ENUM 추가는 alter 한 번에 64키 제한에 걸린 전례가 있다(feedback_sync_alter_too_many_keys).
//
// ★ 기본값은 'conversation' 이다 — **이미 나가 있는 링크가 조용히 넓어지면 안 된다.**
//   기존 행은 전부 채팅 링크로 남고, 프로젝트 링크는 새로 발급해야만 생긴다.
//
// 사용:  node scripts/migrate-guest-link-scope.js          (적용)
//        node scripts/migrate-guest-link-scope.js --dry    (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');

(async () => {
  try {
    const [cols] = await sequelize.query(
      "SHOW COLUMNS FROM guest_links LIKE 'scope'"
    );
    if (cols.length > 0) {
      console.log('[guest-link-scope] 이미 있음 —', JSON.stringify(cols[0].Type), '· 하는 일 없음');
      const [dist] = await sequelize.query('SELECT scope, COUNT(*) n FROM guest_links GROUP BY scope');
      console.log('[guest-link-scope] 현재 분포:', JSON.stringify(dist));
      process.exit(0);
    }
    const sql = "ALTER TABLE guest_links ADD COLUMN scope ENUM('conversation','project') NOT NULL DEFAULT 'conversation' AFTER conversation_id";
    if (DRY) { console.log('[guest-link-scope] --dry:', sql); process.exit(0); }
    await sequelize.query(sql);
    const [after] = await sequelize.query("SHOW COLUMNS FROM guest_links LIKE 'scope'");
    const [dist] = await sequelize.query('SELECT scope, COUNT(*) n FROM guest_links GROUP BY scope');
    console.log('[guest-link-scope] 추가 완료 —', JSON.stringify(after[0]));
    console.log('[guest-link-scope] 기존 행 분포(전부 conversation 이어야 정상):', JSON.stringify(dist));
    process.exit(0);
  } catch (e) {
    console.error('[guest-link-scope] 실패:', e.message);
    process.exit(1);
  }
})();
