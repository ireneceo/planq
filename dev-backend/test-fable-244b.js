/* Fable #244 잔여 — 옛 데이터 sample + rate-limit user 버킷 분리 */
const BASE = 'http://localhost:3003';
const A = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };
const B = { email: 'owner@test.planq.kr', password: 'Test1234!' };
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  PASS ' + n + (d ? ' — ' + d : '')); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };

async function login(creds) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const j = await res.json();
  return { res, token: j?.data?.token };
}

(async () => {
  const { RefreshToken } = require('./models');
  const sequelize = RefreshToken.sequelize;

  console.log('=== K2. 옛 데이터 sample ===');
  const [old] = await sequelize.query(
    "SELECT id, client_kind, grace_successor_id, revoked_reason, created_at FROM refresh_tokens WHERE created_at < '2026-08-01' ORDER BY id DESC LIMIT 1",
    { type: sequelize.QueryTypes.SELECT });
  ok('옛 row sample — grace_successor_id NULL (무영향)', old && old.grace_successor_id === null, JSON.stringify(old));
  const [oldPwa] = await sequelize.query(
    "SELECT id, client_kind, grace_successor_id FROM refresh_tokens WHERE client_kind='pwa' AND created_at < '2026-08-01' ORDER BY id DESC LIMIT 1",
    { type: sequelize.QueryTypes.SELECT });
  ok('옛 pwa row sample 도 NULL', !oldPwa || oldPwa.grace_successor_id === null, JSON.stringify(oldPwa));

  console.log('=== L. rate-limit user 버킷 분리 (같은 IP, 두 계정) ===');
  const la = await login(A);
  const lb = await login(B);
  ok('A/B 로그인 성공', !!la.token && !!lb.token);
  let remA = null;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + la.token } });
    remA = r.headers.get('ratelimit-remaining');
  }
  const rb = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + lb.token } });
  const remB = rb.headers.get('ratelimit-remaining');
  const rnone = await fetch(BASE + '/api/health');
  const remIp = rnone.headers.get('ratelimit-remaining');
  console.log('  A(5회+) remaining=' + remA + ' / B(1회) remaining=' + remB + ' / IP(무인증) remaining=' + remIp);
  ok('★ user 버킷 분리 — B remaining > A remaining', Number(remB) > Number(remA), 'A=' + remA + ' B=' + remB);
  ok('IP 버킷도 별도 (무인증)', remIp !== null && Number(remIp) !== Number(remA), 'IP=' + remIp);

  console.log('\n━━━ PASS ' + pass + ' / FAIL ' + fail + ' ━━━');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
