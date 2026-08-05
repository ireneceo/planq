// Fable 검증 — 정기청구 2엔진 실행 경로에서 receipt_type/tax_invoice_status 실증
// 합성 데이터: business 5, 접두사 FABLEV. 종료 시 전량 삭제.
require('dotenv').config();
const { sequelize } = require('./config/database');
const M = require('./models');
const { Client, ClientSubscription, Project, ProjectClient, Invoice, InvoiceItem } = M;
const { billOneSubscription } = require('./services/clientSubscriptionBilling');
const { billOneProject } = require('./services/recurring_invoice');

const BIZ = 5, OWNER = 5;
const created = { clients: [], subs: [], projects: [], invoices: [] };
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
}

(async () => {
  const subModeVals = ClientSubscription.rawAttributes.auto_mode.values || [];
  const projModeVals = Project.rawAttributes.auto_invoice_mode.values || [];
  const subDraftMode = subModeVals.find((v) => v !== 'auto') || 'draft';
  const projDraftMode = projModeVals.find((v) => v !== 'auto') || 'draft_review';
  console.log('sub auto_mode values:', subModeVals, '→', subDraftMode);
  console.log('proj auto_invoice_mode values:', projModeVals, '→', projDraftMode);

  const today = new Date().toISOString().slice(0, 10);

  // ── 합성 client 4종 ──
  const mk = async (attrs) => {
    const c = await Client.create({ business_id: BIZ, created_by: OWNER, ...attrs });
    created.clients.push(c.id);
    return c;
  };
  const c1 = await mk({ display_name: 'FABLEV KR사업자', biz_name: 'FABLEV 주식회사', is_business: true, country: 'KR', biz_tax_id: null });
  const c2 = await mk({ display_name: 'FABLEV 개인', is_business: false, country: 'KR' });
  const c3 = await mk({ display_name: 'FABLEV US Biz', biz_name: 'FABLEV Inc', is_business: true, country: 'US' });
  const c4 = await mk({ display_name: 'FABLEV KR사업자-USD', biz_name: 'FABLEV USD 주식회사', is_business: true, country: 'KR' });

  // ── 구독 4종 → billOneSubscription ──
  const mkSub = async (client, currency) => {
    const s = await ClientSubscription.create({
      business_id: BIZ, client_id: client.id, plan_name: 'FABLEV plan', amount: 110000,
      currency, interval: 'monthly', vat_rate: 10, auto_mode: subDraftMode, due_days: 14,
      status: 'active', start_date: today, next_billing_at: today, created_by: OWNER,
    });
    created.subs.push(s.id);
    return s;
  };
  const cases = [
    { label: 'sub KR사업자+KRW', client: c1, currency: 'KRW', expType: 'tax_invoice', expStatus: 'pending' },
    { label: 'sub 개인+KRW', client: c2, currency: 'KRW', expType: 'none', expStatus: 'none' },
    { label: 'sub US사업자+KRW', client: c3, currency: 'KRW', expType: 'none', expStatus: 'none' },
    { label: 'sub KR사업자+USD', client: c4, currency: 'USD', expType: 'none', expStatus: 'none' },
  ];
  let subInvC1 = null;
  for (const cs of cases) {
    const sub = await mkSub(cs.client, cs.currency);
    const r = await billOneSubscription(sub);
    if (!r.invoice_id) { check(cs.label, false, 'invoice 미생성: ' + JSON.stringify(r)); continue; }
    created.invoices.push(r.invoice_id);
    const [rows] = await sequelize.query(
      'SELECT receipt_type, tax_invoice_status, receipt_profile, currency, status FROM invoices WHERE id = ?',
      { replacements: [r.invoice_id] });
    const inv = rows[0];
    if (cs.client === c1) subInvC1 = inv;
    check(cs.label,
      inv.receipt_type === cs.expType && inv.tax_invoice_status === cs.expStatus && inv.receipt_profile == null,
      `DB: receipt_type=${inv.receipt_type} tax_invoice_status=${inv.tax_invoice_status} receipt_profile=${inv.receipt_profile} status=${inv.status}`);
  }

  // ── 프로젝트 월정액 → billOneProject (KR사업자 c1) ──
  const p = await Project.create({
    business_id: BIZ, name: 'FABLEV 월정액프로젝트', created_by: OWNER,
    billing_type: 'subscription', monthly_fee: 220000, auto_invoice_enabled: true,
    auto_invoice_mode: projDraftMode, invoice_billing_day: new Date().getDate(),
  });
  created.projects.push(p.id);
  await ProjectClient.create({ project_id: p.id, client_id: c1.id });
  const pr = await billOneProject(p);
  if (!pr.invoice_id) {
    check('proj KR사업자+KRW', false, 'invoice 미생성: ' + JSON.stringify(pr));
  } else {
    created.invoices.push(pr.invoice_id);
    const [rows] = await sequelize.query(
      'SELECT receipt_type, tax_invoice_status, receipt_profile, currency, status FROM invoices WHERE id = ?',
      { replacements: [pr.invoice_id] });
    const inv = rows[0];
    check('proj KR사업자+KRW', inv.receipt_type === 'tax_invoice' && inv.tax_invoice_status === 'pending' && inv.receipt_profile == null,
      `DB: receipt_type=${inv.receipt_type} tax_invoice_status=${inv.tax_invoice_status}`);
    check('두 엔진 동일 판정(KR사업자)', subInvC1 && inv.receipt_type === subInvC1.receipt_type && inv.tax_invoice_status === subInvC1.tax_invoice_status,
      `sub=${subInvC1 && subInvC1.receipt_type}/${subInvC1 && subInvC1.tax_invoice_status} proj=${inv.receipt_type}/${inv.tax_invoice_status}`);
  }

  // ── 반증: 기준선(48f5f8b) 구 엔진 실행 → 'none' 결손 재현 ──
  const fs = require('fs');
  const cp = require('child_process');
  const oldSrc = cp.execSync('git -C /opt/planq show 48f5f8b:dev-backend/services/clientSubscriptionBilling.js').toString();
  const oldPath = __dirname + '/services/_fable_old_clientSub.js';
  fs.writeFileSync(oldPath, oldSrc);
  try {
    const { billOneSubscription: oldBill } = require(oldPath);
    // 다음 달 회차로 새 구독 (멱등키 충돌 방지 위해 별도 sub)
    const s5 = await mkSub(c1, 'KRW');
    const r5 = await oldBill(s5);
    if (r5.invoice_id) {
      created.invoices.push(r5.invoice_id);
      const [rows] = await sequelize.query('SELECT receipt_type, tax_invoice_status FROM invoices WHERE id = ?', { replacements: [r5.invoice_id] });
      check('반증: 구엔진은 none 결손 재현', rows[0].receipt_type === 'none' && rows[0].tax_invoice_status === 'none',
        `구엔진 DB: ${rows[0].receipt_type}/${rows[0].tax_invoice_status}`);
    } else {
      check('반증: 구엔진은 none 결손 재현', false, 'invoice 미생성: ' + JSON.stringify(r5));
    }
  } finally { fs.unlinkSync(oldPath); }

  // ── 정리 ──
  if (created.invoices.length) {
    await InvoiceItem.destroy({ where: { invoice_id: created.invoices }, force: true });
    await Invoice.destroy({ where: { id: created.invoices }, force: true });
  }
  if (created.subs.length) await ClientSubscription.destroy({ where: { id: created.subs }, force: true });
  if (created.projects.length) {
    await ProjectClient.destroy({ where: { project_id: created.projects }, force: true });
    await Project.destroy({ where: { id: created.projects }, force: true });
  }
  if (created.clients.length) await Client.destroy({ where: { id: created.clients }, force: true });
  const [[invLeft]] = await sequelize.query("SELECT COUNT(*) n FROM invoices WHERE id IN (" + (created.invoices.join(',') || '0') + ")");
  const [[clLeft]] = await sequelize.query("SELECT COUNT(*) n FROM clients WHERE display_name LIKE 'FABLEV%'");
  const [[subLeft]] = await sequelize.query("SELECT COUNT(*) n FROM client_subscriptions WHERE plan_name = 'FABLEV plan'");
  const [[prLeft]] = await sequelize.query("SELECT COUNT(*) n FROM projects WHERE name LIKE 'FABLEV%'");
  console.log(`\n원복 확인: invoices 잔존=${invLeft.n} clients 잔존=${clLeft.n} subs 잔존=${subLeft.n} projects 잔존=${prLeft.n}`);

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  await sequelize.close();
  process.exit(fails.length || (invLeft.n > 0 || clLeft.n > 0 || subLeft.n > 0 || prLeft.n > 0) ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  // best-effort cleanup
  try {
    if (created.invoices.length) { await InvoiceItem.destroy({ where: { invoice_id: created.invoices }, force: true }); await Invoice.destroy({ where: { id: created.invoices }, force: true }); }
    if (created.subs.length) await ClientSubscription.destroy({ where: { id: created.subs }, force: true });
    if (created.projects.length) { await ProjectClient.destroy({ where: { project_id: created.projects }, force: true }); await Project.destroy({ where: { id: created.projects }, force: true }); }
    if (created.clients.length) await Client.destroy({ where: { id: created.clients }, force: true });
  } catch (e2) { console.error('CLEANUP ERROR', e2.message); }
  process.exit(1);
});
