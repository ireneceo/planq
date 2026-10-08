// 0-A 돈·구독 마이그레이션 — 멱등(매 배포 실행 안전). docs/FIX_0AB_MONEY_DESIGN.md §4-2 (A-③ · A-④)
//
//   ① businesses.scheduled_plan 없으면 ADD (dev 는 phase0 sync 로 이미 있다 — fail-safe)
//   ② payments.line_items JSON NULL 없으면 ADD
//   ③ [verify] 두 컬럼 Type · 고아 pending 수(정보용 — 데이터는 바꾸지 않는다)
//
//   운영은 코드 배포 **전에** 실행(deploy 슬롯 — 모델이 line_items 를 선언하므로 없으면 결제 조회 500).
//   롤백: 코드만(컬럼 잔존은 무해). 사용: node scripts/migrate-billing-0a.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const TAG = '[migrate-billing-0a]';
const run = async (sql, label) => {
  if (DRY) { console.log(`${TAG} (dry) ${sql}`); return; }
  await sequelize.query(sql);
  console.log(`${TAG} ${label}`);
};
const col = async (table, column) => {
  const [r] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  return r[0] || null;
};
async function main() {
  if (!(await col('businesses', 'scheduled_plan'))) {
    const after = (await col('businesses', 'grace_ends_at')) ? ' AFTER `grace_ends_at`' : '';
    await run(`ALTER TABLE \`businesses\` ADD COLUMN \`scheduled_plan\` ENUM('free','starter','basic','pro','enterprise') NULL${after}`, 'businesses.scheduled_plan 추가');
  } else console.log(`${TAG} businesses.scheduled_plan 이미 있음 — skip`);

  if (!(await col('payments', 'line_items'))) {
    const after = (await col('payments', 'currency')) ? ' AFTER `currency`' : '';
    await run(`ALTER TABLE \`payments\` ADD COLUMN \`line_items\` JSON NULL${after}`, 'payments.line_items 추가');
  } else console.log(`${TAG} payments.line_items 이미 있음 — skip`);

  const sp = await col('businesses', 'scheduled_plan');
  const li = await col('payments', 'line_items');
  console.log(`${TAG} [verify] businesses.scheduled_plan = ${sp ? sp.Type : '(없음)'}`);
  console.log(`${TAG} [verify] payments.line_items = ${li ? li.Type : '(없음)'}`);
  const [[orph]] = await sequelize.query(
    "SELECT COUNT(*) n FROM payments p JOIN subscriptions s ON s.id = p.subscription_id "
    + "WHERE p.kind = 'plan' AND p.status = 'pending' AND s.status = 'canceled'",
  );
  console.log(`${TAG} [verify] 고아 pending(잠금 canceled 구독에 매달린 플랜 결제) ${orph.n}건 — 정보용, 데이터 무변경`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(`${TAG} 실패`, e.message); process.exit(1); });
