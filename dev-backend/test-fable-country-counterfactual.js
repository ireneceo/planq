/* Fable 반증 — 리스트 include 에서 country 제거 시 비KR 사업자가 목록에서 'tax' 오판정되는지 실측. rm 예정. */
require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');
const BASE = 'http://127.0.0.1:3003';
const BIZ = 5;

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'planq_admin',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'planq_dev_db',
  });
  let cid = null, iid = null;
  try {
    const [c] = await db.execute(
      `INSERT INTO clients (business_id, status, display_name, is_business, country, biz_name, created_at, updated_at)
       VALUES (?, 'active', 'FVCF US사업자', 1, 'US', 'FVCF US Inc', NOW(), NOW())`, [BIZ]);
    cid = c.insertId;
    const [i] = await db.execute(
      `INSERT INTO invoices (business_id, client_id, invoice_number, title, total_amount, grand_total, status,
        issued_at, created_by, currency, installment_mode, payment_method, receipt_type, created_at, updated_at)
       VALUES (?, ?, 'FVCF-9101', 'FVCF counterfactual', 100000, 110000, 'sent', NOW(), 5, 'KRW', 'single', 'bank_transfer', 'none', NOW(), NOW())`,
      [BIZ, cid]);
    iid = i.insertId;

    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }),
    });
    const lj = await r.json();
    const tk = lj.data.accessToken || lj.data.access_token || lj.data.token;
    if (!tk) throw new Error('no token: ' + JSON.stringify(lj).slice(0, 200));
    const listRes = await fetch(`${BASE}/api/invoices/${BIZ}`, { headers: { Authorization: 'Bearer ' + tk } });
    if (listRes.status !== 200) throw new Error('list HTTP ' + listRes.status);
    const list = await listRes.json();
    const row = (list.data || []).find((x) => x.id === iid);
    if (!row) throw new Error('row not found in list');
    const detailRes = await fetch(`${BASE}/api/invoices/${BIZ}/${iid}`, { headers: { Authorization: 'Bearer ' + tk } });
    if (detailRes.status !== 200) throw new Error('detail HTTP ' + detailRes.status);
    const detail = await detailRes.json();
    console.log('LIST  receipt_kind =', JSON.stringify(row && row.receipt_kind), '| Client keys =', row && row.Client ? Object.keys(row.Client).join(',') : null);
    console.log('DETAIL receipt_kind =', JSON.stringify(detail.data && detail.data.receipt_kind));
    console.log('MISMATCH(리스트≠상세) =', (row && row.receipt_kind) !== (detail.data && detail.data.receipt_kind));
  } finally {
    if (iid) await db.execute('DELETE FROM invoices WHERE id = ?', [iid]);
    if (cid) await db.execute('DELETE FROM clients WHERE id = ?', [cid]);
    const [[{ n }]] = await db.execute('SELECT COUNT(*) n FROM invoices WHERE business_id = ?', [BIZ]);
    console.log('원복: biz5 invoices =', n, '(기준 16)');
    await db.end();
  }
})();
