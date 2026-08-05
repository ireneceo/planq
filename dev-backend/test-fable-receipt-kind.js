/* Fable 독립 검증 — receipt_kind 배선 + 술어 전 케이스 + 격리. 실행 후 rm. */
require('dotenv').config({ path: __dirname + '/.env' });
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BASE = 'http://127.0.0.1:3003';
const BIZ = 5;
const OWNER = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };
const MEMBER_EMAIL = 'fable-v2-member@test.planq.kr';
const MEMBER_PW = 'FableVerify2026!';
const CLIENTUSER_EMAIL = 'fable-v2-client@test.planq.kr';

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
  if (!j.success) throw new Error('login failed ' + email + ' ' + JSON.stringify(j));
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

(async () => {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'planq_admin',
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'planq_dev_db',
  });
  const ids = { clients: [], invoices: [], users: [] };
  try {
    const ownerToken = await login(OWNER.email, OWNER.password);

    // ── 기준선: receipts-due 큐 스냅샷 (테스트 전)
    const dueBefore = await api(ownerToken, `/api/invoices/${BIZ}/receipts-due`);
    check('receipts-due 기준선 조회 200', dueBefore.status === 200);
    const dueBeforeStr = JSON.stringify(dueBefore.json && dueBefore.json.data);

    // ── 테스트 데이터: clients 4종
    async function mkClient(fields) {
      const cols = Object.keys(fields);
      const [r] = await db.execute(
        `INSERT INTO clients (business_id, status, created_at, updated_at, ${cols.join(',')})
         VALUES (?, 'active', NOW(), NOW(), ${cols.map(() => '?').join(',')})`,
        [BIZ, ...cols.map((k) => fields[k])]
      );
      ids.clients.push(r.insertId);
      return r.insertId;
    }
    const cKR = await mkClient({ display_name: 'FV KR사업자', is_business: 1, country: 'KR', biz_name: 'FV한국(주)', biz_tax_id: '123-45-67890' });
    const cUS = await mkClient({ display_name: 'FV US사업자', is_business: 1, country: 'US', biz_name: 'FV US Inc' });
    const cIND = await mkClient({ display_name: 'FV 개인', is_business: 0, country: 'KR' });
    const cDEL = await mkClient({ display_name: 'FV 삭제예정', is_business: 1, country: 'KR', biz_name: 'FV삭제(주)' });

    async function mkInvoice(no, clientId, receiptType, extra = {}) {
      const base = {
        business_id: BIZ, client_id: clientId, invoice_number: no, title: 'FV ' + no,
        total_amount: 100000, tax_amount: 10000, grand_total: 110000, status: 'sent',
        issued_at: new Date(), created_by: 5, currency: 'KRW', installment_mode: 'single',
        payment_method: 'bank_transfer', receipt_type: receiptType, ...extra,
      };
      const cols = Object.keys(base);
      const [r] = await db.execute(
        `INSERT INTO invoices (created_at, updated_at, ${cols.join(',')}) VALUES (NOW(), NOW(), ${cols.map(() => '?').join(',')})`,
        cols.map((k) => base[k])
      );
      ids.invoices.push(r.insertId);
      return r.insertId;
    }
    // 큐 편입 조건: status='paid' (receiptsDue.js:171 — 완납만 발행 대상)
    const iA1 = await mkInvoice('FV-9001', cKR, 'none', { share_token: 'fvtok-a1-' + Date.now(), status: 'paid', paid_at: new Date() });
    const iB1 = await mkInvoice('FV-9002', cUS, 'none', { share_token: 'fvtok-b1-' + Date.now(), status: 'paid', paid_at: new Date() });
    const iC1 = await mkInvoice('FV-9003', cIND, 'none', { status: 'paid', paid_at: new Date() });
    const iA2 = await mkInvoice('FV-9004', cKR, 'cash_receipt');
    const iB2 = await mkInvoice('FV-9005', cUS, 'tax_invoice');
    const iX1 = await mkInvoice('FV-9006', null, 'none', { recipient_email: 'fv-ext@example.com' });
    const iD1 = await mkInvoice('FV-9007', cDEL, 'none');
    // 고객 삭제 → FK SET NULL
    await db.execute('DELETE FROM clients WHERE id = ?', [cDEL]);
    ids.clients = ids.clients.filter((x) => x !== cDEL);

    const EXPECT = {
      [iA1]: 'tax',  // 레거시 none + KR 사업자
      [iB1]: null,   // none + 비KR 사업자
      [iC1]: null,   // none + 개인
      [iA2]: 'cash', // 명시 cash_receipt
      [iB2]: 'tax',  // 명시 tax_invoice (비KR 이어도 명시 우선)
      [iX1]: null,   // client 없음 (recipient_email 만)
      [iD1]: null,   // client 삭제됨 (FK SET NULL)
    };

    // ── ①' 상세 라우트: 키 존재 + 값
    const detailVals = {};
    for (const [invId, exp] of Object.entries(EXPECT)) {
      const d = await api(ownerToken, `/api/invoices/${BIZ}/${invId}`);
      const has = d.json && d.json.data && ('receipt_kind' in d.json.data);
      check(`상세 ${invId} receipt_kind 키 존재`, d.status === 200 && has);
      check(`상세 ${invId} 값 = ${JSON.stringify(exp)}`, has && d.json.data.receipt_kind === exp, d.json && d.json.data && d.json.data.receipt_kind);
      detailVals[invId] = has ? d.json.data.receipt_kind : '__MISSING__';
    }

    // ── ②' 리스트 라우트: 키 존재 + 값 + 상세와 일치
    const list = await api(ownerToken, `/api/invoices/${BIZ}`);
    check('리스트 200', list.status === 200);
    const rows = (list.json && list.json.data) || [];
    for (const [invId, exp] of Object.entries(EXPECT)) {
      const row = rows.find((r) => r.id === Number(invId));
      const has = row && ('receipt_kind' in row);
      check(`리스트 ${invId} receipt_kind 키 존재`, !!has);
      check(`리스트 ${invId} 값 = ${JSON.stringify(exp)}`, has && row.receipt_kind === exp, row && row.receipt_kind);
      check(`리스트↔상세 일치 ${invId}`, has && row.receipt_kind === detailVals[invId]);
      if (row) check(`리스트 ${invId} Client.country 포함(있으면)`, !row.Client || ('country' in row.Client), row.Client && row.Client.country);
    }

    // ── ③' public serializer 대조 (A1: tax / B1: null)
    for (const [invId, exp] of [[iA1, 'tax'], [iB1, null]]) {
      const [[{ share_token }]] = await db.execute('SELECT share_token FROM invoices WHERE id = ?', [invId]);
      const p = await fetch(`${BASE}/api/invoices/public/${share_token}`);
      const pj = await p.json();
      const rk = pj && pj.data && pj.data.receipt && pj.data.receipt.receipt_kind;
      const has = pj && pj.data && pj.data.receipt && ('receipt_kind' in pj.data.receipt);
      check(`public ${invId} receipt_kind = ${JSON.stringify(exp)} (3-serializer 일치)`, has && rk === exp && rk === detailVals[invId], rk);
    }

    // ── ④' receipts-due 큐: 신규 A1 이 'tax' 로 편입 (술어 일치) — 표시측과 큐 동일 판정
    const dueMid = await api(ownerToken, `/api/invoices/${BIZ}/receipts-due`);
    const dueRows = (dueMid.json && dueMid.json.data && (dueMid.json.data.rows || dueMid.json.data)) || [];
    const dueFlat = JSON.stringify(dueRows);
    check('receipts-due 에 FV-9001(tax) 편입', dueFlat.includes('FV-9001'));
    check('receipts-due 에 FV-9002(비KR,null) 미편입', !dueFlat.includes('FV-9002'));
    check('receipts-due 에 FV-9003(개인,null) 미편입', !dueFlat.includes('FV-9003'));

    // ── ⑤' member(비 owner) 발송 403 owner_only (FAIL2 백엔드측)
    const pwHash = await bcrypt.hash(MEMBER_PW, 12);
    const [mu] = await db.execute(
      `INSERT INTO users (email, password_hash, name, platform_role, status, created_at, updated_at)
       VALUES (?, ?, 'FV Member', 'user', 'active', NOW(), NOW())`, [MEMBER_EMAIL, pwHash]);
    ids.users.push(mu.insertId);
    await db.execute(
      `INSERT INTO business_members (business_id, user_id, role, joined_at, created_at, updated_at)
       VALUES (?, ?, 'member', NOW(), NOW(), NOW())`, [BIZ, mu.insertId]);
    const memberToken = await login(MEMBER_EMAIL, MEMBER_PW);
    const sendAsMember = await api(memberToken, `/api/invoices/${BIZ}/${iA1}/send`, {
      method: 'POST', body: JSON.stringify({ send_email: false, send_chat: false }),
    });
    check('member 발송 → 403', sendAsMember.status === 403, sendAsMember.json);
    check('member 발송 → message=owner_only', sendAsMember.json && /owner_only/.test(sendAsMember.json.message || ''), sendAsMember.json && sendAsMember.json.message);

    // ── ⑥' 격리: member(biz5 소속) 가 타 workspace(biz 1) 리스트 → 403
    const cross = await api(memberToken, '/api/invoices/1');
    check('타 workspace 리스트 403', cross.status === 403, cross.status);

    // ── ⑦' client 역할: 자기 invoice 만 + country 는 본인 것만
    const cuHash = await bcrypt.hash(MEMBER_PW, 12);
    const [cu] = await db.execute(
      `INSERT INTO users (email, password_hash, name, platform_role, status, created_at, updated_at)
       VALUES (?, ?, 'FV ClientUser', 'user', 'active', NOW(), NOW())`, [CLIENTUSER_EMAIL, cuHash]);
    ids.users.push(cu.insertId);
    await db.execute('UPDATE clients SET user_id = ? WHERE id = ?', [cu.insertId, cUS]);
    const clientToken = await login(CLIENTUSER_EMAIL, MEMBER_PW);
    const clist = await api(clientToken, `/api/invoices/${BIZ}`);
    check('client 리스트 200', clist.status === 200, clist.status);
    const crows = (clist.json && clist.json.data) || [];
    const onlyOwn = crows.length > 0 && crows.every((r) => r.client_id === cUS);
    check('client 는 자기 invoice 만 (전 행 client_id=자기)', onlyOwn, crows.map((r) => [r.id, r.client_id]));
    const foreign = crows.some((r) => r.Client && r.Client.id !== cUS);
    check('client 응답에 타 고객 Client 데이터 없음', !foreign);

    console.log('\n=== 실측 요약: failures =', failures, '===');
    // 스냅샷 파일로 저장 (원복 후 대조용)
    require('fs').writeFileSync('/tmp/claude-1000/-opt-planq/1c1610bc-a4bb-4852-85f9-7abc22dd6727/scratchpad/due-baseline.json', dueBeforeStr || 'null');
  } catch (e) {
    console.error('SCRIPT ERROR:', e);
    failures++;
  } finally {
    // ── 전량 원복
    if (ids.invoices.length) await db.execute(`DELETE FROM invoice_items WHERE invoice_id IN (${ids.invoices.join(',')})`);
    if (ids.invoices.length) await db.execute(`DELETE FROM invoices WHERE id IN (${ids.invoices.join(',')})`);
    if (ids.clients.length) await db.execute(`DELETE FROM clients WHERE id IN (${ids.clients.join(',')})`);
    if (ids.users.length) {
      await db.execute(`DELETE FROM business_members WHERE user_id IN (${ids.users.join(',')})`);
      await db.execute(`DELETE FROM refresh_tokens WHERE user_id IN (${ids.users.join(',')})`).catch(() => {});
      await db.execute(`DELETE FROM audit_logs WHERE user_id IN (${ids.users.join(',')})`).catch(() => {});
      await db.execute(`DELETE FROM users WHERE id IN (${ids.users.join(',')})`);
    }
    const [[{ n }]] = await db.execute('SELECT COUNT(*) n FROM invoices WHERE business_id = ?', [BIZ]);
    const [[{ c }]] = await db.execute("SELECT COUNT(*) c FROM clients WHERE business_id = ? AND display_name LIKE 'FV %'", [BIZ]);
    console.log(`원복 확인: biz5 invoices=${n} (기준 16), FV clients 잔존=${c} (기준 0)`);
    await db.end();
    process.exit(failures ? 1 : 0);
  }
})();
