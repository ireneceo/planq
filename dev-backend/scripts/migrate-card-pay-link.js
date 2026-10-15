// 청구서 외부 카드 결제 링크 + 카드 대금 받는 곳 — 컬럼 3개. 멱등(매 배포 실행 안전).
//
//   invoices.card_pay_url · invoice_installments.card_pay_url VARCHAR(500) NULL · businesses.card_payees JSON NULL
//
//   ★ 순서: PM2 reload 보다 먼저 — 세 모델이 이 칸을 SELECT 하므로 없으면 청구서·워크스페이스 조회가 500.
//   롤백: 코드 revert(새 컬럼 잔존은 무해).
//   사용: node scripts/migrate-card-pay-link.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const TAG = '[migrate-card-pay-link]';

const COLUMNS = [
  ['invoices', 'card_pay_url', 'VARCHAR(500) NULL'],
  ['invoice_installments', 'card_pay_url', 'VARCHAR(500) NULL'],
  ['businesses', 'card_payees', 'JSON NULL'],
];

async function main() {
  for (const [table, name, def] of COLUMNS) {
    const [r] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [name] });
    if (r[0]) { console.log(`${TAG} ${table}.${name} 이미 있음 — skip`); continue; }
    const sql = `ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${def}`;
    if (DRY) { console.log(`${TAG} (dry) ${sql}`); continue; }
    await sequelize.query(sql);
    console.log(`${TAG} ${table}.${name} 추가`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(TAG, e.message); process.exit(1); });
