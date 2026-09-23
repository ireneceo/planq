// subscriptions.bonus_months 추가 (멱등) — 2026-09-23 「지금 결제하면 1개월 추가」 선택지.
//   기존 행은 전부 0 = 보너스 없음(옛 구독의 기간 계산이 조용히 바뀌지 않는다).
//   ★ 코드 배포 **전에** 실행한다 — 컬럼이 없으면 markPaymentPaid 가 500 이 된다.
//   롤백: 컬럼을 두고 코드만 되돌리면 된다(읽는 곳이 없어지면 무해).
const { sequelize } = require('../config/database');

async function main() {
  const [cols] = await sequelize.query("SHOW COLUMNS FROM subscriptions LIKE 'bonus_months'");
  if (cols.length) {
    console.log('[skip] subscriptions.bonus_months 이미 있음');
  } else {
    await sequelize.query(
      'ALTER TABLE subscriptions ADD COLUMN bonus_months INT NOT NULL DEFAULT 0 AFTER currency'
    );
    console.log('[ok] subscriptions.bonus_months 추가');
  }
  const [[chk]] = await sequelize.query(
    'SELECT COUNT(*) total, SUM(bonus_months <> 0) nonzero FROM subscriptions'
  );
  console.log(`[verify] subscriptions ${chk.total}행 · bonus_months<>0 ${chk.nonzero || 0}행`);
  await sequelize.close();
}

main().catch((e) => { console.error('[fail]', e.message); process.exit(1); });
