// Q Bill · 리포트 Phase 0 DB 스키마 확장 직후 실행 — 기존 데이터 기본값 채우기.
// Sequelize `sync({alter:true})` 는 기존 row 에 DEFAULT 값을 적용하지 않으므로 수동 UPDATE 필요.
//
// 실행 시점:
//   1. 모델 파일에 신규 컬럼 추가
//   2. `node sync-database.js` 로 ALTER TABLE 적용
//   3. 이 스크립트 실행 (멱등 — 여러 번 돌려도 안전)
//
// 사용: cd /opt/planq/dev-backend && node scripts/qbill-phase0-backfill.js

require('dotenv').config();
const { sequelize } = require('../config/database');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('MySQL connected.');

    // 1. businesses.permissions — PERMISSION_MATRIX §4 기본값 "all" 3축
    const defaultPerms = JSON.stringify({ financial: 'all', schedule: 'all', client_info: 'all' });
    const [, r1] = await sequelize.query(
      `UPDATE businesses SET permissions = :p WHERE permissions IS NULL`,
      { replacements: { p: defaultPerms } }
    );
    console.log(`[1] businesses.permissions backfilled: ${r1.affectedRows ?? r1} rows`);

    // 2. businesses.default_vat_rate — 국내 10%
    const [, r2] = await sequelize.query(
      `UPDATE businesses SET default_vat_rate = 0.100 WHERE default_vat_rate IS NULL`
    );
    console.log(`[2] businesses.default_vat_rate: ${r2.affectedRows ?? r2} rows`);

    // 3. clients.country = 'KR' (기존 데이터는 모두 국내 가정)
    const [, r3] = await sequelize.query(
      `UPDATE clients SET country = 'KR' WHERE country IS NULL`
    );
    console.log(`[3] clients.country='KR': ${r3.affectedRows ?? r3} rows`);

    // 4. clients.is_business = false (개인 가정, 이후 개별 편집)
    const [, r4] = await sequelize.query(
      `UPDATE clients SET is_business = 0 WHERE is_business IS NULL`
    );
    console.log(`[4] clients.is_business=false: ${r4.affectedRows ?? r4} rows`);

    // 5. projects.billing_type = 'fixed' (기본)
    const [, r5] = await sequelize.query(
      `UPDATE projects SET billing_type = 'fixed' WHERE billing_type IS NULL`
    );
    console.log(`[5] projects.billing_type='fixed': ${r5.affectedRows ?? r5} rows`);

    // 6. project_members.is_pm = false (명시적)
    const [, r6] = await sequelize.query(
      `UPDATE project_members SET is_pm = 0 WHERE is_pm IS NULL`
    );
    console.log(`[6] project_members.is_pm=false: ${r6.affectedRows ?? r6} rows`);

    // 7. 기존 프로젝트 owner_user_id 를 자동 PM 으로 승격 (PERMISSION_MATRIX §3.2)
    //    — 생성자는 자동 PM 규칙. 기존 데이터도 동일하게 적용.
    const [, r7] = await sequelize.query(
      `UPDATE project_members pm
       INNER JOIN projects p ON p.id = pm.project_id
       SET pm.is_pm = 1
       WHERE pm.user_id = p.owner_user_id AND pm.is_pm = 0`
    );
    console.log(`[7] owner 자동 PM 승격: ${r7.affectedRows ?? r7} rows`);

    // 8. invoices.currency = 'KRW' (기본)
    const [, r8] = await sequelize.query(
      `UPDATE invoices SET currency = 'KRW' WHERE currency IS NULL`
    );
    console.log(`[8] invoices.currency='KRW': ${r8.affectedRows ?? r8} rows`);

    // 9. invoices.tax_invoice_status = 'none' (기본)
    const [, r9] = await sequelize.query(
      `UPDATE invoices SET tax_invoice_status = 'none' WHERE tax_invoice_status IS NULL`
    );
    console.log(`[9] invoices.tax_invoice_status='none': ${r9.affectedRows ?? r9} rows`);

    // 10. invoices.paid_amount = 0 (기본)
    const [, r10] = await sequelize.query(
      `UPDATE invoices SET paid_amount = 0 WHERE paid_amount IS NULL`
    );
    console.log(`[10] invoices.paid_amount=0: ${r10.affectedRows ?? r10} rows`);

    // 11. invoices.vat_rate = 0.100 (국내 기본)
    const [, r11] = await sequelize.query(
      `UPDATE invoices SET vat_rate = 0.100 WHERE vat_rate IS NULL`
    );
    console.log(`[11] invoices.vat_rate=0.100: ${r11.affectedRows ?? r11} rows`);

    console.log('\n✓ Q Bill Phase 0 backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  }
}

run();
