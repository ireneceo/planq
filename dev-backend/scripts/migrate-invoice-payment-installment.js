// migrate-invoice-payment-installment.js — invoice_payments.installment_id 추가 (멱등)
//   회차별 결제를 원장에 특정하기 위한 컬럼. 단일 invoice 결제는 NULL.
//   FK ON DELETE SET NULL — PUT 편집이 draft/canceled invoice 의 회차를 destroy/재생성하므로
//   회차가 사라져도 payment(받은 돈 기록)는 남아야 한다.
//   QBILL_PAYMENT_LEDGER_FIX.md D1.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function columnExists(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, col] });
  return r[0].c > 0;
}
async function fkExists(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) c FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: [table, col] });
  return r[0].c > 0;
}

(async () => {
  try {
    if (await columnExists('invoice_payments', 'installment_id')) {
      console.log('✓ invoice_payments.installment_id 이미 존재 — skip');
    } else {
      await sequelize.query(
        `ALTER TABLE invoice_payments
         ADD COLUMN installment_id INT NULL AFTER invoice_id,
         ADD INDEX idx_ip_installment (installment_id)`);
      console.log('✓ invoice_payments.installment_id 컬럼 + 인덱스 추가');
    }

    if (await fkExists('invoice_payments', 'installment_id')) {
      console.log('✓ installment_id FK 이미 존재 — skip');
    } else {
      await sequelize.query(
        `ALTER TABLE invoice_payments
         ADD CONSTRAINT fk_ip_installment FOREIGN KEY (installment_id)
         REFERENCES invoice_installments(id) ON DELETE SET NULL`);
      console.log('✓ installment_id FK (ON DELETE SET NULL) 추가');
    }

    const [cols] = await sequelize.query("SHOW COLUMNS FROM invoice_payments LIKE 'installment_id'");
    console.log('  확인:', cols[0] ? `${cols[0].Field} ${cols[0].Type} null=${cols[0].Null}` : 'MISSING');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('✗ 마이그레이션 실패:', e.message);
    process.exit(1);
  }
})();
