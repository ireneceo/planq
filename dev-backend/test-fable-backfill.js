// Fable 검증 — backfill-recurring-receipt-type.js: dry-run 기본 · 멱등 · updated_at 보존 · 제외 조건
require('dotenv').config({ quiet: true });
const cp = require('child_process');
const { sequelize } = require('./config/database');
const { Client, Invoice } = require('./models');

const BIZ = 5, OWNER = 5;
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
}
const createdClients = [];
const createdInvoices = [];
const OLD_TS = '2026-01-15 09:00:00';

async function snap() {
  const [rows] = await sequelize.query(
    `SELECT id, invoice_number, receipt_type, tax_invoice_status, updated_at FROM invoices WHERE id IN (${createdInvoices.join(',')}) ORDER BY id`);
  return rows;
}
function run(args) {
  const out = cp.execSync(`node scripts/backfill-recurring-receipt-type.js ${args || ''} 2>&1`, { cwd: __dirname }).toString();
  return out;
}

(async () => {
  const krBiz = await Client.create({ business_id: BIZ, created_by: OWNER, display_name: 'FABLEV-BF KR사업자', biz_name: 'FABLEV-BF 주식회사', is_business: true, country: 'KR' });
  const indiv = await Client.create({ business_id: BIZ, created_by: OWNER, display_name: 'FABLEV-BF 개인', is_business: false, country: 'KR' });
  createdClients.push(krBiz.id, indiv.id);

  let n = 0;
  const mkInv = async (attrs) => {
    n += 1;
    const inv = await Invoice.create({
      business_id: BIZ, client_id: krBiz.id, invoice_number: `FBF-${Date.now() % 10000000}-${n}`,
      title: `FABLEV-BF ${n}`, created_by: OWNER, status: 'sent', currency: 'KRW',
      subtotal: 10000, tax_amount: 1000, grand_total: 11000, total_amount: 10000,
      vat_rate: 0.1, installment_mode: 'single', due_date: '2026-08-20',
      receipt_type: 'none', tax_invoice_status: 'none',
      ...attrs,
    });
    createdInvoices.push(inv.id);
    return inv;
  };
  const i1 = await mkInv({ idempotency_key: `proj:999901:2026-0${n}` });                       // 대상 (KR사업자·KRW·미발행)
  const i2 = await mkInv({ idempotency_key: `sub:999902:2026-01-0${n}` });                     // 대상 (sub 접두)
  const i3 = await mkInv({ idempotency_key: `proj:999903:2026-0${n}`, client_id: indiv.id });  // 술어 미충족 (개인)
  const i4 = await mkInv({ idempotency_key: `proj:999904:2026-0${n}`, currency: 'USD' });      // 술어 미충족 (외화)
  const i5 = await mkInv({ idempotency_key: `proj:999905:2026-0${n}`, status: 'canceled' });   // 제외 (취소)
  const i6 = await mkInv({ idempotency_key: `proj:999906:2026-0${n}`, tax_invoice_status: 'issued' }); // 제외 (발행완료)
  const i7 = await mkInv({ idempotency_key: `proj:999907:2026-0${n}`, tax_invoice_external_id: 'EXT-123' }); // 제외 (외부 발행번호)
  const i8 = await mkInv({ idempotency_key: null });                                           // 제외 (정기 아님 — 수동)

  // updated_at 을 과거로 고정 (보존 검증용)
  await sequelize.query(`UPDATE invoices SET updated_at = '${OLD_TS}' WHERE id IN (${createdInvoices.join(',')})`);

  const before = await snap();

  // ── 1) dry-run 기본 (인자 없음) → DB 무변경 ──
  const dryOut = run('');
  console.log('--- dry-run 출력 ---\n' + dryOut.split('\n').filter((l) => l.includes('FABLEV') || l.includes('===') || l.includes('후보') || l.includes('대상')).join('\n'));
  const afterDry = await snap();
  check('dry-run 기본 — DB 무변경', JSON.stringify(before) === JSON.stringify(afterDry));
  check('dry-run 이 대상을 정확히 식별(2건 예정)', (dryOut.match(/예정 FBF/g) || []).length === 2);

  // ── 2) apply ──
  const applyOut = run('--apply');
  const afterApply = await snap();
  const byId = Object.fromEntries(afterApply.map((r) => [r.id, r]));
  check('apply: proj 대상 갱신', byId[i1.id].receipt_type === 'tax_invoice' && byId[i1.id].tax_invoice_status === 'pending',
    `i1=${byId[i1.id].receipt_type}/${byId[i1.id].tax_invoice_status}`);
  check('apply: sub 대상 갱신', byId[i2.id].receipt_type === 'tax_invoice' && byId[i2.id].tax_invoice_status === 'pending');
  check('apply: 개인 미변경', byId[i3.id].receipt_type === 'none' && byId[i3.id].tax_invoice_status === 'none');
  check('apply: 외화 미변경', byId[i4.id].receipt_type === 'none');
  check('apply: 취소건 미변경', byId[i5.id].receipt_type === 'none');
  check('apply: issued 미변경', byId[i6.id].tax_invoice_status === 'issued' && byId[i6.id].receipt_type === 'none');
  check('apply: 외부발행번호 미변경', byId[i7.id].receipt_type === 'none');
  check('apply: 수동(비정기) 미변경', byId[i8.id].receipt_type === 'none');
  const tsOk = afterApply.every((r) => new Date(r.updated_at).getTime() === new Date(OLD_TS + 'Z').getTime()
    || new Date(r.updated_at).toISOString().startsWith('2026-01-15'));
  check('apply: updated_at 보존 (silent)', tsOk, JSON.stringify(afterApply.map((r) => [r.id, r.updated_at])));

  // ── 3) 멱등 — 재실행 시 변경 0 ──
  const reOut = run('--apply');
  const afterRe = await snap();
  const reTargets = (reOut.match(/적용 FBF/g) || []).length;
  check('멱등: 재실행 대상 0건', reTargets === 0, `재실행 적용 줄=${reTargets}`);
  check('멱등: 재실행 후 DB 동일', JSON.stringify(afterApply) === JSON.stringify(afterRe));

  // ── 정리 ──
  await sequelize.query(`DELETE FROM invoices WHERE id IN (${createdInvoices.join(',')})`);
  await sequelize.query(`DELETE FROM clients WHERE id IN (${createdClients.join(',')})`);
  const [[a]] = await sequelize.query(`SELECT COUNT(*) n FROM invoices WHERE invoice_number LIKE 'FBF-%'`);
  const [[b]] = await sequelize.query(`SELECT COUNT(*) n FROM clients WHERE display_name LIKE 'FABLEV-BF%'`);
  console.log(`\n원복 확인: invoices 잔존=${a.n} clients 잔존=${b.n}`);

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  await sequelize.close();
  process.exit(fails.length || a.n > 0 || b.n > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  try {
    if (createdInvoices.length) await sequelize.query(`DELETE FROM invoices WHERE id IN (${createdInvoices.join(',')})`);
    if (createdClients.length) await sequelize.query(`DELETE FROM clients WHERE id IN (${createdClients.join(',')})`);
  } catch (e2) { console.error('CLEANUP ERROR', e2.message); }
  process.exit(1);
});
