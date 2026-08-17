// 결제 면제 스키마 마이그레이션 (운영 #275) — 멱등.
//
// businesses 7컬럼 + payments 2컬럼. 재실행하면 전부 skip 된다.
// sync-database.js 는 64키 한도 이슈가 있어(memory feedback_sync_alter_too_many_keys)
// 이 스크립트로 직접 ALTER 한다.
//
//   cd /opt/planq/dev-backend && node migrate-billing-exemption.js
//
// 설계: docs/BILLING_EXEMPTION_DESIGN.md
require('dotenv').config();
const { sequelize } = require('./config/database');

const COLS = [
  ['businesses', 'billing_exempt', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['businesses', 'billing_exempt_kind', "ENUM('internal','tester','partner') NULL DEFAULT NULL"],
  ['businesses', 'billing_exempt_plan', 'VARCHAR(32) NULL DEFAULT NULL'],
  ['businesses', 'billing_exempt_until', 'DATETIME NULL DEFAULT NULL'],
  ['businesses', 'billing_exempt_note', 'VARCHAR(255) NULL DEFAULT NULL'],
  ['businesses', 'billing_exempt_set_by', 'INT NULL DEFAULT NULL'],
  ['businesses', 'billing_exempt_set_at', 'DATETIME NULL DEFAULT NULL'],
  // is_revenue DEFAULT 1 / billing_exempt DEFAULT 0 이라 기존 행의 동작은 그대로다(롤백 안전).
  ['payments', 'is_revenue', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ['payments', 'cancel_reason', 'VARCHAR(255) NULL DEFAULT NULL'],
];

(async () => {
  const db = process.env.DB_NAME;
  let added = 0;
  for (const [table, col, ddl] of COLS) {
    const [rows] = await sequelize.query(
      'SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=:db AND TABLE_NAME=:t AND COLUMN_NAME=:c',
      { replacements: { db, t: table, c: col } }
    );
    if (Number(rows[0].n) > 0) { console.log(`skip   ${table}.${col}`); continue; }
    await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`);
    console.log(`ADDED  ${table}.${col}`);
    added += 1;
  }
  console.log(`\n완료 — 신규 ${added}개 / 전체 ${COLS.length}개`);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
