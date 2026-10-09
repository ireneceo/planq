// 체험 중 결제 환불 요청 — payments 컬럼 6개. 멱등(매 배포 실행 안전). 설계 docs/TRIAL_REFUND_DESIGN.md §2
//
//   refund_requested_at · refund_requested_by · refund_request_note · refund_account_enc(암호문) ·
//   refund_kind ENUM('trial','manual') · stripe_refund_id
//
//   ★ 순서: PM2 reload 보다 먼저 — Payment 모델이 이 칸을 SELECT 하므로 없으면 결제 조회가 전부 500.
//   롤백: 코드 revert(새 컬럼 잔존은 무해).
//   사용: node scripts/migrate-trial-refund.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const TAG = '[migrate-trial-refund]';

const COLUMNS = [
  ['refund_requested_at', 'DATETIME NULL'],
  ['refund_requested_by', 'INT NULL'],
  ['refund_request_note', 'VARCHAR(255) NULL'],
  ['refund_account_enc', 'TEXT NULL'],
  ['refund_kind', "ENUM('trial','manual') NULL"],
  ['stripe_refund_id', 'VARCHAR(255) NULL'],
];

async function main() {
  for (const [name, def] of COLUMNS) {
    const [r] = await sequelize.query('SHOW COLUMNS FROM `payments` LIKE ?', { replacements: [name] });
    if (r[0]) { console.log(`${TAG} payments.${name} 이미 있음 — skip`); continue; }
    const sql = `ALTER TABLE \`payments\` ADD COLUMN \`${name}\` ${def}`;
    if (DRY) { console.log(`${TAG} (dry) ${sql}`); continue; }
    await sequelize.query(sql);
    console.log(`${TAG} payments.${name} 추가`);
  }
  const [idx] = await sequelize.query("SHOW INDEX FROM `payments` WHERE Key_name = 'idx_payments_refund_requested'");
  if (!idx.length) {
    const sql = 'ALTER TABLE `payments` ADD INDEX `idx_payments_refund_requested` (`refund_requested_at`)';
    if (DRY) console.log(`${TAG} (dry) ${sql}`);
    else { await sequelize.query(sql); console.log(`${TAG} 인덱스 추가`); }
  } else console.log(`${TAG} 인덱스 이미 있음 — skip`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(TAG, e.message); process.exit(1); });
