// 휴지통 purge_after 백필 — 이 기능 **이전에** 삭제된 행에 그때 화면이 보여준 날짜를 박는다.
//   그때 사용자는 "30일 뒤 삭제" 라고 안내받았다. 그 약속을 지킨다(앞당기지 않는다).
//   기본 dry-run. --apply 필요. 멱등 — purge_after 가 이미 있으면 건너뛴다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const { LEGACY_TRASH_PROMISE_DAYS } = require('../services/retentionPolicy');

const APPLY = process.argv.includes('--apply');
const TABLES = ['files', 'posts', 'kb_documents'];

(async () => {
  const out = {};
  for (const t of TABLES) {
    // files 는 이미 영구삭제가 끝난 행(purged_at)은 건드리지 않는다.
    const extra = t === 'files' ? ' AND purged_at IS NULL' : '';
    const [rows] = await sequelize.query(
      `SELECT COUNT(*) AS c FROM ${t} WHERE deleted_at IS NOT NULL AND purge_after IS NULL${extra}`);
    out[t] = Number(rows[0]?.c || 0);
    if (APPLY && out[t] > 0) {
      await sequelize.query(
        `UPDATE ${t} SET purge_after = DATE_ADD(deleted_at, INTERVAL :d DAY)
          WHERE deleted_at IS NOT NULL AND purge_after IS NULL${extra}`,
        { replacements: { d: LEGACY_TRASH_PROMISE_DAYS } });
    }
  }
  console.log(APPLY ? '[backfill-trash] 적용' : '[backfill-trash] dry-run (--apply 필요)');
  console.log(JSON.stringify(out, null, 1), `(기준 ${LEGACY_TRASH_PROMISE_DAYS}일)`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
