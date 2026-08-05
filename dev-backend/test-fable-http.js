// Fable 검증 — 신규② 발송 버튼 백엔드: 실 HTTP + socket broadcast + 권한 + 멀티테넌트
// + receipt_kind serializer 소재 실증 (인증 상세 vs public)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { sequelize } = require('./config/database');
const { io } = require('/opt/planq/dev-frontend/node_modules/socket.io-client');

const B = 'http://localhost:3003';
const BIZ = 5;
const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
}
async function api(method, path, token, body) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, j };
}
async function loginToken(email, password) {
  const r = await api('POST', '/api/auth/login', null, { email, password });
  if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${JSON.stringify(r.j)}`);
  return r.j.data.token;
}

const MEMBER_EMAIL = 'fable-v2-member@test.planq.kr';
const MEMBER_PW = 'FableVerify2026!';
let memberUserId = null;
const createdInvoiceIds = [];

(async () => {
  // 캐시 토큰 재사용 (login rate-limit 회피)
  let ownerToken = null;
  try {
    const cached = JSON.parse(fs.readFileSync('/tmp/.planq-health-token.json', 'utf-8'));
    if (cached.expires_at > Date.now() && cached.token) ownerToken = cached.token;
  } catch {}
  if (!ownerToken) ownerToken = await loginToken('health-check@planq.kr', 'HealthCheck2026!');

  // ── member 계정 생성 (biz 5, role member) ──
  const hash = bcrypt.hashSync(MEMBER_PW, 12);
  await sequelize.query(
    `INSERT INTO users (email, password_hash, name, username, email_verified_at, created_at, updated_at)
     VALUES (?, ?, 'Fable V2 Member', ?, NOW(), NOW(), NOW())`,
    { replacements: [MEMBER_EMAIL, hash, 'fable-v2-member-' + Date.now()] });
  const [[u]] = await sequelize.query('SELECT id FROM users WHERE email = ?', { replacements: [MEMBER_EMAIL] });
  memberUserId = u.id;
  await sequelize.query(
    `INSERT INTO business_members (business_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, 'member', NOW(), NOW())`, { replacements: [BIZ, memberUserId] });
  const memberToken = await loginToken(MEMBER_EMAIL, MEMBER_PW);

  // ── draft invoice 생성 (KR 사업자 client 64, receipt_type 미지정 → 'none') ──
  const cr = await api('POST', `/api/invoices/${BIZ}`, ownerToken, {
    title: 'FABLEV2 발송 테스트', client_id: 64,
    items: [{ description: '검증 항목', quantity: 1, unit_price: 10000 }],
    vat_rate: 0.1,
  });
  check('draft 생성 201/200', cr.status === 200 || cr.status === 201, `status=${cr.status}`);
  const inv = cr.j.data.invoice || cr.j.data;
  createdInvoiceIds.push(inv.id);

  // ── 인증 상세 라우트: receipt_kind 존재 여부 (드로어가 소비하는 라우트) ──
  const det = await api('GET', `/api/invoices/${BIZ}/${inv.id}`, ownerToken);
  check('인증 상세 GET 200', det.status === 200, `status=${det.status}`);
  const hasKindAuthed = det.j && det.j.data && ('receipt_kind' in det.j.data);
  console.log(`  → 인증 상세 응답에 receipt_kind ${hasKindAuthed ? '있음' : '없음'} (tax_invoice_status=${det.j.data.tax_invoice_status}, receipt_type=${det.j.data.receipt_type})`);
  check('★드로어 라우트가 receipt_kind 제공', hasKindAuthed, 'InvoiceDetailDrawer 는 이 라우트(getInvoice)를 소비');

  // ── 리스트 라우트도 확인 ──
  const list = await api('GET', `/api/invoices/${BIZ}`, ownerToken);
  const listRow = (list.j.data || []).find((x) => x.id === inv.id);
  console.log(`  → 리스트 응답 receipt_kind ${listRow && 'receipt_kind' in listRow ? '있음' : '없음'}`);

  // ── public 라우트: receipt_kind 존재 (share_token) ──
  const [[tokRow]] = await sequelize.query('SELECT share_token FROM invoices WHERE id = ?', { replacements: [inv.id] });
  if (tokRow?.share_token) {
    const pub = await api('GET', `/api/invoices/public/${tokRow.share_token}`, null);
    const kind = pub.j?.data?.receipt?.receipt_kind;
    check('public 라우트 receipt_kind 존재', pub.status === 200 && kind !== undefined, `status=${pub.status} receipt_kind=${JSON.stringify(kind)}`);
    check('public receipt_kind=tax (KR사업자 레거시 fallback)', kind === 'tax', `got=${JSON.stringify(kind)}`);
  } else {
    console.log('  (share_token 없음 — draft 라 public 검증은 발송 후로)');
  }

  // ── socket 구독 (business:5 room) ──
  const sock = io(B, { auth: { token: ownerToken }, transports: ['websocket'] });
  const events = [];
  await new Promise((res, rej) => {
    sock.on('connect', () => { sock.emit('join:business', BIZ); res(); });
    sock.on('connect_error', rej);
    setTimeout(() => rej(new Error('socket connect timeout')), 5000);
  }).catch((e) => console.log('socket 연결 실패:', e.message));
  sock.on('invoice:updated', (d) => events.push(d));

  // ── member 발송 → 403 owner_only ──
  const mSend = await api('POST', `/api/invoices/${BIZ}/${inv.id}/send`, memberToken, { send_email: false, send_chat: false });
  check('member 발송 403 owner_only', mSend.status === 403 && /owner_only/.test(mSend.j?.message || ''), `status=${mSend.status} msg=${mSend.j?.message}`);

  // ── 멀티테넌트: biz 1 에 발송 시도 → 403/404 ──
  const xSend = await api('POST', `/api/invoices/1/999999/send`, ownerToken, {});
  check('타 워크스페이스 발송 403', xSend.status === 403 || xSend.status === 404, `status=${xSend.status} msg=${xSend.j?.message}`);

  // ── member 상태 확인 후: draft 인지 (member 403 이 상태를 안 바꿨는지) ──
  const still = await api('GET', `/api/invoices/${BIZ}/${inv.id}`, ownerToken);
  check('403 후 여전히 draft', still.j?.data?.status === 'draft', `status=${still.j?.data?.status}`);

  // ── owner 발송 → 200 + 전이 + broadcast ──
  const oSend = await api('POST', `/api/invoices/${BIZ}/${inv.id}/send`, ownerToken, { send_email: true, send_chat: true });
  check('owner 발송 200', oSend.status === 200, `status=${oSend.status} msg=${oSend.j?.message}`);
  console.log('  → deliver:', JSON.stringify(oSend.j?.data?.deliver));
  await new Promise((r) => setTimeout(r, 2500)); // fire-and-forget — sleep 후 카운트
  const got = events.filter((d) => d && d.id === inv.id);
  check('socket invoice:updated 수신', got.length >= 1, `events=${events.length} matching=${got.length} status=${got[0]?.status}`);
  const after = await api('GET', `/api/invoices/${BIZ}/${inv.id}`, ownerToken);
  check('재조회 status=sent', after.j?.data?.status === 'sent', `status=${after.j?.data?.status} sent_at=${after.j?.data?.sent_at}`);

  // ── 재발송(이미 sent) → 400 invalid_state ──
  const again = await api('POST', `/api/invoices/${BIZ}/${inv.id}/send`, ownerToken, {});
  check('sent 재발송 400 invalid_state', again.status === 400 && /invalid_state/.test(again.j?.message || ''), `status=${again.status} msg=${again.j?.message}`);

  // ── 수신처 부재 invoice: client 없음 + recipient_email 없음 ──
  const cr2 = await api('POST', `/api/invoices/${BIZ}`, ownerToken, {
    title: 'FABLEV2 수신처없음', items: [{ description: 'x', quantity: 1, unit_price: 1000 }], vat_rate: 0.1,
  });
  const inv2 = cr2.j.data.invoice || cr2.j.data;
  createdInvoiceIds.push(inv2.id);
  const nSend = await api('POST', `/api/invoices/${BIZ}/${inv2.id}/send`, ownerToken, { send_email: true, send_chat: true });
  check('수신처 부재 발송 — 서버 동작 확인', nSend.status === 200 && nSend.j?.data?.deliver?.email?.error === 'no_recipient_email',
    `status=${nSend.status} deliver=${JSON.stringify(nSend.j?.data?.deliver)}`);

  sock.close();

  // ── 정리: invoice(+items·messages·이벤트), member 계정 ──
  for (const id of createdInvoiceIds) {
    await sequelize.query('DELETE FROM invoice_items WHERE invoice_id = ?', { replacements: [id] });
    await sequelize.query("DELETE FROM messages WHERE kind='card' AND JSON_EXTRACT(meta,'$.invoice_id') = ?", { replacements: [id] });
    await sequelize.query('DELETE FROM invoice_status_history WHERE invoice_id = ?', { replacements: [id] }).catch(() => {});
    await sequelize.query('DELETE FROM bill_events WHERE entity_type = ? AND entity_id = ?', { replacements: ['invoice', id] }).catch(() => {});
    await sequelize.query('DELETE FROM invoices WHERE id = ?', { replacements: [id] });
  }
  await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [memberUserId] });
  await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [memberUserId] });
  const [[a]] = await sequelize.query('SELECT COUNT(*) n FROM invoices WHERE id IN (?)', { replacements: [createdInvoiceIds] });
  const [[b]] = await sequelize.query('SELECT COUNT(*) n FROM users WHERE email = ?', { replacements: [MEMBER_EMAIL] });
  console.log(`\n원복 확인: invoices 잔존=${a.n} member user 잔존=${b.n}`);

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  await sequelize.close();
  process.exit(fails.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR', e);
  try {
    for (const id of createdInvoiceIds) {
      await sequelize.query('DELETE FROM invoice_items WHERE invoice_id = ?', { replacements: [id] });
      await sequelize.query('DELETE FROM invoices WHERE id = ?', { replacements: [id] });
    }
    if (memberUserId) {
      await sequelize.query('DELETE FROM business_members WHERE user_id = ?', { replacements: [memberUserId] });
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [memberUserId] });
    }
  } catch (e2) { console.error('CLEANUP ERROR', e2.message); }
  process.exit(1);
});
