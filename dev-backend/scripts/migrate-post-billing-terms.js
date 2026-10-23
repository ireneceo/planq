// 2026-10-23 문서 «청구 조건» (docs/CONTRACT_AUTO_INVOICE_DESIGN.md · Fable 설계) — 멱등. 백필 없음.
//
//   post_billing_terms 표 (CREATE TABLE IF NOT EXISTS) + UNIQUE(post_id) · UNIQUE(invoice_id) · idx business_id + FK post(CASCADE)
//   ★ 코드보다 먼저(배포 슬롯 PM2 reload 앞) — 문서 상세·서명 훅(services/contractBilling)이 이 표를 읽는다.
//   롤백: 코드 revert 만. 표 잔존은 무해.
//
//   사용: node scripts/migrate-post-billing-terms.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-post-billing-terms]';

async function main() {
  const [t] = await sequelize.query("SHOW TABLES LIKE 'post_billing_terms'");
  if (t.length) { console.log(`${TAG} post_billing_terms 이미 있음 — 변경 0 (멱등 확인)`); await sequelize.close(); return; }
  const sql = `CREATE TABLE IF NOT EXISTS post_billing_terms (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    post_id INT NOT NULL,
    client_id INT NULL,
    title VARCHAR(200) NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'KRW',
    vat_rate DECIMAL(4,3) NOT NULL DEFAULT 0.100,
    receipt_type ENUM('none','tax_invoice') NOT NULL DEFAULT 'none',
    items JSON NOT NULL,
    installment_mode ENUM('single','split') NOT NULL DEFAULT 'single',
    installments JSON NULL,
    notes TEXT NULL,
    invoice_id INT NULL,
    auto_error VARCHAR(40) NULL,
    auto_attempted_at DATETIME NULL,
    created_by INT NOT NULL,
    updated_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY post_billing_terms_post_id (post_id),
    UNIQUE KEY post_billing_terms_invoice_id (invoice_id),
    INDEX post_billing_terms_business_id (business_id),
    CONSTRAINT post_billing_terms_post_fk FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE post_billing_terms`); await sequelize.close(); return; }
  await sequelize.query(sql);
  const [v] = await sequelize.query("SHOW TABLES LIKE 'post_billing_terms'");
  if (!v.length) throw new Error('post_billing_terms 없음');
  console.log(`${TAG} post_billing_terms 생성 — 변경 1건`);
  await sequelize.close();
}

main().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* */ } process.exit(1); });
