// 정기청구 멱등키 컬럼 + UNIQUE 추가 (멱등 — 이미 있으면 skip). 운영에도 배포 전 선행 실행.
require('dotenv').config();
const { sequelize } = require('./config/database');

(async () => {
  try {
    const [cols] = await sequelize.query("SHOW COLUMNS FROM invoices LIKE 'idempotency_key'");
    if (cols.length === 0) {
      await sequelize.query("ALTER TABLE invoices ADD COLUMN idempotency_key VARCHAR(100) NULL");
      console.log('✓ invoices.idempotency_key 컬럼 추가');
    } else console.log('- 컬럼 이미 존재 (skip)');

    const [idx] = await sequelize.query("SHOW INDEX FROM invoices WHERE Key_name='invoices_idempotency_key'");
    if (idx.length === 0) {
      await sequelize.query("ALTER TABLE invoices ADD UNIQUE KEY invoices_idempotency_key (idempotency_key)");
      console.log('✓ UNIQUE invoices_idempotency_key 추가');
    } else console.log('- UNIQUE 이미 존재 (skip)');

    const [chk] = await sequelize.query("SHOW COLUMNS FROM invoices LIKE 'idempotency_key'");
    console.log('최종:', JSON.stringify(chk[0]));
  } catch (e) {
    console.error('FAILED:', e.message); process.exitCode = 1;
  } finally { await sequelize.close(); }
})();
