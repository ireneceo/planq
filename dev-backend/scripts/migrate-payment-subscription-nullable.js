// 추가 슬롯(애드온) 결제는 구독 없이 만든다 — payments.subscription_id 를 NULL 허용으로 맞춘다. 멱등(매 배포 실행 안전). 2026-11-15
//   원인: 운영 표가 옛 정의(NOT NULL) 그대로였다. 모델(models/Payment.js allowNull:true)·dev 는 NULL 허용이라 dev 에선 재현 안 됐다.
//   운영 실측 2026-11-15 07:18 UTC request 25269ba93fe6139f — POST /api/plan/21/addons/request 500
//   «Column 'subscription_id' cannot be null» (services/addonBilling.requestAddon Payment.create).
//   바꾸는 것은 «비워도 됨» 하나 — 칸 종류(COLUMN_TYPE)·외래키·색인·기존 값은 그대로다. 되돌리기 = NOT NULL 로 MODIFY(NULL 행이 0일 때만).
// 사용: node scripts/migrate-payment-subscription-nullable.js
require('dotenv').config();
const { sequelize } = require('../config/database');

const TAG = '[migrate-payment-subscription-nullable]';

async function column() {
  const [rows] = await sequelize.query(`
    SELECT IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'subscription_id'`);
  return rows[0] || null;
}

(async () => {
  try {
    const col = await column();
    if (!col) throw new Error('payments.subscription_id 칸이 없다');
    if (col.IS_NULLABLE === 'YES') {
      console.log(`${TAG} 이미 NULL 허용(${col.COLUMN_TYPE}) — 할 일 없음`);
    } else {
      // 칸 종류는 지금 값 그대로 쓴다(외래키 짝 subscriptions.id 와 어긋나지 않게).
      if (!/^(tiny|small|medium|big)?int( unsigned)?$/i.test(col.COLUMN_TYPE)) throw new Error(`예상 밖 칸 종류: ${col.COLUMN_TYPE}`);
      await sequelize.query(`ALTER TABLE payments MODIFY subscription_id ${col.COLUMN_TYPE} NULL DEFAULT NULL`);
      const after = await column();
      if (!after || after.IS_NULLABLE !== 'YES' || after.COLUMN_TYPE !== col.COLUMN_TYPE) throw new Error('NULL 허용으로 바꾸지 못했다');
      console.log(`${TAG} subscription_id NOT NULL → NULL 허용(${after.COLUMN_TYPE}) 완료`);
    }
    const [[c]] = await sequelize.query("SELECT COUNT(*) AS n FROM payments WHERE kind = 'addon'");
    console.log(`${TAG} 애드온 결제 행 ${c.n}`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    process.exit(1);
  }
})();
