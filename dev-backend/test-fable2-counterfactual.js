/* Fable 반증 — clientSubscriptionBilling 수정 제거 시 결함(receipt_type='none')이 재현되는지. rm 예정. */
require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');
const BIZ = 5;
(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'planq_admin',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'planq_dev_db',
  });
  const ids = { clients: [], invoices: [], subs: [] };
  try {
    const [c] = await db.execute(
      `INSERT INTO clients (business_id, status, display_name, is_business, country, biz_name, created_at, updated_at)
       VALUES (?, 'active', 'FWCF KR사업자', 1, 'KR', 'FWCF한국(주)', NOW(), NOW())`, [BIZ]);
    ids.clients.push(c.insertId);
    const { ClientSubscription } = require('./models');
    const { billOneSubscription } = require('./services/clientSubscriptionBilling');
    const sub = await ClientSubscription.create({
      business_id: BIZ, client_id: c.insertId, plan_name: 'FWCF 반증', amount: 100000,
      currency: 'KRW', interval: 'monthly', vat_rate: 10, auto_mode: 'draft_review', due_days: 14,
      status: 'active', start_date: '2026-08-01', next_billing_at: '2026-08-01', created_by: 5,
    });
    ids.subs.push(sub.id);
    const r = await billOneSubscription(sub, new Date('2026-08-06'));
    if (!r.invoice_id) throw new Error('invoice 미생성: ' + JSON.stringify(r));
    ids.invoices.push(r.invoice_id);
    const [[row]] = await db.execute('SELECT receipt_type, tax_invoice_status FROM invoices WHERE id=?', [r.invoice_id]);
    console.log('COUNTERFACTUAL invoice:', JSON.stringify(row));
    console.log(row.receipt_type === 'none'
      ? 'CONFIRMED — 수정 제거 시 결함 재현(receipt_type=none). 수정이 load-bearing.'
      : 'UNEXPECTED — 수정 제거해도 tax_invoice. 테스트가 수정을 감지하지 못함!');
    process.exitCode = row.receipt_type === 'none' ? 0 : 1;
  } catch (e) {
    console.error('SCRIPT ERROR:', e); process.exitCode = 1;
  } finally {
    await new Promise((r) => setTimeout(r, 800));
    if (ids.invoices.length) {
      await db.execute(`DELETE FROM invoice_items WHERE invoice_id IN (${ids.invoices.join(',')})`);
      for (const iid of ids.invoices) await db.execute(`DELETE FROM notifications WHERE link LIKE '%invoice=${iid}%'`).catch(() => {});
      await db.execute(`DELETE FROM invoices WHERE id IN (${ids.invoices.join(',')})`);
    }
    if (ids.subs.length) await db.execute(`DELETE FROM client_subscriptions WHERE id IN (${ids.subs.join(',')})`);
    if (ids.clients.length) await db.execute(`DELETE FROM clients WHERE id IN (${ids.clients.join(',')})`);
    const [[{ n }]] = await db.execute('SELECT COUNT(*) n FROM invoices WHERE business_id=?', [BIZ]);
    console.log('원복: biz5 invoices =', n, '(기준 16)');
    await db.end();
  }
})();
