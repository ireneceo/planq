// 2026-10-22 근태 자정 분할 (docs/ATTENDANCE_MIDNIGHT_SPLIT_DESIGN.md) — 멱등.
//
//   attendance_events.source ENUM 끝에 'auto_midnight' append.
//   ★ **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — 없으면 자정 분할 INSERT 가 500.
//   백필 없음. 롤백: 코드 revert 만(ENUM 값이 남아도 옛 코드가 읽는 데 지장 없다).
//
//   사용: node scripts/migrate-attendance-midnight.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-attendance-midnight]';

function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

async function main() {
  const [rows] = await sequelize.query("SHOW COLUMNS FROM `attendance_events` LIKE 'source'");
  if (!rows.length) { console.log(`${TAG} attendance_events.source 없음 — skip`); return; }
  const col = rows[0];
  const values = parseEnum(col.Type);
  if (!values) throw new Error(`attendance_events.source 가 ENUM 이 아니다: ${col.Type}`);
  if (values.includes('auto_midnight')) { console.log(`${TAG} 'auto_midnight' 이미 있음 — skip`); return; }
  const next = [...values, 'auto_midnight'].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'` : '';
  const sql = `ALTER TABLE \`attendance_events\` MODIFY COLUMN \`source\` ENUM(${next}) ${nullClause}${defClause}, ALGORITHM=INPLACE, LOCK=NONE`;
  if (DRY) { console.log(`${TAG} (dry) ${sql}`); return; }
  await sequelize.query(sql);
  console.log(`${TAG} attendance_events.source +'auto_midnight'`);
}

main()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error(`${TAG} 실패:`, e.message); await sequelize.close().catch(() => null); process.exit(1); });
