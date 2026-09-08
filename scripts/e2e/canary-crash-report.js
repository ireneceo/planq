// canary-crash-report — 렌더 크래시 보고가 **서버에 도착하는가** (2026-09-08)
//
//   어제(v1.48.13) "화면이 죽으면 우리가 먼저 안다" 며 `POST /api/client-errors` 를 넣었다.
//   그런데 운영 로그의 `client-crash` 는 **0건**이었다. 사용자가 안 죽인 게 아니라
//   **보고가 한 번도 도착하지 못한 것**이었다:
//
//     ErrorBoundary 는 `credentials:'include'` 만 붙여 보냈고(쿠키),
//     `/api/client-errors` 는 `authenticateToken` 이며 그 미들웨어는
//     **Authorization 헤더만** 읽는다(쿠키는 refresh 전용) → 전부 `401 no_token`.
//
//   "보고를 만들었다" 와 "보고가 도착한다" 는 다르다
//   (memory: feedback_produced_link_no_consumer · feedback_unwired_guard_is_no_guard).
//
//   여기서 재는 계약 — ②가 **음성 대조군**(옛 구현을 그대로 재현해 401 임을 확인)이다:
//     ① 앱과 같은 인증 계약(Authorization: Bearer)으로 보내면 **200 + 서버 로그에 남는다**
//     ② 쿠키만 보내던 옛 방식은 **401** — 즉 어제 코드는 도착할 수 없었다
//     ③ 무인증 표면이 넓어지지 않았다 (토큰 없이 보내면 401)
//     ④ ErrorBoundary 가 **apiFetch** 로 보낸다 (bare fetch 로 되돌아가면 ①이 다시 거짓말이 된다)
//     ⑤ 스택 필드가 서버 로그까지 실려 온다 (경로만으로는 minify 된 운영에서 못 짚는다)
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const bcrypt = require('/opt/planq/dev-backend/node_modules/bcryptjs');

const API = process.env.E2E_API || 'http://localhost:3003';
const BOUNDARY = '/opt/planq/dev-frontend/src/components/Common/ErrorBoundary.tsx';

