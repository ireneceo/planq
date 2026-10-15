// 급여·계약 관리 (docs/PAYROLL_DESIGN.md §3) — 표 만들기 + businesses.modules 칸.
//   멱등: 표는 SHOW TABLES 로, 칸은 SHOW COLUMNS 로 먼저 본다. 여러 번 돌려도 변경 0.
//   ★ 코드보다 먼저 돈다(배포 슬롯 — PM2 reload 전). 모델이 businesses.modules 를 SELECT 한다.
//   단계: P1 = payroll_people · employment_contracts · pay_items · contract_pay_lines + businesses.modules.
//         P2~P4 의 표(회차·줄·이력)·알림 ENUM 은 그 단계에서 이 파일에 더한다(같은 파일, 같은 슬롯).
//   롤백: 코드 revert 만(새 표·새 칸이 남아도 무해). 백필 없음.
//   사용: node scripts/migrate-payroll.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const TAG = '[migrate-payroll]';
const TAIL = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const TABLES = [
  ['payroll_people', `CREATE TABLE IF NOT EXISTS payroll_people (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    user_id INT NULL,
    display_name VARCHAR(100) NOT NULL,
    employee_no VARCHAR(30) NULL,
    email VARCHAR(255) NULL,
    income_kind ENUM('employment','business','other') NOT NULL DEFAULT 'employment',
    hired_on DATE NULL,
    left_on DATE NULL,
    job_title VARCHAR(100) NULL,
    department_id INT NULL,
    bank_name VARCHAR(60) NULL,
    bank_account_enc TEXT NULL,
    status ENUM('active','left') NOT NULL DEFAULT 'active',
    note VARCHAR(500) NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_payroll_people_user (business_id, user_id),
    UNIQUE KEY uq_payroll_people_empno (business_id, employee_no),
    INDEX idx_payroll_people_status (business_id, status),
    INDEX idx_payroll_people_name (business_id, display_name),
    CONSTRAINT payroll_people_biz_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ${TAIL}`],
  ['employment_contracts', `CREATE TABLE IF NOT EXISTS employment_contracts (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    person_id INT NOT NULL,
    kind ENUM('regular','fixed_term','freelance') NOT NULL DEFAULT 'regular',
    start_date DATE NOT NULL,
    end_date DATE NULL,
    weekly_work_days TINYINT NULL,
    daily_work_hours DECIMAL(4,1) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'KRW',
    pay_day TINYINT NULL,
    post_id BIGINT NULL,
    signed_at DATETIME NULL,
    status ENUM('draft','active','ended','superseded') NOT NULL DEFAULT 'draft',
    note VARCHAR(500) NULL,
    created_by INT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_contracts_person (business_id, person_id, start_date),
    INDEX idx_contracts_status (business_id, status),
    INDEX idx_contracts_post (post_id),
    CONSTRAINT employment_contracts_person_fk FOREIGN KEY (person_id) REFERENCES payroll_people(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ${TAIL}`],
  ['pay_items', `CREATE TABLE IF NOT EXISTS pay_items (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NULL,
    side ENUM('earning','deduction') NOT NULL,
    taxable TINYINT(1) NOT NULL DEFAULT 1,
    calc ENUM('fixed','rate','manual','external','unpaid_leave') NOT NULL DEFAULT 'fixed',
    rate DECIMAL(8,5) NULL,
    rate_base ENUM('taxable_total','gross_total','item') NULL,
    base_item_id INT NULL,
    sign ENUM('plus','minus') NOT NULL DEFAULT 'plus',
    in_total TINYINT(1) NOT NULL DEFAULT 1,
    is_settlement TINYINT(1) NOT NULL DEFAULT 0,
    is_statutory TINYINT(1) NOT NULL DEFAULT 0,
    rounding ENUM('round','floor','ceil') NOT NULL DEFAULT 'round',
    rounding_unit INT NOT NULL DEFAULT 1,
    aliases JSON NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    preset_source VARCHAR(20) NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_pay_items_code (business_id, code),
    INDEX idx_pay_items_active (business_id, is_active, sort_order),
    CONSTRAINT pay_items_biz_fk FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE ON UPDATE CASCADE
  ) ${TAIL}`],
  ['contract_pay_lines', `CREATE TABLE IF NOT EXISTS contract_pay_lines (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    business_id INT NOT NULL,
    contract_id INT NOT NULL,
    pay_item_id INT NOT NULL,
    amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY uq_contract_pay_lines (contract_id, pay_item_id),
    INDEX idx_contract_pay_lines_biz (business_id),
    CONSTRAINT contract_pay_lines_contract_fk FOREIGN KEY (contract_id) REFERENCES employment_contracts(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT contract_pay_lines_item_fk FOREIGN KEY (pay_item_id) REFERENCES pay_items(id) ON DELETE RESTRICT ON UPDATE CASCADE
  ) ${TAIL}`],
];

async function ensureTable(name, sql) {
  const [t] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
  if (t.length) { console.log(`${TAG} ${name} 이미 있음 — skip`); return false; }
  if (DRY) { console.log(`${TAG} (dry) CREATE TABLE ${name}`); return true; }
  await sequelize.query(sql);
  console.log(`${TAG} CREATE TABLE ${name}`);
  return true;
}

async function ensureModulesColumn() {
  const [c] = await sequelize.query("SHOW COLUMNS FROM businesses LIKE 'modules'");
  if (c.length) { console.log(`${TAG} businesses.modules 이미 있음 — skip`); return false; }
  if (DRY) { console.log(`${TAG} (dry) ALTER TABLE businesses ADD COLUMN modules JSON NULL`); return true; }
  await sequelize.query('ALTER TABLE businesses ADD COLUMN modules JSON NULL');
  console.log(`${TAG} ALTER TABLE businesses ADD COLUMN modules`);
  return true;
}

async function verify() {
  for (const [name] of TABLES) {
    const [t] = await sequelize.query(`SHOW TABLES LIKE '${name}'`);
    if (!t.length) throw new Error(`${TAG} 검증 실패 — ${name} 없음`);
  }
  const [c] = await sequelize.query("SHOW COLUMNS FROM businesses LIKE 'modules'");
  if (!c.length) throw new Error(`${TAG} 검증 실패 — businesses.modules 없음`);
}

async function main() {
  let changed = 0;
  if (await ensureModulesColumn()) changed += 1;
  for (const [name, sql] of TABLES) if (await ensureTable(name, sql)) changed += 1;
  if (!DRY) await verify();
  console.log(changed === 0 ? `${TAG} 변경 0 (멱등 확인)` : `${TAG} ${DRY ? '변경 예정' : '변경'} ${changed}건`);
  await sequelize.close();
}

main().catch(async (e) => { console.error(e); try { await sequelize.close(); } catch { /* noop */ } process.exit(1); });
