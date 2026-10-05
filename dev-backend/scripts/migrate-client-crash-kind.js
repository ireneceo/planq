// 2026-10-05 — 화면 크래시 관리자 알림(services/clientCrashAlert): event_kind ENUM 끝 append 2건. 멱등.
//
//   ① notifications.event_kind      + 'client_crash'
//   ② notification_prefs.event_kind + 'client_crash'
//
//   ★ 테이블마다 **지금 DB 의 Type 문자열** 끝에 붙인다 — 두 알림 테이블은 값 순서가 다르다(share_expiry).
//   ★ ALGORITHM=INPLACE, LOCK=NONE — 순서가 바뀌는 변경이면 MySQL 이 거부해 멈춘다(조용한 복사 차단).
//   ★ **코드보다 먼저 돈다** — 관리자가 설정에서 이 항목을 끄면 prefs 행을 쓰는데, ENUM 에 없으면 500 이다.
//     (발송 쪽 isAllowed 는 조회 실패를 «허용» 으로 삼켜 멈추지 않는다.)
//   롤백: 코드 revert 만. 새 값 잔존은 무해.
//
//   사용: node scripts/migrate-client-crash-kind.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TARGETS = [
  { table: 'notifications', column: 'event_kind', value: 'client_crash' },
  { table: 'notification_prefs', column: 'event_kind', value: 'client_crash' },
];

function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

async function appendEnum({ table, column, value }) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  if (!rows.length) { console.log(`[migrate-client-crash-kind] ${table}.${column} 없음 — skip`); return false; }
  const col = rows[0];
  const values = parseEnum(col.Type);
  if (!values) throw new Error(`${table}.${column} 가 ENUM 이 아니다: ${col.Type}`);
  if (values.includes(value)) { console.log(`[migrate-client-crash-kind] ${table}.${column} 에 '${value}' 이미 있음 — skip`); return false; }

  const next = [...values, value].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'` : '';
  const sql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${next}) ${nullClause}${defClause}, ALGORITHM=INPLACE, LOCK=NONE`;
  if (DRY) { console.log(`[migrate-client-crash-kind] (dry) ${sql}`); return true; }
  await sequelize.query(sql);
  console.log(`[migrate-client-crash-kind] ${table}.${column} +'${value}' (${nullClause}${defClause})`);
  return true;
}

async function main() {
  let changed = 0;
  for (const t of TARGETS) if (await appendEnum(t)) changed += 1;
  console.log(changed === 0 ? '[migrate-client-crash-kind] 변경 0 (멱등 확인)' : `[migrate-client-crash-kind] ${DRY ? '변경 예정' : '변경'} ${changed}건`);
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
