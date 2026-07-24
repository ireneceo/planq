// Fable 게이트 — PUT notify_scope 실 HTTP 검증 (권한/400/403/멀티테넌트). 종료 시 원복.
require('dotenv').config();
const { sequelize } = require('./config/database');
const BASE = 'http://localhost:' + (process.env.PORT || 3003);
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? ' | ' + detail : ''));
  if (!cond) fails += 1;
}
async function login(email) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const j = await r.json();
  if (!j.success) throw new Error('login failed ' + email + ' ' + JSON.stringify(j));
  return j.data.accessToken || j.data.access_token || j.data.token;
}
async function api(token, method, path, body) {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, j };
}

(async () => {
  // 임시 개인 계정 (user 16 소유, biz 3, 비활성 — sync 안 탐)
  await sequelize.query(`INSERT INTO email_accounts (business_id, email, imap_host, imap_username, owner_user_id, is_active, notify_scope, created_at, updated_at)
    VALUES (3, 'fable-temp@test.planq.kr', 'imap.invalid', 'fable-temp', 16, 0, 'recommended', NOW(), NOW())`);
  const [[{ id: tempId }]] = await sequelize.query("SELECT id FROM email_accounts WHERE email='fable-temp@test.planq.kr'");

  const t16 = await login('member1@test.planq.kr');
  const t17 = await login('member2@test.planq.kr');

  // 1. 본인 개인 계정 — 정상값 저장 200 + 재조회 일치
  const r1 = await api(t16, 'PUT', `/api/businesses/3/email-accounts/${tempId}`, { notify_scope: 'reply_only' });
  check('본인 개인계정 PUT reply_only → 200', r1.status === 200 && r1.j?.data?.notify_scope === 'reply_only', 'status=' + r1.status + ' scope=' + r1.j?.data?.notify_scope);
  const g1 = await api(t16, 'GET', '/api/businesses/3/email-accounts');
  const acc = (g1.j?.data || []).find((a) => a.id === tempId);
  check('GET serializer 에 notify_scope 노출 + 값 일치', acc && acc.notify_scope === 'reply_only', 'got=' + (acc && acc.notify_scope));

  // 2. 잘못된 값 → 400
  const r2 = await api(t16, 'PUT', `/api/businesses/3/email-accounts/${tempId}`, { notify_scope: 'everything' });
  check('잘못된 값 → 400', r2.status === 400, 'status=' + r2.status + ' msg=' + r2.j?.message);

  // 3. 남의 개인 계정 → 403 (member2 가 member1 개인 계정 변경 시도)
  const r3 = await api(t17, 'PUT', `/api/businesses/3/email-accounts/${tempId}`, { notify_scope: 'all' });
  check('남의 개인계정 PUT → 403', r3.status === 403, 'status=' + r3.status + ' msg=' + r3.j?.message);

  // 4. 회사 공용 계정(14) — 일반 member → 403 (admin only)
  const r4 = await api(t17, 'PUT', '/api/businesses/3/email-accounts/14', { notify_scope: 'all' });
  check('회사공용 PUT by member → 403', r4.status === 403, 'status=' + r4.status + ' msg=' + r4.j?.message);

  // 5. 멀티테넌트 — biz 3 멤버가 biz 5 계정(1) 접근 → 403
  const r5 = await api(t16, 'PUT', '/api/businesses/5/email-accounts/1', { notify_scope: 'all' });
  check('타 워크스페이스 PUT → 403', r5.status === 403, 'status=' + r5.status + ' msg=' + r5.j?.message);

  // 값 훼손 없음 확인 (2~5 시도 후에도 reply_only 유지, 회사계정 14 는 recommended 유지)
  const [[chk]] = await sequelize.query(`SELECT notify_scope FROM email_accounts WHERE id=${tempId}`);
  const [[chk14]] = await sequelize.query('SELECT notify_scope FROM email_accounts WHERE id=14');
  check('거부된 시도가 값을 안 바꿈', chk.notify_scope === 'reply_only' && chk14.notify_scope === 'recommended', JSON.stringify({ temp: chk.notify_scope, a14: chk14.notify_scope }));

  // 원복 — 임시 계정 삭제 (+ 그 계정에 대한 audit log 정리)
  await sequelize.query(`DELETE FROM audit_logs WHERE target_type='EmailAccount' AND target_id=${tempId}`);
  await sequelize.query(`DELETE FROM email_accounts WHERE id=${tempId}`);
  const [[{ c }]] = await sequelize.query("SELECT COUNT(*) c FROM email_accounts WHERE email='fable-temp@test.planq.kr'");
  check('원복 — 임시 계정 삭제', Number(c) === 0);

  console.log(fails === 0 ? 'ALL PASS' : 'FAILURES: ' + fails);
  await sequelize.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  try { await sequelize.query("DELETE FROM email_accounts WHERE email='fable-temp@test.planq.kr'"); } catch {}
  process.exit(2);
});