async function login(email, password) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  const tok = j?.data?.token || j?.data?.accessToken;
  if (!tok) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 120));
  // 쿠키도 같이 돌려받는다 — 옛 방식(쿠키만)을 **그대로** 재현해야 음성 대조군이 성립한다.
  return { token: tok, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

/** pm2 로그에서 이번 마커가 찍혔는지 본다. 로그가 곧 이 기능의 산출물이다(테이블이 없다).
 *  ★ 경로를 손으로 적지 않는다 — `~/.pm2/logs/…` 로 박아 두었더니 이 서버는 ecosystem 이
 *    `/opt/planq/logs/` 로 돌려놓고 있어서 **검사기가 거짓 FAIL** 을 냈다(로그는 멀쩡했다).
 *    pm2 에게 직접 묻는다(memory: feedback_false_fail_suspect_the_judge). */
function pm2LogPaths() {
  const name = process.env.E2E_PM2_NAME || 'planq-dev-backend';
  try {
    const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const proc = list.find((p) => p.name === name);
    const e = proc && proc.pm2_env;
    return [e && e.pm_err_log_path, e && e.pm_out_log_path].filter(Boolean);
  } catch { return []; }
}
function logHas(marker) {
  const candidates = [
    ...pm2LogPaths(),
    // pm2 를 못 부르는 환경을 위한 폴백 (기본 경로).
    path.join(process.env.HOME || '/home/irene', '.pm2/logs/planq-dev-backend-error.log'),
  ];
  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      // 큰 파일을 통째로 읽지 않는다 — 꼬리만 본다.
      const tail = execSync(`tail -c 400000 ${JSON.stringify(f)}`, { encoding: 'utf-8' });
      const line = tail.split('\n').reverse().find((l) => l.includes(marker));
      if (line) return line;
    } catch { /* 로그를 못 읽으면 다음 후보 */ }
  }
  return null;
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let uid = null;
  const stamp = Date.now();
  const marker = `/canary/crash-${stamp}`;
  const cred = { email: `crashrep-${stamp}@test.planq.kr`, password: 'CrashReport2026!' };
  try {
    // ★ 기존 계정의 비밀번호는 절대 바꾸지 않는다 — 임시 계정을 만들고 finally 에서 지운다.
    const [id] = await sequelize.query(
      `INSERT INTO users (email, password_hash, name, username, platform_role, terms_accepted_at, privacy_accepted_at, created_at, updated_at)
       VALUES (?, ?, 'CrashReport Canary', ?, 'user', NOW(), NOW(), NOW(), NOW())`,
      { replacements: [cred.email, await bcrypt.hash(cred.password, 12), `crsh${stamp}`] });
    uid = id;
    const { token, cookie } = await login(cred.email, cred.password);

    const payload = {
      route: marker,
      message: 'Minified React error #185; canary probe',
      component: 'at Xy | at Zw | at Route',
      stack: `at t (https://dev.planq.kr/assets/AdminWikiPage-CANARY.js:5:1234)`,
      trail: '17:13:40 /inbox #nav-badge-task → 17:13:45 /inbox a:플랫폼 관리자',
      build: 'canary',
    };
    const send = (headers) => fetch(`${API}/api/client-errors`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });

    // ① 앱과 같은 계약 — Authorization: Bearer
    const okRes = await send({ Authorization: `Bearer ${token}` });
    push('① 인증 계약대로 보내면 200', okRes.status === 200, `HTTP ${okRes.status}`);

    // ② 음성 대조군 — 어제 코드가 하던 그대로(쿠키만). 이게 401 이어야 "도착할 수 없었다"가 증명된다.
    const cookieOnly = await send(cookie ? { Cookie: cookie } : {});
    push('② 쿠키만 보내던 옛 방식은 401 (= 어제 보고는 도착할 수 없었다)',
      cookieOnly.status === 401, `HTTP ${cookieOnly.status}`);

    // ③ 무인증 표면이 넓어지지 않았다
    const anon = await send({});
    push('③ 토큰 없이는 401 (무인증 표면 불변)', anon.status === 401, `HTTP ${anon.status}`);

    // ⑤ 서버 로그에 마커 + 스택이 같이 남았다
    await new Promise((r) => setTimeout(r, 400));
    const line = logHas(marker);
    push('⑤ 서버 로그에 경로와 스택이 남는다',
      !!line && line.includes('AdminWikiPage-CANARY.js'),
      line ? line.slice(-200) : '로그에서 못 찾음');
    // ⑦ 직전 조작(빵부스러기)이 같이 실려 온다 — 이것이 없으면 "어디서" 만 알고 재현을 못 한다.
    push('⑦ 직전 조작이 서버 로그에 남는다',
      !!line && line.includes('플랫폼 관리자') && line.includes('nav-badge-task'),
      line && line.includes('trail') ? 'trail 있음' : 'trail 없음');

    // ④ ErrorBoundary 가 인증 계약을 타는가 — 소스 계약 검사.
    //    ①은 "엔드포인트가 산다" 를 증명할 뿐이다. 화면 쪽이 bare fetch 로 되돌아가면
    //    ①은 여전히 초록인데 사용자 크래시는 또 사라진다. 그 회귀를 여기서 막는다.
    const src = fs.readFileSync(BOUNDARY, 'utf-8');
    const usesApiFetch = /apiFetch\(\s*'\/api\/client-errors'/.test(src);
    const bareFetch = /fetch\(\s*'\/api\/client-errors'/.test(src);
    push('④ ErrorBoundary 가 apiFetch 로 보낸다 (bare fetch 아님)',
      usesApiFetch && !bareFetch,
      `apiFetch=${usesApiFetch} · bareFetch=${bareFetch}`);
    push('⑥ 스택 필드를 실어 보낸다', /stack:\s*frames\(/.test(src), `stack 필드 ${/stack:\s*frames\(/.test(src)}`);
    // ⑧ 화면 쪽 계약 — ErrorBoundary 가 trail 을 싣고, 수집기가 값 있는 요소의 글자를 안 읽는다.
    const trailSrc = fs.readFileSync('/opt/planq/dev-frontend/src/utils/crashTrail.ts', 'utf-8');
    push('⑧ ErrorBoundary 가 trail 을 싣는다', /trail:\s*getCrashTrail\(/.test(src), `trail 필드 ${/trail:\s*getCrashTrail\(/.test(src)}`);
    push('⑨ 값이 든 요소의 글자는 담지 않는다 (음성 대조군)',
      /isContentEditable/.test(trailSrc) && /tag === 'input' \|\| tag === 'textarea'/.test(trailSrc),
      '입력 요소는 태그명만 남긴다');
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (uid) {
      await sequelize.query('DELETE FROM refresh_tokens WHERE user_id = ?', { replacements: [uid] }).catch(() => {});
      await sequelize.query('DELETE FROM users WHERE id = ?', { replacements: [uid] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run };
