// project_history_entries.client_visible TINYINT(1) NOT NULL DEFAULT 0 — 멱등. 2026-10-10.
//   docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-2·I-4 — 고객 프로젝트 링크의 «주요 이슈» 는 항목마다 사람이 켠 것만 나간다.
//   기존 행은 전부 0(꺼짐) — 이미 나간 링크가 조용히 넓어지지 않는다. 백필 없음.
// 롤백: 코드만 되돌리고 컬럼은 남긴다(모델 선언까지 되돌리면 sync 가 컬럼을 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t, COLUMN_DEFAULT d, IS_NULLABLE n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_history_entries' AND COLUMN_NAME = 'client_visible'`);
  return r[0] || null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query('ALTER TABLE project_history_entries ADD COLUMN client_visible TINYINT(1) NOT NULL DEFAULT 0 AFTER body');
      console.log('[migrate-history-entry-client-visible] client_visible 추가');
    } else console.log('[migrate-history-entry-client-visible] client_visible 이미 있음 — skip');
    const c = await has();
    if (!c || c.n !== 'NO' || String(c.d) !== '0') { console.error('[migrate-history-entry-client-visible] 검증 실패', c); process.exit(1); }
    const [[cnt]] = await sequelize.query('SELECT COUNT(*) total, SUM(client_visible) visible FROM project_history_entries');
    console.log('[migrate-history-entry-client-visible] OK', c.t, 'rows', cnt.total, 'visible', Number(cnt.visible || 0));
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-history-entry-client-visible] 실패:', e.message); process.exit(1); }
})();
