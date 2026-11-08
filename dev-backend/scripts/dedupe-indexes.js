// 같은 인덱스 중복 보기·정리 (2026-11-08) — 규칙·이유는 utils/dedupeIndexes.js 머리말.
//   node scripts/dedupe-indexes.js          → 읽기만: 표별 지울 개수와 64개 상한에 닿은 표
//   node scripts/dedupe-indexes.js --apply  → 중복만 DROP INDEX (같은 정의 하나는 반드시 남는다)
//   sync-database.js 가 alter 뒤에 같은 함수를 --apply 로 부른다(배포마다 다시 쌓이는 것을 그 자리에서 걷는다).
require('dotenv').config({ quiet: true });
const { sequelize } = require('../config/database');
const models = require('../models');
const { dropDuplicateIndexes, declaredIndexNames } = require('../utils/dedupeIndexes');

(async () => {
  const apply = process.argv.includes('--apply');
  const [cnt] = await sequelize.query(
    `SELECT TABLE_NAME AS t, COUNT(DISTINCT INDEX_NAME) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME HAVING n >= 60 ORDER BY n DESC`,
  );
  const r = await dropDuplicateIndexes(sequelize, { apply, keepNames: declaredIndexNames(models) });
  const per = {};
  for (const d of r.drops) per[d.table] = (per[d.table] || 0) + 1;
  console.log(`[dedupe-indexes] ${apply ? 'APPLY' : 'DRY-RUN'} 중복 ${r.drops.length}개 · 표 ${Object.keys(per).length}개`);
  for (const [t, n] of Object.entries(per).sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);
  if (cnt.length) console.log('  상한(64) 근처 표:', cnt.map((x) => `${x.t}=${x.n}`).join(' '));
  if (apply) console.log(`[dedupe-indexes] 지움 ${r.dropped} · 실패 ${r.failed.length}`, r.failed.slice(0, 5));
  process.exit(r.failed.length ? 1 : 0);
})().catch((e) => { console.error('[dedupe-indexes] 실패', e.message); process.exit(1); });
