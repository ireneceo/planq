/* Fable 독립 검증 #244 — D2 자가치유 / 캡 / persist / 401 code / race / stale 경계 / rate-limit 버킷 */
const BASE = 'http://localhost:3003';
const A = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };
const B = { email: 'owner@test.planq.kr', password: 'Test1234!' };

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};

// set-cookie 파싱
function cookiesOf(res) {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const out = {};
  for (const c of sc) {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) out[m[1]] = { value: m[2], raw: c, maxAge: /max-age=/i.test(c) };
  }
  return out;
}

async function login(creds, remember) {
  const body = { email: creds.email, password: creds.password };
  if (remember !== undefined) body.remember = remember;
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  return { res, cookies: cookiesOf(res), token: j?.data?.token, json: j };
}

async function refresh(cookieVal) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookieVal) headers['Cookie'] = 'refresh_token=' + cookieVal;
  const res = await fetch(BASE + '/api/auth/refresh', {
    method: 'POST', headers, body: JSON.stringify({}),
  });
  let j = null; try { j = await res.json(); } catch {}
  return { res, cookies: cookiesOf(res), json: j };
}

(async () => {
  const { RefreshToken, sequelize } = require('./models');
  const crypto = require('crypto');
  const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

  console.log('=== A. 로그인(remember 기본) — 쿠키 한 벌 ===');
  const a1 = await login(A);
  ok('login 200', a1.res.status === 200);
  ok('refresh_token 쿠키 발급', !!a1.cookies.refresh_token);
  ok('has_session 동반 쿠키 발급', !!a1.cookies.has_session, (a1.cookies.has_session||{}).raw);
  ok('remember 기본 → refresh_token Max-Age 있음', a1.cookies.refresh_token?.maxAge === true);
  ok('has_session 도 Max-Age 있음(동일 수명)', a1.cookies.has_session?.maxAge === true);
  const C0 = a1.cookies.refresh_token.value;

  console.log('=== B. 정상 회전 ===');
  const r1 = await refresh(C0);
  ok('refresh 200', r1.res.status === 200);
  ok('회전 → 새 refresh_token Set-Cookie', !!r1.cookies.refresh_token && r1.cookies.refresh_token.value !== C0);
  ok('회전에도 has_session 동반', !!r1.cookies.has_session);
  ok('persist 승계(claim 無 옛 토큰=true) → Max-Age 유지', r1.cookies.refresh_token?.maxAge === true);
  const C1 = r1.cookies.refresh_token.value;

  console.log('=== C. D2 자가치유 — stale C0 재사용 (grace 내) ===');
  const r2 = await refresh(C0);
  ok('stale C0 → 200 (grace)', r2.res.status === 200);
  ok('★ 자가치유 새 Set-Cookie 발급', !!r2.cookies.refresh_token, (r2.cookies.refresh_token||{}).raw ? 'new cookie' : 'NO COOKIE');
  const C2 = r2.cookies.refresh_token ? r2.cookies.refresh_token.value : null;
  ok('치유 토큰 ≠ C0/C1', C2 && C2 !== C0 && C2 !== C1);
  const row0 = await RefreshToken.findOne({ where: { token_hash: hash(C0) } });
  ok('DB grace_successor_id 기록', !!row0 && row0.grace_successor_id != null, 'row=' + (row0&&row0.id) + ' successor=' + (row0&&row0.grace_successor_id));

  console.log('=== D. 캡 — 같은 C0 로 2회차 ===');
  const r3 = await refresh(C0);
  ok('2회차 200 (access only 폴백)', r3.res.status === 200 && !!r3.json?.data?.token);
  ok('★ 캡 발동 — Set-Cookie 없음', !r3.cookies.refresh_token, r3.cookies.refresh_token ? 'COOKIE ISSUED (cap broken!)' : 'no cookie');
  const row0b = await RefreshToken.findOne({ where: { token_hash: hash(C0) } });
  ok('grace_successor_id 불변(추가 발급 없음)', row0b.grace_successor_id === row0.grace_successor_id);

  console.log('=== E. 치유 토큰 C2 실사용 가능 ===');
  const r4 = await refresh(C2);
  ok('C2 refresh 200 + 회전', r4.res.status === 200 && !!r4.cookies.refresh_token);

  console.log('=== F. persist — remember:false 세션쿠키 유지 ===');
  const f1 = await login(A, false);
  ok('remember:false → refresh_token Max-Age 없음(세션쿠키)', f1.cookies.refresh_token && f1.cookies.refresh_token.maxAge === false, f1.cookies.refresh_token?.raw);
  ok('has_session 도 Max-Age 없음', f1.cookies.has_session && f1.cookies.has_session.maxAge === false);
  const fr = await refresh(f1.cookies.refresh_token.value);
  ok('★ 회전 후에도 Max-Age 없음(승격 차단)', fr.res.status === 200 && fr.cookies.refresh_token && fr.cookies.refresh_token.maxAge === false, fr.cookies.refresh_token?.raw);
  ok('회전 has_session 도 세션쿠키', fr.cookies.has_session && fr.cookies.has_session.maxAge === false);

  console.log('=== G. 401 기계판독 code ===');
  const g1 = await refresh(null);
  ok('쿠키 없음 → 401 code=no_cookie', g1.res.status === 401 && g1.json?.code === 'no_cookie', JSON.stringify(g1.json));
  const g2 = await refresh('garbage.token.value');
  ok('위조 → 401 code=jwt_invalid', g2.res.status === 401 && g2.json?.code === 'jwt_invalid', JSON.stringify(g2.json));

  console.log('=== H. session-diag 무인증 ===');
  const h1 = await fetch(BASE + '/api/auth/session-diag', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'fable_verify_test', code: 'no_cookie', client_kind: 'web', standalone: false }),
  });
  ok('무인증 200', h1.status === 200);

  console.log('=== I. 병렬 2요청 race — 401 미발생 ===');
  const i0 = await login(A);
  const Ci = i0.cookies.refresh_token.value;
  const [p1, p2] = await Promise.all([refresh(Ci), refresh(Ci)]);
  ok('병렬 refresh 둘 다 200', p1.res.status === 200 && p2.res.status === 200, p1.res.status + '/' + p2.res.status);

  console.log('=== J. grace 15분 초과 stale → 401 stale_reuse (DB 조작 후 원복) ===');
  const j0 = await login(A);
  const Cj = j0.cookies.refresh_token.value;
  await refresh(Cj); // 회전 → Cj revoked
  const rowJ = await RefreshToken.findOne({ where: { token_hash: hash(Cj) } });
  const origRevokedAt = rowJ.revoked_at;
  await rowJ.update({ revoked_at: new Date(Date.now() - 16 * 60 * 1000) });
  const jr = await refresh(Cj);
  ok('16분 경과 stale → 401 code=stale_reuse', jr.res.status === 401 && jr.json?.code === 'stale_reuse', JSON.stringify(jr.json));
  await rowJ.update({ revoked_at: origRevokedAt });
  const rowJ2 = await RefreshToken.findOne({ where: { token_hash: hash(Cj) } });
  ok('DB 원복 확인', Math.abs(new Date(rowJ2.revoked_at) - new Date(origRevokedAt)) < 1000, 'revoked_at=' + rowJ2.revoked_at.toISOString());

  console.log('=== K. 회귀 — logout + 옛 데이터 sample ===');
  const k0 = await login(A);
  const kres = await fetch(BASE + '/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': 'refresh_token=' + k0.cookies.refresh_token.value },
    body: JSON.stringify({}),
  });
  const kc = cookiesOf(kres);
  ok('logout 200', kres.status === 200);
  ok('logout 이 refresh_token clear', !!kc.refresh_token && kc.refresh_token.value === '');
  ok('logout 이 has_session clear', !!kc.has_session && kc.has_session.value === '');
  const [old] = await sequelize.query(
    "SELECT id, client_kind, grace_successor_id, revoked_reason FROM refresh_tokens WHERE created_at < '2026-08-01' ORDER BY id DESC LIMIT 1", { type: sequelize.QueryTypes.SELECT });
  ok('옛 row sample 무영향(grace_successor_id NULL)', old && old.grace_successor_id === null, JSON.stringify(old));

  console.log('=== L. rate-limit user 버킷 분리 (같은 IP, 두 계정) ===');
  const la = await login(A);
  const lb = await login(B);
  let remA = null;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + la.token } });
    remA = r.headers.get('ratelimit-remaining');
  }
  const rb = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + lb.token } });
  const remB = rb.headers.get('ratelimit-remaining');
  const rnone = await fetch(BASE + '/api/health');
  const remIp = rnone.headers.get('ratelimit-remaining');
  console.log('  A(5회 소진) remaining=' + remA + ' / B(1회) remaining=' + remB + ' / IP(무인증) remaining=' + remIp);
  ok('★ user 버킷 분리 — B remaining > A remaining', Number(remB) > Number(remA), 'A=' + remA + ' B=' + remB);

  console.log('\n━━━ PASS ' + pass + ' / FAIL ' + fail + ' ━━━');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });
