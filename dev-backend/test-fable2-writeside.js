/* Fable 게이트 — 쓰기측 엔진 실행 검증 + 발송/broadcast 실측. 실행 후 rm. */
require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');
const { io: ioc } = require('/opt/planq/dev-frontend/node_modules/socket.io-client');

const BASE = 'http://127.0.0.1:3003';
const BIZ = 5;
let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  → ' + JSON.stringify(detail) : ''}`);
  if (!cond) failures++;
}
async function login(email, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('login failed ' + email);
  return j.data.accessToken || j.data.access_token || j.data.token;
}
async function api(token, path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, json: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'planq_admin',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'planq_dev_db',
  });
  const ids = { clients: [], invoices: [], subs: [], projects: [] };
  let sock = null;
  try {
    const ownerToken = await login('health-check@planq.kr', 'HealthCheck2026!');

    // ── 기준선: receipts-due 스냅샷 (전체 테스트 전)
    const dueBefore = await api(ownerToken, `/api/invoices/${BIZ}/receipts-due`);
    const dueBeforeStr = JSON.stringify(dueBefore.json && dueBefore.json.data);
    check('receipts-due 기준선 200', dueBefore.status === 200);

    // ── 테스트 클라이언트
    async function mkClient(fields) {
      const cols = Object.keys(fields);
      const [r] = await db.execute(
        `INSERT INTO clients (business_id, status, created_at, updated_at, ${cols.join(',')})
         VALUES (?, 'active', NOW(), NOW(), ${cols.map(() => '?').join(',')})`,
        [BIZ, ...cols.map((k) => fields[k])]);
      ids.clients.push(r.insertId);
      return r.insertId;
    }
    // ★ biz_tax_id 없음 — 게이트가 아님을 엔진 경로에서도 증명
    const cKR = await mkClient({ display_name: 'FW KR사업자(세번없음)', is_business: 1, country: 'KR', biz_name: 'FW한국(주)' });
    const cUS = await mkClient({ display_name: 'FW US사업자', is_business: 1, country: 'US', biz_name: 'FW US Inc' });

    // ══ A. clientSubscriptionBilling — 실제 엔진 실행 (★ Opus 미실행 경로) ══
    const { ClientSubscription } = require('./models');
    const { billOneSubscription } = require('./services/clientSubscriptionBilling');
    async function mkSub(clientId, currency) {
      const s = await ClientSubscription.create({
        business_id: BIZ, client_id: clientId, plan_name: 'FW 유지보수', amount: 300000,
        currency, interval: 'monthly', vat_rate: 10, auto_mode: 'draft_review', due_days: 14,
        status: 'active', start_date: '2026-08-01', next_billing_at: '2026-08-01', created_by: 5,
      });
      ids.subs.push(s.id);
      return s;
    }
    const subKR = await mkSub(cKR, 'KRW');
    const rKR = await billOneSubscription(subKR, new Date('2026-08-06'));
    check('sub(KR사업자·KRW) 엔진 실행 → invoice 생성', !!rKR.invoice_id, rKR);
    if (rKR.invoice_id) {
      ids.invoices.push(rKR.invoice_id);
      const [[row]] = await db.execute('SELECT receipt_type, tax_invoice_status, receipt_profile, status, currency FROM invoices WHERE id=?', [rKR.invoice_id]);
      check('  DB재조회 receipt_type=tax_invoice (biz_tax_id 없어도)', row.receipt_type === 'tax_invoice', row.receipt_type);
      check('  DB재조회 tax_invoice_status=pending', row.tax_invoice_status === 'pending', row.tax_invoice_status);
      check('  receipt_profile 미기록(NULL)', row.receipt_profile === null, row.receipt_profile);
      check('  draft_review → status=draft', row.status === 'draft', row.status);
      // 표시측 종단: 상세 API receipt_kind
      const d = await api(ownerToken, `/api/invoices/${BIZ}/${rKR.invoice_id}`);
      check('  상세 API receipt_kind=tax', d.json && d.json.data && d.json.data.receipt_kind === 'tax', d.json && d.json.data && d.json.data.receipt_kind);
    }
    const subUS = await mkSub(cUS, 'USD');
    const rUS = await billOneSubscription(subUS, new Date('2026-08-06'));
    check('sub(US사업자·USD) 엔진 실행 → invoice 생성', !!rUS.invoice_id, rUS);
    if (rUS.invoice_id) {
      ids.invoices.push(rUS.invoice_id);
      const [[row]] = await db.execute('SELECT receipt_type, tax_invoice_status FROM invoices WHERE id=?', [rUS.invoice_id]);
      check('  외화 → receipt_type=none', row.receipt_type === 'none', row.receipt_type);
      check('  외화 → tax_invoice_status=none', row.tax_invoice_status === 'none', row.tax_invoice_status);
    }

    // ══ B. recurring_invoice(프로젝트 월정액) — 실제 엔진 실행 ══
    const [pr] = await db.execute(
      `INSERT INTO projects (business_id, name, owner_user_id, monthly_fee, auto_invoice_enabled, auto_invoice_mode, created_at, updated_at)
       VALUES (?, 'FW 월정액 프로젝트', 5, 500000, 1, 'draft_review', NOW(), NOW())`, [BIZ]);
    ids.projects.push(pr.insertId);
    await db.execute('INSERT INTO project_clients (project_id, client_id) VALUES (?, ?)', [pr.insertId, cKR]);
    const { Project } = require('./models');
    const proj = await Project.findByPk(pr.insertId);
    const { billOneProject } = require('./services/recurring_invoice');
    const rPJ = await billOneProject(proj, new Date('2026-08-06'));
    check('project(KR사업자) 엔진 실행 → invoice 생성', !!rPJ.invoice_id, rPJ);
    if (rPJ.invoice_id) {
      ids.invoices.push(rPJ.invoice_id);
      const [[row]] = await db.execute('SELECT receipt_type, tax_invoice_status, receipt_profile FROM invoices WHERE id=?', [rPJ.invoice_id]);
      check('  DB재조회 receipt_type=tax_invoice', row.receipt_type === 'tax_invoice', row.receipt_type);
      check('  DB재조회 tax_invoice_status=pending', row.tax_invoice_status === 'pending', row.tax_invoice_status);
      check('  receipt_profile 미기록(NULL)', row.receipt_profile === null, row.receipt_profile);
    }

    // ══ C. 발송 라우트 — owner 성공 + broadcast 실측 + 400 ══
    const [di] = await db.execute(
      `INSERT INTO invoices (business_id, client_id, invoice_number, title, total_amount, grand_total, status,
        created_by, currency, installment_mode, payment_method, receipt_type, recipient_email, created_at, updated_at)
       VALUES (?, ?, 'FW-9301', 'FW 발송검증', 100000, 110000, 'draft', 5, 'KRW', 'single', 'bank_transfer', 'none', 'fw-send@example.com', NOW(), NOW())`,
      [BIZ, cKR]);
    ids.invoices.push(di.insertId);

    // socket: business room join 후 invoice:updated 수신 대기
    const events = [];
    sock = ioc(BASE, { auth: { token: ownerToken }, transports: ['websocket'] });
    await new Promise((res, rej) => {
      sock.on('connect', () => { sock.emit('join:business', BIZ); setTimeout(res, 500); });
      sock.on('connect_error', rej);
      setTimeout(() => rej(new Error('socket connect timeout')), 5000);
    });
    sock.on('invoice:updated', (d) => events.push(d));

    const send1 = await api(ownerToken, `/api/invoices/${BIZ}/${di.insertId}/send`, {
      method: 'POST', body: JSON.stringify({ send_email: false, send_chat: false }),
    });
    check('owner 발송(draft) → 200', send1.status === 200, send1.status);
    const [[after]] = await db.execute('SELECT status, sent_at FROM invoices WHERE id=?', [di.insertId]);
    check('발송 후 DB status=sent + sent_at 기록', after.status === 'sent' && !!after.sent_at, after);
    await sleep(1500);
    const got = events.find((e) => e && e.id === di.insertId);
    check('broadcastInvoice → socket invoice:updated 실수신 (business room)', !!got, got && { id: got.id, status: got.status });

    // draft 아님 → 400 invalid_state
    const send2 = await api(ownerToken, `/api/invoices/${BIZ}/${di.insertId}/send`, {
      method: 'POST', body: JSON.stringify({ send_email: false, send_chat: false }),
    });
    check('sent 상태 재발송 → 400', send2.status === 400, send2.status);
    check('  message=invalid_state', send2.json && /invalid_state/.test(send2.json.message || ''), send2.json && send2.json.message);

    // ── receipts-due 큐 불변 확인 (테스트 invoice 전부 미결제 → 큐 무변)
    const dueAfter = await api(ownerToken, `/api/invoices/${BIZ}/receipts-due`);
    check('receipts-due 큐 결과 불변 (테스트 중 오염 0)', JSON.stringify(dueAfter.json && dueAfter.json.data) === dueBeforeStr);

    console.log('\n=== failures =', failures, '===');
  } catch (e) {
    console.error('SCRIPT ERROR:', e);
    failures++;
  } finally {
    try { if (sock) sock.close(); } catch {}
    await sleep(1000); // setImmediate 알림 flush 대기 후 정리
    if (ids.invoices.length) {
      await db.execute(`DELETE FROM invoice_items WHERE invoice_id IN (${ids.invoices.join(',')})`);
      await db.execute(`DELETE FROM invoice_status_history WHERE invoice_id IN (${ids.invoices.join(',')})`).catch(() => {});
      for (const iid of ids.invoices) {
        await db.execute(`DELETE FROM notifications WHERE link LIKE '%invoice=${iid}%'`).catch(() => {});
      }
      await db.execute(`DELETE FROM invoices WHERE id IN (${ids.invoices.join(',')})`);
    }
    if (ids.subs.length) await db.execute(`DELETE FROM client_subscriptions WHERE id IN (${ids.subs.join(',')})`);
    if (ids.projects.length) {
      await db.execute(`DELETE FROM project_clients WHERE project_id IN (${ids.projects.join(',')})`);
      await db.execute(`DELETE FROM projects WHERE id IN (${ids.projects.join(',')})`);
    }
    if (ids.clients.length) await db.execute(`DELETE FROM clients WHERE id IN (${ids.clients.join(',')})`);
    const [[{ n }]] = await db.execute('SELECT COUNT(*) n FROM invoices WHERE business_id = ?', [BIZ]);
    const [[{ c }]] = await db.execute("SELECT COUNT(*) c FROM clients WHERE business_id = ? AND display_name LIKE 'FW %'", [BIZ]);
    const [[{ s }]] = await db.execute("SELECT COUNT(*) s FROM client_subscriptions WHERE plan_name = 'FW 유지보수'");
    const [[{ p }]] = await db.execute("SELECT COUNT(*) p FROM projects WHERE name = 'FW 월정액 프로젝트'");
    console.log(`원복 확인: biz5 invoices=${n} (기준 16) · FW clients=${c} · FW subs=${s} · FW projects=${p} (전부 0 이어야)`);
    await db.end();
    process.exit(failures ? 1 : 0);
  }
})();
