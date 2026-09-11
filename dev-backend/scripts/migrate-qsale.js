// Q sale 사이클 1a 마이그레이션 — ENUM 끝 append 3건. 멱등 (매 배포 실행 안전). docs/Q_SALE_DESIGN.md §16 U2·U3
//
//   ① clients.status               + 'prospect'
//   ② notifications.event_kind      + 'sale'
//   ③ notification_prefs.event_kind + 'sale'
//
//   ★ 테이블마다 **지금 DB 의 Type 문자열** 끝에 붙인다. 한 목록을 두 테이블에 쓰지 않는다 —
//     두 알림 테이블은 값 순서가 다르다(share_expiry 위치). 공통 목록을 쓰면 순서 변경이 되고,
//     순서 변경은 메타데이터 변경이 아니라 테이블 복사다.
//   ★ NULL·DEFAULT 는 현 DDL 그대로(clients.status 는 NULL 허용). NULL→NOT NULL 은 INPLACE 로도
//     허용(재빌드)되니 ALGORITHM 옵션이 막아주지 않는다 — 여기서 절대 바꾸지 않는다.
//   ★ ALGORITHM=INPLACE, LOCK=NONE — 순서가 바뀌는 변경이면 MySQL 이 거부해 멈춘다(조용한 복사 차단).
//
//   배포 체인에서는 sync-database.js(alter) 가 이 스크립트보다 **먼저** 돈다. 모델 순서가 DB 와 같으면
//   sync 가 이미 append 를 끝내 이 스크립트는 no-op 이다(Fable 2026-09-11 실측). sync 는 실패를 삼키므로
//   이 스크립트가 백스톱이다. 운영은 코드 배포 **전에** `--dry` → 실행을 수동 선행한다.
//
//   롤백: 코드 revert 후 `UPDATE clients SET status='archived' WHERE status='prospect';`
//     (invited 로 돌리면 "초대됨" 라벨이 거짓이고 정식 고객 한도에 들어가 곧바로 한도 초과가 날 수 있다 — U7)
//     ENUM 원복 ALTER 는 선택 (새 값 잔존은 무해).
//
//   사용: node scripts/migrate-qsale.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TARGETS = [
  { table: 'clients', column: 'status', value: 'prospect' },
  { table: 'notifications', column: 'event_kind', value: 'sale' },
  { table: 'notification_prefs', column: 'event_kind', value: 'sale' },
];

function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

async function appendEnum({ table, column, value }) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  if (!rows.length) { console.log(`[migrate-qsale] ${table}.${column} 없음 — skip`); return false; }
  const col = rows[0];
  const values = parseEnum(col.Type);
  if (!values) throw new Error(`${table}.${column} 가 ENUM 이 아니다: ${col.Type}`);
  if (values.includes(value)) { console.log(`[migrate-qsale] ${table}.${column} 에 '${value}' 이미 있음 — skip`); return false; }

  const next = [...values, value].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'` : '';
  const sql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${next}) ${nullClause}${defClause}, ALGORITHM=INPLACE, LOCK=NONE`;
  if (DRY) { console.log(`[migrate-qsale] (dry) ${sql}`); return true; }
  await sequelize.query(sql);
  console.log(`[migrate-qsale] ${table}.${column} +'${value}' (${nullClause}${defClause})`);
  return true;
}

async function main() {
  let changed = 0;
  for (const t of TARGETS) if (await appendEnum(t)) changed += 1;
  const [dist] = await sequelize.query('SELECT status, COUNT(*) c FROM clients GROUP BY status ORDER BY c DESC');
  console.log('[migrate-qsale] clients.status 분포:', dist.map((r) => `${r.status}=${r.c}`).join(' '));
  console.log(changed === 0 ? '[migrate-qsale] 변경 0 (멱등 확인)' : `[migrate-qsale] ${DRY ? '변경 예정' : '변경'} ${changed}건`);
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
