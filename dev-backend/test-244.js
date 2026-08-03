// #244 실HTTP 검증 — D2 grace 자가치유 + 캡 + persist 승계 + D3 진단.
// 실행: cd /opt/planq/dev-backend && node test-244.js   (검증 후 삭제)
require('dotenv').config();
const { sequelize } = require('./config/database');

const BASE = 'https://dev.planq.kr';
const CREDS = { email: 'owner@test.planq.kr', password: 'Test1234!' };

const cookiesOf = (res) => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const out = {};
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = { value: pair.slice(i + 1), attrs: c };
  }
  return out;
};
const jarHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

async function login({ remember = true, kind = 'pwa' } = {}) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Kind': kind },
    body: JSON.stringify({ ...CREDS, remember, client_kind: kind }),
  });
  const set = cookiesOf(res);
  return { res, set };
}

async function refresh(cookieStr, kind = 'pwa') {
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Kind': kind, Cookie: cookieStr },
    body: JSON.stringify({ client_kind: kind }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* noop */ }
  return { res, body, set: cookiesOf(res) };
}

(async () => {
  console.log('\n=== 1. 로그인 — 동반 쿠키(has_session) 동반 발급 ===');
  const { set: loginSet } = await login({ remember: true });
  check('refresh_token 발급', !!loginSet.refresh_token);
  check('has_session 동반 발급', !!loginSet.has_session, loginSet.has_session?.attrs.split(';').slice(1, 3).join(';'));
  check('has_session 은 HttpOnly 아님(프론트가 읽어야 함)', !/HttpOnly/i.test(loginSet.has_session?.attrs || ''));
  check('refresh_token 은 HttpOnly', /HttpOnly/i.test(loginSet.refresh_token?.attrs || ''));

  const C0 = loginSet.refresh_token.value;
  const jar0 = `refresh_token=${C0}; has_session=1`;

  console.log('\n=== 2. 정상 회전 ===');
  const r1 = await refresh(jar0);
  check('200 + 새 refresh_token', r1.res.status === 200 && !!r1.set.refresh_token);
  const C1 = r1.set.refresh_token.value;
  check('토큰이 실제로 교체됨', C1 !== C0);
  check('회전 응답도 has_session 갱신', !!r1.set.has_session);

  console.log('\n=== 3. ★ D2 grace 자가치유 — 옛 쿠키(C0)로 재호출 ===');
  console.log('    (= 회전 응답의 Set-Cookie 가 유실돼 브라우저가 옛 쿠키를 든 상태)');
  const r2 = await refresh(jar0);
  check('200 (세션 유지)', r2.res.status === 200, `status=${r2.res.status}`);
  check('★ 새 refresh_token 을 내려 쿠키를 고쳐줌', !!r2.set.refresh_token, r2.set.refresh_token ? '치유됨' : '치유 안 됨(수정 전 동작)');
  const C2 = r2.set.refresh_token?.value;
  check('치유 토큰은 C0·C1 과 다른 새 토큰', !!C2 && C2 !== C0 && C2 !== C1);

  const [[row0]] = await sequelize.query(
    'SELECT id, grace_successor_id FROM refresh_tokens WHERE token_hash = SHA2(?, 256)', { replacements: [C0] }
  );
  check('stale row 에 grace_successor_id 기록(감사 흔적)', !!row0?.grace_successor_id, `row=${row0?.id} → ${row0?.grace_successor_id}`);

  console.log('\n=== 4. ★ 캡 — 같은 stale 쿠키(C0)로 또 호출하면 재발급 없음 ===');
  const r3 = await refresh(jar0);
  check('200 (access token 은 계속 발급 — 종전 동작)', r3.res.status === 200);
  check('★ 두 번째 치유는 거부 — 새 쿠키 없음', !r3.set.refresh_token, r3.set.refresh_token ? '분기 무한 허용(캡 실패)' : '캡 정상');
  const [[row0b]] = await sequelize.query(
    'SELECT grace_successor_id FROM refresh_tokens WHERE token_hash = SHA2(?, 256)', { replacements: [C0] }
  );
  check('grace_successor_id 가 덮어써지지 않음', row0b?.grace_successor_id === row0?.grace_successor_id);

  console.log('\n=== 5. 치유된 쿠키로 정상 회전 지속 ===');
  const r4 = await refresh(`refresh_token=${C2}; has_session=1`);
  check('치유 토큰으로 회전 성공', r4.res.status === 200 && !!r4.set.refresh_token);

  console.log('\n=== 6. ★ persist 승계 — remember=false 는 회전 후에도 세션 쿠키 ===');
  const { set: sessSet } = await login({ remember: false });
  check('로그인 쿠키에 Max-Age 없음(세션 쿠키)', !/Max-Age/i.test(sessSet.refresh_token?.attrs || ''), sessSet.refresh_token?.attrs.split(';').slice(1).join(';').trim());
  const rs = await refresh(`refresh_token=${sessSet.refresh_token.value}; has_session=1`);
  check('★ 회전 후에도 세션 쿠키 유지(영구쿠키 승격 안 됨)', !/Max-Age/i.test(rs.set.refresh_token?.attrs || ''), rs.set.refresh_token?.attrs.split(';').slice(1).join(';').trim());
  check('동반 쿠키도 세션 쿠키', !/Max-Age/i.test(rs.set.has_session?.attrs || ''));

  console.log('\n=== 7. remember=true 는 영구 쿠키 유지(무회귀) ===');
  const { set: permSet } = await login({ remember: true });
  check('Max-Age 존재', /Max-Age/i.test(permSet.refresh_token?.attrs || ''));
  const rp = await refresh(`refresh_token=${permSet.refresh_token.value}; has_session=1`);
  check('회전 후에도 Max-Age 유지', /Max-Age/i.test(rp.set.refresh_token?.attrs || ''));

  console.log('\n=== 8. 401 기계판독 code ===');
  const noCookie = await fetch(`${BASE}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const nb = await noCookie.json().catch(() => ({}));
  check('쿠키 없음 → 401 code=no_cookie', noCookie.status === 401 && nb.code === 'no_cookie', `code=${nb.code}`);
  const bad = await refresh('refresh_token=garbage.token.here');
  check('위조 토큰 → 401 code=jwt_invalid', bad.res.status === 401 && bad.body?.code === 'jwt_invalid', `code=${bad.body?.code}`);

  console.log('\n=== 9. D3 진단 비콘 ===');
  const diag = await fetch(`${BASE}/api/auth/session-diag`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'test_probe', code: 'no_cookie', client_kind: 'pwa', standalone: true, last_success_at: new Date().toISOString() }),
  });
  check('무인증으로 수신 200', diag.status === 200);
  const diag2 = await fetch(`${BASE}/api/auth/session-diag`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'test_probe_2' }),
  });
  check('연속 호출도 200(스로틀은 로그만 억제)', diag2.status === 200);

  console.log(`\n────────── PASS ${pass} / FAIL ${fail} ──────────\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
