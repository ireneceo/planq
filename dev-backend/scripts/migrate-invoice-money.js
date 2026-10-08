// 0-B 청구 정합 마이그레이션 — 멱등(매 배포 실행 안전). docs/FIX_0AB_MONEY_DESIGN.md §4-1 (B-① · B-②)
//
//   ① invoices.total_amount / tax_amount / grand_total → DECIMAL(14,2)
//   ② invoice_items.unit_price / amount                → DECIMAL(14,2)
//   ③ invoice_number_counters 표 (business_id, year, last_no)
//   ④ 카운터 시드 — 워크스페이스×연도별 현재 MAX (GREATEST 로만 올린다)
//   ⑤ 같은 워크스페이스 안 번호 중복 사전 검사 — 있으면 중단(exit 1, 사람이 본다)
//   ⑥ UNIQUE (business_id, invoice_number) 'invoices_biz_invoice_number_unique'
//   ⑦ 비유니크 'invoices_invoice_number_idx' (검색용)
//   ⑧ 단일 UNIQUE 'invoice_number' · 'invoices_invoice_number_unique' DROP (⑥ 뒤에만)
//   ⑨ [verify]
//
//   운영은 코드 배포 **전에** 실행(deploy 슬롯). 롤백: 코드만(스키마는 넓히기만 했다 — 옛 코드와 호환).
//   사용: node scripts/migrate-invoice-money.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const TAG = '[migrate-invoice-money]';
const run = async (sql, label) => {
  if (DRY) { console.log(`${TAG} (dry) ${sql}`); return; }
  await sequelize.query(sql);
  console.log(`${TAG} ${label}`);
};
const col = async (table, column) => {
  const [r] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  return r[0] || null;
};
const indexNames = async (table) => {
  const [r] = await sequelize.query(`SHOW INDEX FROM \`${table}\``);
  return r;
};
async function widen(table, column) {
  const c = await col(table, column);
  if (!c) { console.log(`${TAG} ${table}.${column} 없음 — skip`); return; }
  if (String(c.Type).toLowerCase() === 'decimal(14,2)') { console.log(`${TAG} ${table}.${column} 이미 decimal(14,2) — skip`); return; }
  const nullClause = c.Null === 'NO' ? 'NOT NULL' : 'NULL';
  await run(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` DECIMAL(14,2) ${nullClause} DEFAULT 0.00`, `${table}.${column} ${c.Type} → decimal(14,2)`);
}
async function main() {
  // ①②
  for (const c of ['total_amount', 'tax_amount', 'grand_total']) await widen('invoices', c);
  for (const c of ['unit_price', 'amount']) await widen('invoice_items', c);

  // ③
  const [t] = await sequelize.query("SHOW TABLES LIKE 'invoice_number_counters'");
  if (!t.length) {
    await run('CREATE TABLE IF NOT EXISTS `invoice_number_counters` (`business_id` INT NOT NULL, `year` SMALLINT NOT NULL, `last_no` INT NOT NULL DEFAULT 0, PRIMARY KEY (`business_id`, `year`)) ENGINE=InnoDB', 'invoice_number_counters 생성');
  } else console.log(`${TAG} invoice_number_counters 이미 있음 — skip`);

  // ④
  const seedSql = "INSERT INTO `invoice_number_counters` (business_id, year, last_no) "
    + "SELECT business_id, CAST(SUBSTRING(invoice_number,5,4) AS UNSIGNED), MAX(CAST(SUBSTRING_INDEX(invoice_number,'-',-1) AS UNSIGNED)) "
    + "FROM invoices WHERE invoice_number REGEXP '^INV-[0-9]{4}-[0-9]+$' GROUP BY 1,2 "
    + 'ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no))';
  if (DRY && !t.length) console.log(`${TAG} (dry) ${seedSql}`);
  else await run(seedSql, '카운터 시드(GREATEST)');

  // ⑤
  const [dups] = await sequelize.query('SELECT business_id, invoice_number, COUNT(*) n FROM invoices GROUP BY business_id, invoice_number HAVING COUNT(*) > 1');
  if (dups.length) {
    console.error(`${TAG} ★ 같은 워크스페이스 안 번호 중복 ${dups.length}건 — 중단(사람이 본다):`, JSON.stringify(dups.slice(0, 20)));
    process.exit(1);
  }

  // ⑥⑦⑧
  let idx = await indexNames('invoices');
  const has = (name) => idx.some((r) => r.Key_name === name);
  if (!has('invoices_biz_invoice_number_unique')) await run('ALTER TABLE `invoices` ADD UNIQUE INDEX `invoices_biz_invoice_number_unique` (`business_id`, `invoice_number`)', 'UNIQUE(business_id, invoice_number) 추가');
  else console.log(`${TAG} invoices_biz_invoice_number_unique 이미 있음 — skip`);
  if (!has('invoices_invoice_number_idx')) await run('ALTER TABLE `invoices` ADD INDEX `invoices_invoice_number_idx` (`invoice_number`)', 'INDEX(invoice_number) 추가');
  else console.log(`${TAG} invoices_invoice_number_idx 이미 있음 — skip`);
  idx = await indexNames('invoices');
  const compositeOk = DRY || idx.some((r) => r.Key_name === 'invoices_biz_invoice_number_unique');
  for (const name of ['invoice_number', 'invoices_invoice_number_unique']) {
    const row = idx.find((r) => r.Key_name === name);
    if (!row) { console.log(`${TAG} 단일 UNIQUE ${name} 없음 — skip`); continue; }
    if (Number(row.Non_unique) !== 0) { console.log(`${TAG} ${name} 는 비유니크 — skip`); continue; }
    if (!compositeOk) { console.error(`${TAG} 복합 UNIQUE 가 없어 ${name} 를 지우지 않는다`); process.exit(1); }
    await run(`ALTER TABLE \`invoices\` DROP INDEX \`${name}\``, `단일 UNIQUE ${name} 제거`);
  }

  // ⑨
  for (const [tb, c] of [['invoices', 'total_amount'], ['invoices', 'tax_amount'], ['invoices', 'grand_total'], ['invoice_items', 'unit_price'], ['invoice_items', 'amount']]) {
    const x = await col(tb, c);
    console.log(`${TAG} [verify] ${tb}.${c} = ${x && x.Type}`);
  }
  if (!DRY || t.length) {
    const [[cnt]] = await sequelize.query('SELECT COUNT(*) n FROM invoice_number_counters');
    const [[grp]] = await sequelize.query("SELECT COUNT(*) n FROM (SELECT business_id, SUBSTRING(invoice_number,5,4) y FROM invoices WHERE invoice_number REGEXP '^INV-[0-9]{4}-[0-9]+$' GROUP BY 1,2) z");
    console.log(`${TAG} [verify] 카운터 행 ${cnt.n} · 워크스페이스×연도 ${grp.n}`);
    const [bad] = await sequelize.query("SELECT c.business_id, c.year, c.last_no, MAX(CAST(SUBSTRING_INDEX(i.invoice_number,'-',-1) AS UNSIGNED)) mx FROM invoice_number_counters c JOIN invoices i ON i.business_id=c.business_id AND i.invoice_number LIKE CONCAT('INV-', c.year, '-%') GROUP BY c.business_id, c.year, c.last_no HAVING c.last_no < mx");
    console.log(`${TAG} [verify] 카운터 < 실제 MAX: ${bad.length}건`);
  }
  idx = await indexNames('invoices');
  const uniq = [...new Set(idx.filter((r) => Number(r.Non_unique) === 0).map((r) => r.Key_name))];
  console.log(`${TAG} [verify] invoices UNIQUE 인덱스: ${uniq.join(', ')}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(`${TAG} 실패`, e.message); process.exit(1); });
