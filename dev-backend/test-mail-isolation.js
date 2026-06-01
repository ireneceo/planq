require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');
const { EmailAccount, EmailThread } = require('./models');
const { sequelize } = require('./config/database');
const PORT = process.env.PORT || 3003;
const BIZ = 3, USER_A = 3, USER_B = 15;
const stamp = Date.now();
const DUMMY = 'test-encrypted-placeholder';
function call(method, path, token) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { let j; try { j = JSON.parse(b); } catch { j = b.slice(0, 80); } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message })); req.end();
  });
}
(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}${e ? ' — ' + e : ''}`); };
  let companyAcct, personalAcct, tCompany, tPersonal;
  try {
    companyAcct = await EmailAccount.create({ business_id: BIZ, owner_user_id: null, email: `test-company-${stamp}@planq.test`, display_name: 'TEST Company', auth_type: 'password', imap_host: 'imap.test', imap_username: `c${stamp}@planq.test`, imap_password_encrypted: DUMMY });
    personalAcct = await EmailAccount.create({ business_id: BIZ, owner_user_id: USER_A, email: `test-personal-a-${stamp}@planq.test`, display_name: 'TEST Personal A', auth_type: 'google_oauth', imap_host: 'imap.gmail.com', imap_username: `p${stamp}@planq.test`, imap_password_encrypted: DUMMY });
    const base = { business_id: BIZ, status: 'open', last_message_at: new Date(), message_count: 1, unread_count: 1 };
    tCompany = await EmailThread.create({ ...base, account_id: companyAcct.id, subject: `TEST company ${stamp}` });
    tPersonal = await EmailThread.create({ ...base, account_id: personalAcct.id, subject: `TEST personal-A ${stamp}` });
    const tokA = jwt.sign({ userId: USER_A }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const tokB = jwt.sign({ userId: USER_B }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const aList = await call('GET', `/api/businesses/${BIZ}/email-threads?folder=inbox&limit=200`, tokA);
    const aIds = (aList.body?.data || []).map(t => t.id);
    ok('A 인박스 회사 스레드 보임', aIds.includes(tCompany.id), `status=${aList.status}`);
    ok('A 인박스 본인 개인 스레드 보임', aIds.includes(tPersonal.id));
    const bList = await call('GET', `/api/businesses/${BIZ}/email-threads?folder=inbox&limit=200`, tokB);
    const bIds = (bList.body?.data || []).map(t => t.id);
    ok('B 인박스 회사 스레드 보임', bIds.includes(tCompany.id), `status=${bList.status}`);
    ok('🔒 B 인박스 A 개인 스레드 안 보임 (격리)', !bIds.includes(tPersonal.id));
    const bDetail = await call('GET', `/api/businesses/${BIZ}/email-threads/${tPersonal.id}`, tokB);
    ok('🔒 B 가 A 개인 스레드 detail → 404', bDetail.status === 404, `status=${bDetail.status}`);
    const aDetail = await call('GET', `/api/businesses/${BIZ}/email-threads/${tPersonal.id}`, tokA);
    ok('A 본인 개인 스레드 detail → 200', aDetail.status === 200, `status=${aDetail.status}`);
    const bMark = await call('POST', `/api/businesses/${BIZ}/email-threads/${tPersonal.id}/mark-read`, tokB);
    ok('🔒 B 가 A 개인 스레드 mark-read → 404', bMark.status === 404, `status=${bMark.status}`);
    const aAcc = await call('GET', `/api/businesses/${BIZ}/mail-accounts`, tokA);
    const aAccIds = (aAcc.body?.data || []).map(a => a.id);
    ok('A mail-accounts 에 개인 계정 포함', aAccIds.includes(personalAcct.id), `status=${aAcc.status}`);
    const bAcc = await call('GET', `/api/businesses/${BIZ}/mail-accounts`, tokB);
    const bAccIds = (bAcc.body?.data || []).map(a => a.id);
    ok('🔒 B mail-accounts A 개인 계정 안 보임 + 회사 보임', !bAccIds.includes(personalAcct.id) && bAccIds.includes(companyAcct.id), `status=${bAcc.status}`);
  } catch (e) { console.error('TEST ERROR', e.message); fail++; }
  finally {
    if (tCompany) await tCompany.destroy().catch(() => {});
    if (tPersonal) await tPersonal.destroy().catch(() => {});
    if (companyAcct) await companyAcct.destroy().catch(() => {});
    if (personalAcct) await personalAcct.destroy().catch(() => {});
    console.log(`\n결과: ${pass} pass / ${fail} fail`);
    await sequelize.close().catch(() => {});
    process.exit(fail ? 1 : 0);
  }
})();
