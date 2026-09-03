#!/usr/bin/env node
/**
 * PlanQ — Health Check
 *
 * 핵심 기능 + 보안 정책의 영구 자동 검증 스크립트.
 * 매 개발 완료 시 자동 실행, 통과해야 "개발 완료" 처리.
 *
 * 사용법:
 *   node scripts/health-check.js                       # 전체 검증
 *   node scripts/health-check.js --category=auth       # 특정 카테고리만
 *   node scripts/health-check.js --verbose             # 상세 출력
 *   node scripts/health-check.js --quiet               # 통과 숨기고 실패만
 *   node scripts/health-check.js --host=https://dev.planq.kr   # 운영/원격 검증
 *
 * 종료 코드: 0 = 모두 통과, 1 = 하나라도 실패, 2 = 스크립트 자체 오류
 *
 * 카테고리:
 *   infra     — PM2 프로세스 + 두 서비스 health 엔드포인트
 *   auth      — 테스트 계정 로그인(캐시) + 토큰 검증
 *   security  — 익명 차단, 잘못된 토큰 거부
 *   qnote     — Q Note 세션 CRUD + LLM 번역/질문 감지
 *   voice     — 음성 핑거프린트 (GET 상태 + 인증)
 *   external  — Deepgram / OpenAI 외부 의존성 키
 *   frontend  — Frontend Lint (POS 컬러/raw select/react-select)
 *
 * 설계 원칙:
 *  - 빠른 ping 중심. 무거운 업로드(문서 인제스트 등)는 별도 E2E.
 *  - 상태 변경(생성/삭제)은 반드시 롤백(테스트 후 삭제)
 *  - 토큰 캐시(TTL 12분)로 rate limit 회피
 *  - 이전 테스트 결과를 다음 테스트가 재사용(ctx 공유)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================
// CLI 옵션 파싱
// ============================================
// 카테고리 정본 — `--help` 목록과 `test()` 등록이 이 한 벌을 공유한다.
//   두 벌로 적으면 어긋난다(실사례: calendar·wiki·billing·account 를 추가하고 help 목록만 낡아,
//   동작하는 필터가 문서상 없는 것처럼 보였다). 새 카테고리는 **여기에 먼저** 적을 것 —
//   안 적으면 test() 가 등록 시점에 죽는다(fail-closed).
const CATEGORIES = [
  'infra', 'auth', 'security', 'qnote', 'voice', 'external',
  'frontend', 'wiki', 'billing', 'account', 'calendar', 'realtime', 'dateonly',
];

const args = process.argv.slice(2);
const opts = {
  category: null,
  verbose: false,
  quiet: false,
  backend: 'http://localhost:3003',
  qnote: 'http://localhost:8000',
};
for (const arg of args) {
  if (arg.startsWith('--category=')) opts.category = arg.split('=')[1];
  else if (arg === '--verbose') opts.verbose = true;
  else if (arg === '--quiet') opts.quiet = true;
  else if (arg.startsWith('--host=')) {
    // --host 는 PlanQ dev-backend 기준. Q Note 도 같은 호스트의 /qnote 프록시가 있다고 가정.
    opts.backend = arg.split('=')[1].replace(/\/$/, '');
    opts.qnote = opts.backend + '/qnote';
  } else if (arg.startsWith('--backend=')) opts.backend = arg.split('=')[1].replace(/\/$/, '');
  else if (arg.startsWith('--qnote=')) opts.qnote = arg.split('=')[1].replace(/\/$/, '');
  else if (arg === '--help' || arg === '-h') {
    console.log(`PlanQ Health Check

사용법:
  node scripts/health-check.js [options]

Options:
  --category=NAME    특정 카테고리만 (${CATEGORIES.join('|')})
  --verbose          응답 본문까지 출력
  --quiet            통과 숨기고 실패만
  --host=URL         단일 호스트 (운영 검증: https://dev.planq.kr)
  --backend=URL      dev-backend URL 오버라이드 (기본 http://localhost:3003)
  --qnote=URL        q-note URL 오버라이드 (기본 http://localhost:8000)
  --help, -h         도움말
`);
    process.exit(0);
  }
}

const BACKEND = opts.backend;
const QNOTE = opts.qnote;

// 전용 테스트 계정 — 매번 같은 계정 재사용
const TEST_USER = {
  email: 'health-check@planq.kr',
  password: 'HealthCheck2026!',
  name: 'Health Check Bot',
  business_name: 'Health Check Biz',
};

// 토큰 캐시 (JWT 15분 → 12분만 사용)
const TOKEN_CACHE_PATH = '/tmp/.planq-health-token.json';
const TOKEN_TTL_MS = 12 * 60 * 1000;

// ============================================
// 색상 출력
// ============================================
const c = {
  reset: '\x1b[0m',
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ============================================
// HTTP 헬퍼
// ============================================
async function http(method, url, { headers = {}, body, expectStatus = 200 } = {}) {
  const hdrs = { ...headers };
  const init = { method, headers: hdrs };
  if (body !== undefined) {
    hdrs['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new Error(`network: ${e.message} (${method} ${url})`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (expectStatus != null && res.status !== expectStatus) {
    const snippet = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200);
    throw new Error(`${method} ${url} → ${res.status} (expected ${expectStatus}): ${snippet}`);
  }
  return data;
}

// ============================================
// 파일 탐색 / 패턴 검색 (Frontend Lint 용)
// ============================================
function walkSrc(dir, exts = ['.tsx', '.ts', '.css']) {
  const out = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (exts.some((e) => entry.name.endsWith(e))) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

function findPattern(files, pattern, allowList = []) {
  const hits = [];
  for (const f of files) {
    if (allowList.some((a) => f.endsWith(a))) continue;
    const content = fs.readFileSync(f, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // 주석 줄은 코드가 아니다 — 규칙을 **설명하는** 주석("raw <select> 금지" 같은)이
      //   그 규칙 위반으로 잡히면, 주석을 지우게 만들어 오히려 근거를 없앤다.
      //   guard-invariants.js 의 i18n 검사와 같은 제외 규칙(//, /* */, *, JSX {/*).
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('{/*')) return;
      if (pattern.test(line)) {
        hits.push(`${f.replace('/opt/planq/', '')}:${i + 1}: ${line.trim().slice(0, 100)}`);
      }
    });
  }
  return hits;
}

// ============================================
// PM2 상태 체크
// ============================================
// CLAUDE.md 협업 규칙: planq-dev-backend / planq-qnote 는 lua 의 PM2 에 등록되어 있음.
// irene 의 PM2 만 확인하면 false negative — irene + lua 두 user 의 jlist 를 합쳐서 검사.
function pm2Online(name) {
  const sources = [
    { cmd: 'pm2 jlist' },
    { cmd: 'sudo -n -u lua pm2 jlist' },
  ];
  for (const s of sources) {
    try {
      const out = execSync(s.cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const list = JSON.parse(out);
      const proc = list.find((p) => p.name === name);
      if (proc && proc.pm2_env.status === 'online') return true;
    } catch {
      // 해당 source 접근 불가 — 다음 source 시도
    }
  }
  return false;
}

// ============================================
// 테스트 등록
// ============================================
const tests = [];
function test(category, name, fn) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`알 수 없는 카테고리 '${category}' — scripts/health-check.js 의 CATEGORIES 에 먼저 추가할 것`);
  }
  tests.push({ category, name, fn });
}

// 공유 컨텍스트 — 카테고리 간 값 전파 (ctx.token 등)
const ctx = {};

// ============================================
// 사전 준비: 토큰 캐시 → 로그인 → 필요시 등록
// ============================================
async function setup() {
  // 1) 토큰 캐시 확인
  try {
    const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
    if (cached.expires_at > Date.now() && cached.token && cached.business_id) {
      ctx.token = cached.token;
      ctx.userId = cached.user_id;
      ctx.businessId = cached.business_id;
      return;
    }
  } catch { /* no cache */ }

  // 2) 로그인 시도
  let loginRes;
  try {
    loginRes = await http('POST', `${BACKEND}/api/auth/login`, {
      body: { email: TEST_USER.email, password: TEST_USER.password },
    });
  } catch (e) {
    if (/→ 401/.test(e.message)) {
      loginRes = await http('POST', `${BACKEND}/api/auth/register`, {
        body: TEST_USER,
        expectStatus: 201,
      });
    } else {
      throw e;
    }
  }

  ctx.token = loginRes.data?.token;
  ctx.userId = loginRes.data?.user?.id;
  ctx.businessId = loginRes.data?.user?.business_id;
  if (!ctx.token || !ctx.businessId) throw new Error('no token or business_id after login');

  // 3) 캐시 저장
  try {
    fs.writeFileSync(
      TOKEN_CACHE_PATH,
      JSON.stringify({
        token: ctx.token,
        user_id: ctx.userId,
        business_id: ctx.businessId,
        expires_at: Date.now() + TOKEN_TTL_MS,
      })
    );
  } catch { /* ignore */ }
}

// ============================================
// 카테고리 1: infra
// ============================================
function defineInfraTests() {
  // PM2 체크는 원격 host 일 때 스킵
  const isLocal = BACKEND.startsWith('http://localhost');

  if (isLocal) {
    test('infra', 'PM2 planq-dev-backend online', () => {
      if (!pm2Online('planq-dev-backend')) throw new Error('process not online');
      return true;
    });
    test('infra', 'PM2 planq-qnote online', () => {
      if (!pm2Online('planq-qnote')) throw new Error('process not online');
      return true;
    });
  }

  test('infra', 'Backend /api/health', async () => {
    const r = await http('GET', `${BACKEND}/api/health`);
    if (r.status !== 'ok') throw new Error(`status=${r.status}`);
    return true;
  });

  test('infra', 'Q Note /health', async () => {
    const r = await http('GET', `${QNOTE}/health`);
    if (r.status !== 'ok') throw new Error(`status=${r.status}`);
    if (!r.deepgram_configured) throw new Error('DEEPGRAM_API_KEY missing');
    if (!r.openai_configured) throw new Error('OPENAI_API_KEY missing');
    return true;
  });

  // ─── PDF 렌더 실호출 (#253 재발 검출) ───
  //
  // #253: 운영에만 헤드리스 Chrome 공유 라이브러리가 없어 pdfService(단일 착지점)가 죽었고
  //   PDF 6개 기능이 동시에 500 이었다. dev 는 라이브러리가 있어 **코드 검증·가드 3축
  //   어디서도 안 잡히는 계열**. 실제로 1바이트 생성해봐야만 잡힌다.
  //
  // 왜 백엔드 HTTP 인가: 운영의 LD_LIBRARY_PATH 는 백엔드 .env 에 있고 dotenv 가
  //   process.env 에 넣어야 puppeteer 의 chrome 자식 프로세스가 상속한다. PDF 를 실제로
  //   서빙하는 프로세스 자신이 렌더해야 진짜 상태를 잰다.
  //
  // 원격(--host) 모드로는 측정 불가 — nginx 가 /api/internal 을 차단하고, 설령 뚫려도
  //   dev 의 INTERNAL_API_KEY ≠ 운영 키라 무의미. 운영 커버는 deploy-planq.sh 가
  //   **운영 호스트 내부에서 자기 키로** 수행한다. 여기서는 조용히 사라지지 않게 명시 출력만.
  if (!isLocal) {
    console.log(c.yellow('  ⊘ PDF 렌더 실호출 — 원격 모드에서는 측정 불가 (deploy-planq.sh 가 운영 내부에서 실측)'));
  } else {
    test('infra', 'PDF 렌더 실호출 (헤드리스 Chrome, %PDF- 매직)', async () => {
      // 키를 못 읽으면 skip 이 아니라 FAIL — 안 잡는 가드는 없는 것보다 나쁘다.
      let key = '';
      try {
        const env = fs.readFileSync('/opt/planq/dev-backend/.env', 'utf-8');
        const m = /^INTERNAL_API_KEY=(.*)$/m.exec(env);
        key = m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
      } catch (e) {
        throw new Error(`.env 읽기 실패 — 거짓 통과 방지 위해 실패 처리: ${e.message}`);
      }
      if (!key) throw new Error('INTERNAL_API_KEY 없음 — 거짓 통과 방지 위해 실패 처리');

      const r = await http('GET', `${BACKEND}/api/internal/health/pdf`, {
        headers: { 'x-internal-api-key': key },
      });
      const d = r.data || {};
      if (!d.magic_ok) throw new Error(`PDF 매직 불일치 (응답: ${JSON.stringify(d).slice(0, 200)})`);
      if (!(d.bytes > 1000)) throw new Error(`PDF 크기 비정상: ${d.bytes} bytes`);
      if (opts.verbose) console.log(c.gray(`      ${d.bytes} bytes, %PDF- OK`));
      return true;
    });
  }
}

// ============================================
// 카테고리 2: auth
// ============================================
function defineAuthTests() {
  test('auth', 'Test user 토큰 확보 (cache or login)', async () => {
    await setup();
    if (!ctx.token) throw new Error('token missing after setup');
    if (opts.verbose) {
      console.log(c.gray(`      user=${ctx.userId} business=${ctx.businessId}`));
    }
    return true;
  });

  test('auth', 'PUT /api/users/:id 언어 저장 (자기 자신)', async () => {
    const r = await http('PUT', `${BACKEND}/api/users/${ctx.userId}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      body: { language: 'ko' },
    });
    if (!r.success || r.data?.language !== 'ko') {
      throw new Error(`language save failed: ${JSON.stringify(r).slice(0, 120)}`);
    }
    return true;
  });
}

// ============================================
// 카테고리 3: security
// ============================================
function defineSecurityTests() {
  test('security', '익명 /api/sessions → 401', async () => {
    await http('GET', `${QNOTE}/api/sessions?business_id=${ctx.businessId || 1}`, { expectStatus: 401 });
    return true;
  });

  test('security', '잘못된 토큰 /api/sessions → 401', async () => {
    await http('GET', `${QNOTE}/api/sessions?business_id=${ctx.businessId || 1}`, {
      headers: { Authorization: 'Bearer invalid.token.here' },
      expectStatus: 401,
    });
    return true;
  });

  test('security', '익명 /api/llm/translate → 401', async () => {
    await http('POST', `${QNOTE}/api/llm/translate`, {
      body: { text: 'test' },
      expectStatus: 401,
    });
    return true;
  });

  test('security', '익명 /api/voice-fingerprint → 401', async () => {
    await http('GET', `${QNOTE}/api/voice-fingerprint`, { expectStatus: 401 });
    return true;
  });

  test('security', '사용자 ID 파라미터 IDOR → 403', async () => {
    // 다른 user id (자기 자신 +1) 에 언어 저장 시도
    const r = await http('PUT', `${BACKEND}/api/users/${(ctx.userId || 1) + 999}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
      body: { language: 'en' },
      expectStatus: 403,
    });
    if (r.success !== false) throw new Error('expected failure envelope');
    return true;
  });
}

// ============================================
// 카테고리 4: qnote (세션 CRUD + LLM)
// ============================================
function defineQnoteTests() {
  const auth = () => ({ Authorization: `Bearer ${ctx.token}` });

  test('qnote', 'Session 생성 (POST /api/sessions)', async () => {
    const r = await http('POST', `${QNOTE}/api/sessions`, {
      headers: auth(),
      body: { business_id: ctx.businessId, title: 'health-check', meeting_languages: ['ko'] },
    });
    if (!r.success || !r.data?.id) throw new Error('no session id');
    ctx.sessionId = r.data.id;
    if (r.data.language !== 'ko') throw new Error(`single-language resolve 실패: language=${r.data.language}`);
    return true;
  });

  test('qnote', 'Session 생성 (multi 언어)', async () => {
    const r = await http('POST', `${QNOTE}/api/sessions`, {
      headers: auth(),
      body: { business_id: ctx.businessId, title: 'health-check-multi', meeting_languages: ['ko', 'en'] },
    });
    if (r.data.language !== 'multi') {
      throw new Error(`multi resolve 실패: language=${r.data.language}`);
    }
    // 바로 삭제
    await http('DELETE', `${QNOTE}/api/sessions/${r.data.id}`, { headers: auth() });
    return true;
  });

  test('qnote', 'Session 목록 (GET /api/sessions)', async () => {
    const r = await http('GET', `${QNOTE}/api/sessions?business_id=${ctx.businessId}`, {
      headers: auth(),
    });
    if (!Array.isArray(r.data)) throw new Error('not array');
    return true;
  });

  test('qnote', 'Session 상세 + utterances + speakers + documents', async () => {
    const r = await http('GET', `${QNOTE}/api/sessions/${ctx.sessionId}`, { headers: auth() });
    if (r.data.id !== ctx.sessionId) throw new Error('id mismatch');
    if (!Array.isArray(r.data.utterances)) throw new Error('no utterances array');
    if (!Array.isArray(r.data.speakers)) throw new Error('no speakers array');
    if (!Array.isArray(r.data.documents)) throw new Error('no documents array');
    // deprecated urls 필드는 응답에서 제거됐어야 함
    if (r.data.urls !== undefined) throw new Error('deprecated "urls" field still in response');
    return true;
  });

  test('qnote', 'Session 수정 (PUT /api/sessions/:id)', async () => {
    const r = await http('PUT', `${QNOTE}/api/sessions/${ctx.sessionId}`, {
      headers: auth(),
      body: { title: 'health-check-updated' },
    });
    if (r.data.title !== 'health-check-updated') throw new Error('title not updated');
    return true;
  });

  test('qnote', 'Session 삭제 + 404 확인', async () => {
    await http('DELETE', `${QNOTE}/api/sessions/${ctx.sessionId}`, { headers: auth() });
    await http('GET', `${QNOTE}/api/sessions/${ctx.sessionId}`, {
      headers: auth(),
      expectStatus: 404,
    });
    return true;
  });

  // LLM
  test('qnote', 'LLM 번역 (영→한) + 질문 감지', async () => {
    const r = await http('POST', `${QNOTE}/api/llm/translate`, {
      headers: auth(),
      body: { text: 'What is the deadline for the report?' },
    });
    if (!r.success || !r.data.translation) throw new Error('no translation');
    if (r.data.is_question !== true) throw new Error(`is_question=${r.data.is_question}`);
    if (opts.verbose) console.log(c.gray(`      translation: ${r.data.translation}`));
    return true;
  });

  test('qnote', 'LLM 번역 (한→영) + 평서문 + formatted_original', async () => {
    const r = await http('POST', `${QNOTE}/api/llm/translate`, {
      headers: auth(),
      body: { text: '오늘 회의는 30분 만에 끝났습니다.' },
    });
    if (!r.success || !r.data.translation) throw new Error('no translation');
    if (r.data.is_question !== false) throw new Error(`is_question=${r.data.is_question}`);
    // formatted_original 필드가 응답에 있어야 함 (한국어 띄어쓰기 교정)
    if (r.data.formatted_original === undefined) {
      throw new Error('formatted_original 필드 누락');
    }
    if (opts.verbose) {
      console.log(c.gray(`      translation: ${r.data.translation}`));
      console.log(c.gray(`      formatted:   ${r.data.formatted_original}`));
    }
    return true;
  });
}

// ============================================
// 카테고리 5: voice (음성 핑거프린트)
// ============================================
function defineVoiceTests() {
  const auth = () => ({ Authorization: `Bearer ${ctx.token}` });

  test('voice', '핑거프린트 상태 조회 (GET /api/voice-fingerprint)', async () => {
    const r = await http('GET', `${QNOTE}/api/voice-fingerprint`, { headers: auth() });
    if (!r.success) throw new Error('not success');
    if (typeof r.data.registered !== 'boolean') throw new Error('registered 필드 누락');
    if (!Array.isArray(r.data.languages)) throw new Error('languages 배열 누락 (다국어 스키마 확인)');
    return true;
  });

  test('voice', '알 수 없는 language 삭제 → 404', async () => {
    await http('DELETE', `${QNOTE}/api/voice-fingerprint/xx`, {
      headers: auth(),
      expectStatus: 404,
    });
    return true;
  });

  test('voice', '잘못된 language 코드 (숫자) → 400', async () => {
    await http('DELETE', `${QNOTE}/api/voice-fingerprint/123`, {
      headers: auth(),
      expectStatus: 400,
    });
    return true;
  });
}

// ============================================
// 카테고리 6: external
// ============================================
function defineExternalTests() {
  // 원격 host 일 때는 q-note .env 읽을 수 없으므로 skip
  const isLocal = BACKEND.startsWith('http://localhost');
  if (!isLocal) return;

  test('external', 'Deepgram API 키 유효성', async () => {
    const key = fs.readFileSync('/opt/planq/q-note/.env', 'utf-8')
      .match(/DEEPGRAM_API_KEY=(\S+)/)?.[1];
    if (!key) throw new Error('key not in .env');
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${key}` },
    });
    if (res.status !== 200) throw new Error(`Deepgram returned ${res.status}`);
    return true;
  });

  // 사이클 N+12 — PushLog 실패율 모니터링.
  // 박제: feedback_external_dispatch_validation.md (push/email/sms 같은 외부 발송은 검증 시점에
  // 직접 발송 흐름 + 실패 누적 같이 확인)
  test('external', 'PushLog 24h 실패율 < 50%', async () => {
    // health-check 가 /opt/planq 에서 실행되어 모듈 lookup path 가 backend node_modules 가 아니어서
    // 자식 process 로 dev-backend cwd 에서 직접 count 만 수행 (sequelize/Op 모두 거기 있음).
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', ['-e', `
      const { PushLog } = require('./models');
      const { Op } = require('sequelize');
      (async () => {
        const since = new Date(Date.now() - 24*60*60*1000);
        const total = await PushLog.count({ where: { created_at: { [Op.gte]: since } } });
        const failed = await PushLog.count({ where: { created_at: { [Op.gte]: since }, status: 'failed' } });
        process.stdout.write(JSON.stringify({ total, failed }));
        process.exit(0);
      })().catch(e => { process.stderr.write(e.message); process.exit(1); });
    `], { cwd: '/opt/planq/dev-backend', encoding: 'utf-8', timeout: 10000 });
    if (r.status !== 0) throw new Error('child process failed: ' + (r.stderr || 'unknown'));
    // dotenvx 같은 헬퍼가 stdout 에 정보 메시지 prefix 할 수 있어 JSON 블록만 추출
    const match = String(r.stdout || '').match(/\{[^{}]*"total"\s*:\s*\d+[^{}]*\}/);
    if (!match) throw new Error('parse failed: ' + (r.stdout || '').slice(0, 100));
    const { total, failed } = JSON.parse(match[0]);
    if (total === 0) return true; // 24h 발송 0건 — 검증 의미 없음, 통과
    const rate = (failed / total) * 100;
    if (rate >= 50) {
      throw new Error(`24h push 실패율 ${rate.toFixed(1)}% (${failed}/${total}) — subscription/VAPID 점검 필요`);
    }
    return true;
  });

  // 메일 "우리 주소" 커버리지 — buildOwnEmailSet 이 현실의 도착 주소를 덮고 있는가.
  //   집합이 현실보다 작으면 isAddressedToUs 가 거짓이 되어 **명백한 요청이 확인 권장으로 강등된다**
  //   (#221 → 재발). 그때 유출된 이유는 "ownEmails ⊇ 실제 도착 주소" 불변식이 검증 항목에
  //   없었기 때문이다. 여기서 그 불변식을 상시 감시한다.
  //   기준: 최근 90일 inbound 의 To 주소 중 10건 이상 도착했는데 ownEmails 에 없는 주소가 있으면 실패.
  //   (별칭 등록으로 해소한다 — 관측 주소를 자동 등록하지는 않는다. BCC 대량발송이 집합을 오염시킨다.)
  test('external', '메일 ownEmails 가 실제 도착 주소를 덮는가', async () => {
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', ['-e', `
      const { EmailMessage, EmailAccount } = require('./models');
      const { Op } = require('sequelize');
      const { buildOwnAddressMatcher } = require('./services/emailTriage');
      (async () => {
        const since = new Date(Date.now() - 90*24*60*60*1000);
        const bizIds = [...new Set((await EmailAccount.findAll({ attributes: ['business_id'] })).map(a => a.business_id))];
        const gaps = [];
        for (const bizId of bizIds) {
          // 판정은 수신 인식과 **같은 매처**로 한다 — 정확 주소만 보면 도메인 규칙으로 커버된
          //   주소가 영구 결손으로 잡혀 ACK_GAPS 가 비대해지고 #221 감시가 무뎌진다.
          const m = await buildOwnAddressMatcher(bizId);
          const own = {
            has: (e) => {
              if (m.emails.some((x) => String(x).toLowerCase() === e)) return true;
              const at = e.lastIndexOf('@');
              return at > 0 && m.domains.includes(e.slice(at + 1));
            },
          };
          const msgs = await EmailMessage.findAll({
            where: { business_id: bizId, direction: 'inbound', sent_at: { [Op.gte]: since } },
            attributes: ['to_emails'],
          });
          const counts = new Map();
          for (const m of msgs) {
            const list = Array.isArray(m.to_emails) ? m.to_emails : [];
            // 한 메일의 같은 주소는 1회만 센다
            const seen = new Set();
            for (const x of list) {
              const e = String((x && x.email) || x || '').toLowerCase().trim();
              if (!e || seen.has(e)) continue;
              seen.add(e);
              counts.set(e, (counts.get(e) || 0) + 1);
            }
          }
          for (const [e, n] of counts) {
            if (n >= 10 && !own.has(e)) gaps.push({ bizId, email: e, n });
          }
        }
        gaps.sort((a, b) => b.n - a.n);
        process.stdout.write('@@' + JSON.stringify({ gaps: gaps.slice(0, 10) }));
        process.exit(0);
      })().catch(e => { process.stderr.write(e.message); process.exit(1); });
    `], { cwd: '/opt/planq/dev-backend', encoding: 'utf-8', timeout: 30000 });
    if (r.status !== 0) throw new Error('child process failed: ' + (r.stderr || 'unknown'));
    const match = String(r.stdout || '').match(/@@(\{.*\})/s);
    if (!match) throw new Error('parse failed: ' + (r.stdout || '').slice(0, 200));
    const { gaps } = JSON.parse(match[1]);
    // 인지된 결손 — 실행자가 해소할 수 없는 것만 여기 둔다. 목록에 없는 결손은 그대로 FAIL 이라
    //   #221 재발 신호는 계속 하드하게 잡힌다. 키에 bizId 를 포함해야 같은 주소의 **다른 워크스페이스**
    //   신규 결손이 가려지지 않는다.
    //   규율: 별칭을 등록하면 여기서 항목을 지운다(래칫 조임). "우리 주소가 아니다" 로 결론나면
    //         사유를 '기각' 으로 바꿔 영구 존치한다 — 그래야 올바른 결정에도 green 경로가 있다.
    //   (2026-08-19 도메인 규칙 도입으로 biz3 4건은 실제로 해소돼 목록을 비웠다 — 래칫 조임.
    //    개인 계정이라 별칭을 못 붙이던 결손이, 워크스페이스 도메인 등록으로 개인 계정을
    //    건드리지 않고 풀렸다.)
    const ACK_GAPS = {};
    const fresh = gaps.filter(g => !ACK_GAPS[`${g.bizId}:${g.email}`]);
    if (fresh.length > 0) {
      const desc = fresh.map(g => `${g.email}(${g.n}건/biz${g.bizId})`).join(', ');
      throw new Error(`90일간 10건 이상 도착했는데 "우리 주소" 에 없는 주소: ${desc} — 별칭 등록 필요`);
    }
    const acked = gaps.filter(g => ACK_GAPS[`${g.bizId}:${g.email}`]);
    if (acked.length > 0) {
      console.log(`      ⚠ 인지된 결손 ${acked.length}건 (통과): ` +
        acked.map(g => `${g.email}/biz${g.bizId} — ${ACK_GAPS[`${g.bizId}:${g.email}`]}`).join(' · '));
    }
    return true;
  });

  // business_members.role ENUM 에 'admin' 유지 검사 — sync-database 가 모델보다 뒤처지면
  // admin 이 다시 벗겨져 "관리자로" 승격 라우트가 500 나던 회귀(2026-07-10 근본수정) 재발 감시.
  test('external', "business_members.role ENUM 에 'admin' 유지", async () => {
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', ['-e', `
      const { sequelize } = require('./config/database');
      (async () => {
        const [rows] = await sequelize.query("SHOW COLUMNS FROM business_members LIKE 'role'");
        process.stdout.write(JSON.stringify({ type: rows[0] ? rows[0].Type : '' }));
        process.exit(0);
      })().catch(e => { process.stderr.write(e.message); process.exit(1); });
    `], { cwd: '/opt/planq/dev-backend', encoding: 'utf-8', timeout: 10000 });
    if (r.status !== 0) throw new Error('child process failed: ' + (r.stderr || 'unknown'));
    const match = String(r.stdout || '').match(/\{[^{}]*"type"[^{}]*\}/);
    if (!match) throw new Error('parse failed: ' + (r.stdout || '').slice(0, 100));
    const { type } = JSON.parse(match[0]);
    if (!/'admin'/.test(type)) {
      throw new Error(`role ENUM 에 'admin' 없음 (${type}) — sync-database 가 벗김. 모델 ENUM 순서·수동 ALTER 점검`);
    }
    return true;
  });
}

// ============================================
// 카테고리 7: frontend (정적 린트)
// ============================================
// Q Bill 결제 원장(invoice_payments) ↔ paid 상태 정합. QBILL_PAYMENT_LEDGER_FIX D6.
//   원장은 stats.js 매출의 유일한 원천 — write 를 잊으면 매출이 조용히 0 이 된다(이번 결함).
//   불변식: paid 회차 1건 = payment 1건, paid 단일 invoice = payment 1건.
//   canceled invoice 는 예외(취소 전 paid 회차가 unmark 없이 남아 있을 수 있음 — R3).
function defineBillingLedgerTests() {
  const isLocal = BACKEND.startsWith('http://localhost');
  if (!isLocal) return;

  test('billing', 'invoice_payments 원장이 paid 상태와 일치 (매출 0 회귀 가드)', async () => {
    const { execSync } = require('child_process');
    const out = execSync(
      `node -e "require('dotenv').config();const{Sequelize}=require('sequelize');`
      + `const s=new Sequelize(process.env.DB_NAME,process.env.DB_USER,process.env.DB_PASSWORD,`
      + `{host:process.env.DB_HOST,dialect:'mysql',logging:false});(async()=>{`
      // paid 회차인데 payment 없는 것 (canceled 부모 제외 안 함 — paid 회차는 무조건 payment 필요)
      + `const [a]=await s.query(\\\"SELECT ii.id FROM invoice_installments ii `
      + `LEFT JOIN invoice_payments ip ON ip.installment_id=ii.id `
      + `WHERE ii.status='paid' AND ip.id IS NULL\\\");`
      // paid 단일 invoice(single)인데 payment 없는 것
      + `const [b]=await s.query(\\\"SELECT i.id FROM invoices i `
      + `LEFT JOIN invoice_payments ip ON ip.invoice_id=i.id AND ip.installment_id IS NULL `
      + `WHERE i.installment_mode='single' AND i.status='paid' AND ip.id IS NULL\\\");`
      // payment 있는데 회차가 paid 아님 (유령 원장 — canceled/unmark 후 남은 것)
      + `const [c]=await s.query(\\\"SELECT ip.id FROM invoice_payments ip `
      + `JOIN invoice_installments ii ON ii.id=ip.installment_id WHERE ii.status<>'paid'\\\");`
      // 단일 유령 원장 — installment_id NULL payment 인데 invoice 가 paid 아님(paid→sent 되돌림 후 잔존)
      + `const [d]=await s.query(\\\"SELECT ip.id FROM invoice_payments ip `
      + `JOIN invoices i ON i.id=ip.invoice_id WHERE ip.installment_id IS NULL AND i.status<>'paid'\\\");`
      // paid 엔티티당 payment >1 (이중계상). 단일=invoice_id 그룹(installment NULL), 회차=installment_id 그룹.
      + `const [e]=await s.query(\\\"SELECT invoice_id FROM invoice_payments WHERE installment_id IS NULL GROUP BY invoice_id HAVING COUNT(*)>1\\\");`
      + `const [f]=await s.query(\\\"SELECT installment_id FROM invoice_payments WHERE installment_id IS NOT NULL GROUP BY installment_id HAVING COUNT(*)>1\\\");`
      + `console.log('@@'+JSON.stringify({instNoPay:a.map(x=>x.id),singleNoPay:b.map(x=>x.id),ghostPay:c.map(x=>x.id),singleGhost:d.map(x=>x.id),dupSingle:e.map(x=>x.invoice_id),dupInst:f.map(x=>x.installment_id)}));`
      + `await s.close();})();"`,
      { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 20000 });
    const line = out.split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error('원장 정합 조회 실패 — 거짓 통과 방지 위해 중단');
    const r = JSON.parse(line.slice(2));
    const problems = [];
    if (r.instNoPay.length) problems.push(`paid 회차인데 payment 없음: ${r.instNoPay.join(',')}`);
    if (r.singleNoPay.length) problems.push(`paid 단일 invoice 인데 payment 없음: ${r.singleNoPay.join(',')}`);
    if (r.ghostPay.length) problems.push(`payment 있는데 회차 paid 아님: ${r.ghostPay.join(',')}`);
    if (r.singleGhost.length) problems.push(`단일 유령 payment(invoice paid 아님): ${r.singleGhost.join(',')}`);
    if (r.dupSingle.length) problems.push(`단일 invoice 이중 payment: ${r.dupSingle.join(',')}`);
    if (r.dupInst.length) problems.push(`회차 이중 payment: ${r.dupInst.join(',')}`);
    if (problems.length) throw new Error(problems.join(' / '));
    return true;
  });
}

// 계정 삭제 익명화 정합 — anonymized_at 있으면 PII 잔존 0. ACCOUNT_DELETION_DESIGN.
//   "삭제했는데 이름이 보인다" 분쟁 차단. 익명화 로직이 필드를 빠뜨리면 검출.
function defineAccountDeletionTests() {
  const isLocal = BACKEND.startsWith('http://localhost');
  if (!isLocal) return;

  test('account', '익명화된 계정에 PII 잔존 없음', async () => {
    const { execSync } = require('child_process');
    const out = execSync(
      `node -e "require('dotenv').config();const{Sequelize}=require('sequelize');`
      + `const s=new Sequelize(process.env.DB_NAME,process.env.DB_USER,process.env.DB_PASSWORD,`
      + `{host:process.env.DB_HOST,dialect:'mysql',logging:false});(async()=>{`
      // anonymized 인데 users PII 가 마스킹 안 된 것
      + `const [a]=await s.query(\\\"SELECT id FROM users WHERE anonymized_at IS NOT NULL AND `
      + `(name<>'탈퇴한 사용자' OR email NOT LIKE 'deleted-%@deleted.planq.kr' OR bio IS NOT NULL OR phone IS NOT NULL)\\\");`
      // anonymized user 의 business_members 에 이름/bio 잔존
      + `const [b]=await s.query(\\\"SELECT bm.id FROM business_members bm JOIN users u ON u.id=bm.user_id `
      + `WHERE u.anonymized_at IS NOT NULL AND (bm.name IS NOT NULL OR bm.bio IS NOT NULL)\\\");`
      // anonymized user 의 email_accounts 잔존 (🔴1 — owner_user_id 유령컬럼으로 안 지워지던 것)
      + `const [c]=await s.query(\\\"SELECT ea.id FROM email_accounts ea JOIN users u ON u.id=ea.owner_user_id `
      + `WHERE u.anonymized_at IS NOT NULL\\\");`
      // anonymized user 의 clients display_name 잔존
      + `const [d]=await s.query(\\\"SELECT cl.id FROM clients cl JOIN users u ON u.id=cl.user_id `
      + `WHERE u.anonymized_at IS NOT NULL AND cl.display_name<>'탈퇴한 고객'\\\");`
      + `console.log('@@'+JSON.stringify({userPii:a.map(x=>x.id),memberPii:b.map(x=>x.id),emailPii:c.map(x=>x.id),clientPii:d.map(x=>x.id)}));`
      + `await s.close();})();"`,
      { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 20000 });
    const line = out.split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error('익명화 정합 조회 실패 — 거짓 통과 방지 위해 중단');
    const r = JSON.parse(line.slice(2));
    const problems = [];
    if (r.userPii.length) problems.push(`익명화됐는데 users PII 잔존: ${r.userPii.join(',')}`);
    if (r.memberPii.length) problems.push(`익명화됐는데 business_members PII 잔존: ${r.memberPii.join(',')}`);
    if (r.emailPii.length) problems.push(`익명화됐는데 email_accounts 잔존: ${r.emailPii.join(',')}`);
    if (r.clientPii.length) problems.push(`익명화됐는데 clients PII 잔존: ${r.clientPii.join(',')}`);
    if (problems.length) throw new Error(problems.join(' / '));
    return true;
  });
}

function defineWikiTests() {
  const isLocal = BACKEND.startsWith('http://localhost');
  if (!isLocal) return;  // 원격 검증 시 파일 시스템(라우트 추출) 접근 불가

  // Q위키 article 의 linked_route("이 화면 열기")가 실제 SPA 라우트를 가리키는가.
  //   존재하지 않는 경로면 catch-all 이 랜딩(/)으로 축출해 버튼이 조용히 죽는다.
  //   실사례: /qtask·/qbill·/qnote·/qdocs·/qfile·/qtalk·/clients 로 18건이 죽어 있었다
  //   (브랜드명 그대로 적었으나 실제 라우트는 /tasks·/bills·/notes·/docs·/files·/talk·/business/clients).
  //   관리자 위키 편집에서 새 article 을 추가할 때도 같은 실수가 나므로 상시 감시한다.
  test('wiki', 'help_articles.linked_route 가 실존 라우트를 가리킴', async () => {
    const fsx = require('fs');
    const src = ['/opt/planq/dev-frontend/src/App.tsx', '/opt/planq/dev-frontend/src/routes/appRoutes.tsx']
      .map((f) => { try { return fsx.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
    const paths = [...new Set([...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]))].filter((x) => x !== '*');
    if (paths.length < 20) throw new Error(`라우트 추출 실패(${paths.length}개) — 이 검사가 거짓 통과하지 않도록 중단`);
    // 와일드카드('/business/*', '/admin/*')는 매칭에서 제외한다. '.*' 로 풀면 오타 링크
    //   (예: /business/clientz)까지 "실존"으로 통과해 이 검사의 사각이 된다.
    //   구체 경로(/business/clients·/business/members 등)는 목록에 따로 들어 있어 손실 없다.
    const concrete = paths.filter((x) => !x.includes('*'));
    const res = concrete.map((x) => new RegExp('^' + x.replace(/:[^/]+/g, '[^/]+') + '$'));

    // DB 조회는 dev-backend 컨텍스트에서 — .env(DB_*)가 그쪽에 있다.
    const { execSync } = require('child_process');
    const out = execSync(
      `node -e "require('dotenv').config();const{Sequelize}=require('sequelize');`
      + `const s=new Sequelize(process.env.DB_NAME,process.env.DB_USER,process.env.DB_PASSWORD,`
      + `{host:process.env.DB_HOST,dialect:'mysql',logging:false});`
      + `s.query(\\"SELECT slug,linked_route FROM help_articles WHERE linked_route IS NOT NULL AND linked_route<>''\\")`
      + `.then(([r])=>{console.log('@@'+JSON.stringify(r));return s.close();})"`,
      { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 20000 });
    const line = out.split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error('help_articles 조회 실패 — 거짓 통과 방지 위해 중단');
    const rows = JSON.parse(line.slice(2));
    const bad = rows.filter((r) => {
      const only = String(r.linked_route).split('?')[0].split('#')[0];
      return !res.some((re) => re.test(only));
    });
    if (bad.length) {
      throw new Error(`깨진 linked_route ${bad.length}/${rows.length}건:\n      `
        + bad.slice(0, 8).map((b) => `${b.slug} → ${b.linked_route}`).join('\n      '));
    }
    return true;
  });
}

function defineFrontendTests() {
  const isLocal = BACKEND.startsWith('http://localhost');
  if (!isLocal) return;  // 원격 검증 시 파일 시스템 접근 불가

  test('frontend', 'POS 보라색(#6C5CE7) 잔재 없음', () => {
    const files = walkSrc('/opt/planq/dev-frontend/src');
    const hits = findPattern(files, /#6C5CE7|#5B4ED6|#7C6FE7|108,\s*92,\s*231|#F0ECFF|#B8B3FF/i);
    if (hits.length > 0) {
      throw new Error(`POS 컬러 ${hits.length}곳 발견:\n      ` + hits.slice(0, 5).join('\n      '));
    }
    return true;
  });

  test('frontend', 'raw <select> 사용 금지 (PlanQSelect 사용)', () => {
    const files = walkSrc('/opt/planq/dev-frontend/src', ['.tsx']);
    const hits = findPattern(
      files,
      /<select[\s>]|styled\.select\b|styled\(\s*['"]?select['"]?\s*\)/,
      [
        'components/Common/PlanQSelect.tsx',
        'components/Common/LanguageSelector.tsx',
        'components/Common/FilterComponents.tsx',
      ]
    );
    if (hits.length > 0) {
      throw new Error(`raw <select> ${hits.length}곳 발견:\n      ` + hits.slice(0, 5).join('\n      '));
    }
    return true;
  });

  test('frontend', 'react-select 직접 import 금지 (PlanQSelect 경유)', () => {
    const files = walkSrc('/opt/planq/dev-frontend/src', ['.tsx', '.ts']);
    const hits = findPattern(
      files,
      /from\s+['"]react-select['"]/,
      ['components/Common/PlanQSelect.tsx']
    );
    if (hits.length > 0) {
      throw new Error(`react-select 직접 import ${hits.length}곳:\n      ` + hits.slice(0, 5).join('\n      '));
    }
    return true;
  });

  test('frontend', '네이티브 팝업(window.confirm/alert) 사용 금지', () => {
    const files = walkSrc('/opt/planq/dev-frontend/src', ['.tsx', '.ts']);
    const hits = findPattern(files, /window\.(confirm|alert)\s*\(|\balert\s*\(|\bconfirm\s*\(/);
    // React의 isConfirmed 같은 변수명은 오탐 가능 — \balert\( 만 남기기로
    const filtered = hits.filter((h) => !/isConfirm|onConfirm|setConfirm|confirmText/.test(h));
    if (filtered.length > 0) {
      throw new Error(`네이티브 팝업 ${filtered.length}곳:\n      ` + filtered.slice(0, 5).join('\n      '));
    }
    return true;
  });
}

// ============================================
// ============================================
// calendar — 역방향 동기화 링크 무결성 + 관찰성 (CALENDAR_LINK_INTEGRITY_DESIGN §5-9 Q1)
// ============================================
// 이번 사고의 본질은 **침묵**이었다. 운영에서 역방향이 한 번도 산 적 없다는 걸
//   audit_logs 0건으로야 알았다. 두 항목으로 그 침묵을 닫는다.
//   ① 고아 링크 0 — FK 이후엔 구조적으로 0 이지만 회귀 탐지용(FK 가 유실돼도 여기서 드러난다)
//   ② 사유 없는 제외 0 — 후보 집합이 포함 ∪ 제외로 **빠짐없이 덮이는가**
//      ★ 실제 서비스의 classifySources 를 그대로 재사용한다(설계 C5). 여기에 근사 구현을 두면
//        두 벌로 갈라져 가드가 실제 동작이 아니라 자기 사본을 검사하게 된다.
function defineCalendarLinkTests() {
  const isLocal = BACKEND.startsWith('http://localhost');
  if (!isLocal) return;   // DB 직접 조회 — 원격 검증 시 불가

  test('calendar', '고아 캘린더 링크 0건 (connection_id FK)', async () => {
    const { execSync } = require('child_process');
    const out = execSync(
      `node -e "require('dotenv').config();const{sequelize}=require('./config/database');(async()=>{`
      + `const [r]=await sequelize.query(\\\"SELECT l.id,l.connection_id FROM calendar_event_gcal_links l `
      + `LEFT JOIN external_connections c ON c.id=l.connection_id `
      + `WHERE l.connection_id IS NOT NULL AND c.id IS NULL\\\");`
      + `const [f]=await sequelize.query(\\\"SELECT CONSTRAINT_NAME cn FROM information_schema.KEY_COLUMN_USAGE `
      + `WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='calendar_event_gcal_links' `
      + `AND COLUMN_NAME='connection_id' AND REFERENCED_TABLE_NAME='external_connections'\\\");`
      + `console.log('@@'+JSON.stringify({orphans:r.map(x=>x.id+':conn'+x.connection_id),fk:f.map(x=>x.cn)}));`
      + `await sequelize.close();})();"`,
      { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 20000 });
    const line = out.split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error('고아 링크 조회 실패 — 거짓 통과 방지 위해 중단');
    const r = JSON.parse(line.slice(2));
    const problems = [];
    if (r.orphans.length) problems.push(`고아 링크 ${r.orphans.length}건: ${r.orphans.join(', ')}`);
    // FK 부재도 실패로 본다 — 고아가 0 인 것은 "지금" 우연일 수 있고, 구조 보장이 사라지면 다시 쌓인다.
    if (!r.fk.length) problems.push('connection_id FK 부재 — scripts/migrate-gcal-link-fk.js 미적용');
    if (problems.length) throw new Error(problems.join(' / '));
    return true;
  });

  test('calendar', '역방향 폴링 — 사유 없이 빠진 소스 0건 (관찰성)', async () => {
    const { execSync } = require('child_process');
    const out = execSync(
      `node -e "require('dotenv').config();`
      + `const rs=require('./services/calendarReverseSync');`
      + `const{ExternalConnection,BusinessCloudToken}=require('./models');`
      + `const{sequelize}=require('./config/database');(async()=>{`
      + `const c=await rs.classifySources();`
      // ★ 후보 수는 분류 함수와 **독립적으로** 센다. 같은 쿼리를 양쪽에 쓰면 자기모순만 못 잡는다.
      //   분류가 where 필터를 되살리면(예: is_active:true) 여기서 수가 어긋나 FAIL 이 난다.
      + `const rp=await ExternalConnection.count({where:{provider:'google_calendar',owner_scope:'user'}});`
      + `const rw=await BusinessCloudToken.count({where:{provider:'gcal'}});`
      + `const seen=(k)=>c.sources.filter(s=>s.kind===k).length+c.excluded.filter(e=>e.kind===k).length;`
      + `console.log('@@'+JSON.stringify({rawPersonal:rp,rawWorkspace:rw,`
      + `seenPersonal:seen('personal'),seenWorkspace:seen('workspace'),`
      + `sources:c.sources.length,excluded:c.excluded.map(e=>e.kind+'#'+e.id+':'+e.reason),`
      + `vocab:rs.EXCLUSION_REASONS,bad:c.excluded.filter(e=>!rs.EXCLUSION_REASONS.includes(e.reason)).map(e=>e.kind+'#'+e.id+':'+e.reason)}));`
      + `await sequelize.close();})();"`,
      { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 30000 });
    const line = out.split('\n').find((l) => l.startsWith('@@'));
    if (!line) throw new Error('소스 분류 조회 실패 — 거짓 통과 방지 위해 중단');
    const r = JSON.parse(line.slice(2));
    const problems = [];
    // 후보 ≠ 포함+제외 → 어딘가에서 조용히 사라진 것이다. 이 가드가 잡으려는 바로 그 침묵.
    if (r.rawPersonal !== r.seenPersonal) {
      problems.push(`개인 연결 ${r.rawPersonal}건 중 ${r.seenPersonal}건만 분류됨 — ${r.rawPersonal - r.seenPersonal}건이 사유 없이 누락`);
    }
    if (r.rawWorkspace !== r.seenWorkspace) {
      problems.push(`워크스페이스 토큰 ${r.rawWorkspace}건 중 ${r.seenWorkspace}건만 분류됨 — ${r.rawWorkspace - r.seenWorkspace}건이 사유 없이 누락`);
    }
    if (r.bad.length) problems.push(`고정 어휘 밖 사유: ${r.bad.join(', ')} (허용: ${r.vocab.join('/')})`);
    if (problems.length) throw new Error(problems.join(' / '));
    // 사유는 출력에 남긴다 — dev/운영 데이터 차이로 인한 거짓 FAIL 없이 "왜 idle 인지" 를 보여준다.
    return r.excluded.length
      ? `소스 ${r.sources} · 제외 ${r.excluded.length}(${r.excluded.join(', ')})`
      : `소스 ${r.sources} · 제외 0`;
  });
}

// ============================================
// realtime — socket.io 실시간 동기화 가드 (숫자 뱃지 회귀 영구 차단)
// ============================================
// 회귀 사례: unread 뱃지 hook(useUnreadTotal) socket 이 business room 에 join 안 해
//   message:new 를 영영 못 받음 → "소리만 나고 숫자 안 오름". 서버 connection 의
//   autoJoinUserBusinesses 가 깨지면 이 테스트가 즉시 실패한다.
//   memory: feedback_unread_badge_socket_room_join
// dateonly — DATEONLY 값을 **비교하기 전에 정규화하는가**
//   2026-09-03 운영 사고: `tasks.due_date` 가 dev 에서는 'YYYY-MM-DD' 문자열, **운영에서는 Date 객체**로 왔다.
//   그래서 `String(due) < todayStr` 이 운영에서만 항상 false 였고, 반복업무 지난 회차 정리가
//   **배포 후에도 0건**이었다 — dev 검증은 전부 통과한 채로.
//   (memory feedback_dev_cannot_reproduce_prod_schema — 스키마·타입이 어긋나면 dev 검증이 전부 거짓 통과)
//   ★ 이 검사는 "우리 DB 가 지금 무엇을 주는가" 를 **실측**한다. 코드 모양이 아니라 값의 타입을 본다.
function defineDateOnlyTests() {
  test('dateonly', 'DATEONLY 비교 전 정규화 (dev/운영 타입 차이)', async () => {
    // ★ DB 조회는 백엔드 cwd 의 별도 프로세스로 — 이 스크립트에는 DB 환경변수가 없다(다른 검사와 동일 패턴).
    const { execSync } = require('child_process');
    const out = execSync(
      `node -e "require('dotenv').config();const{Sequelize}=require('sequelize');`
      + `const s=new Sequelize(process.env.DB_NAME,process.env.DB_USER,process.env.DB_PASSWORD,`
      + `{host:process.env.DB_HOST,dialect:'mysql',logging:false});`
      + `const T=s.define('tasks',{due_date:{type:require('sequelize').DataTypes.DATEONLY}},{tableName:'tasks',timestamps:false});`
      + `(async()=>{const r=await T.findOne({where:{due_date:{[require('sequelize').Op.ne]:null}},attributes:['due_date']});`
      + `const v=r&&r.due_date;`
      + `process.stdout.write('<<'+JSON.stringify({kind:v===null||v===undefined?'null':(typeof v==='string'?'string':(v instanceof Date?'Date':typeof v)),raw:v===null||v===undefined?null:String(v)}));`
      + `process.exit(0);})().catch(e=>{process.stdout.write('<<'+JSON.stringify({err:e.message}));process.exit(0);});"`,
      { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 30000 },
    );
    const info = JSON.parse(out.slice(out.indexOf('<<') + 2));
    if (info.err) throw new Error(`DB 조회 실패: ${info.err}`);
    if (info.kind === 'null') return '검사할 due_date 행 없음 (건너뜀)';

    // 정규화 함수가 두 타입을 같은 결과로 만드는가
    const src = fs.readFileSync('/opt/planq/dev-backend/services/recurringTaskGenerator.js', 'utf8');
    const m = src.match(/function dateOnlyOf[\s\S]*?\n}/);
    if (!m) throw new Error('recurringTaskGenerator.dateOnlyOf 가 없다 — 정규화 없이 비교하면 운영에서만 깨진다');
    // eslint-disable-next-line no-eval
    const norm = eval('(function(){function toDateOnlyStr(d){return d.toISOString().slice(0,10);}\n' + m[0] + '\nreturn dateOnlyOf;})()');
    const a1 = norm('2026-08-28');
    const a2 = norm(new Date('2026-08-28T00:00:00.000Z'));
    if (a1 !== '2026-08-28' || a2 !== '2026-08-28') throw new Error(`정규화 불일치 — string→${a1} / Date→${a2}`);

    // 실제 DB 가 주는 값도 통과하는가 + 정규화 없이 비교하면 깨지는지 같이 본다(양성 대조군)
    const normalized = norm(info.kind === 'Date' ? new Date(info.raw) : info.raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(normalized))) {
      throw new Error(`DB 값 정규화 실패 — ${info.kind} ${JSON.stringify(info.raw)} → ${JSON.stringify(normalized)}`);
    }
    const naive = String(info.raw).slice(0, 10);
    return `DB 가 주는 타입 = ${info.kind}${naive !== normalized ? ' · 정규화 없이 비교하면 깨진다(이 검사가 막는 것)' : ''}`;
  });
}

function defineRealtimeTests() {
  test('realtime', '신규 socket 이 business room 에 auto-join (숫자 뱃지 실시간)', async () => {
    let io;
    try {
      io = require(require.resolve('socket.io-client', { paths: ['/opt/planq/dev-frontend/node_modules'] })).io;
    } catch {
      try { io = require('socket.io-client').io; } catch {
        throw new Error('socket.io-client 모듈 없음 — 실시간 가드 실행 불가 (dev-frontend/node_modules 확인)');
      }
    }
    const s = io(BACKEND, { auth: { token: ctx.token }, transports: ['websocket'], reconnection: false });
    try {
      await new Promise((res, rej) => {
        s.on('connect', res);
        s.on('connect_error', (e) => rej(new Error('connect_error: ' + e.message)));
        setTimeout(() => rej(new Error('connect timeout')), 5000);
      });
      // ★ join:business 를 일부러 emit 하지 않음 — 서버 auto-join 만으로 room 에 들어가야 한다.
      await new Promise((r) => setTimeout(r, 700));
      const rooms = await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('debug:rooms ack 없음 — server debug:rooms 핸들러 확인')), 3000);
        s.emit('debug:rooms', (list) => { clearTimeout(to); res(list || []); });
      });
      const want = `business:${ctx.businessId}`;
      if (!rooms.includes(want)) {
        throw new Error(`socket 이 ${want} 에 auto-join 안 됨 (rooms=${JSON.stringify(rooms)}). ` +
          `server.js autoJoinUserBusinesses 회귀 → message:new 미수신 → 숫자 뱃지 실시간 깨짐`);
      }
      return true;
    } finally {
      s.close();
    }
  });
}

// ============================================
// 러너
// ============================================
async function runTests(allTests, category) {
  const filtered = category ? allTests.filter((t) => t.category === category) : allTests;
  if (filtered.length === 0) {
    console.error(c.red(`카테고리 '${category}' 에 해당하는 테스트가 없습니다.`));
    process.exit(1);
  }

  const byCategory = {};
  for (const t of filtered) {
    if (!byCategory[t.category]) byCategory[t.category] = [];
    byCategory[t.category].push(t);
  }

  let totalPass = 0;
  let totalFail = 0;
  const failures = [];

  for (const [cat, group] of Object.entries(byCategory)) {
    if (!opts.quiet) {
      console.log(`\n${c.cyan(c.bold('▶ ' + cat.toUpperCase()))} ${c.gray(`(${group.length} tests)`)}`);
    }
    for (const t of group) {
      let okResult = false;
      let err = null;
      try {
        const ret = await t.fn();
        okResult = ret !== false;
      } catch (e) {
        err = e;
      }

      if (okResult) {
        totalPass++;
        if (!opts.quiet) console.log(`  ${c.green('✓')} ${t.name}`);
      } else {
        totalFail++;
        const msg = err ? err.message : 'returned false';
        failures.push(`[${cat}] ${t.name}\n      ${msg}`);
        console.log(`  ${c.red('✗')} ${t.name}`);
        console.log(`    ${c.red(msg)}`);
      }
    }
  }

  console.log();
  console.log(c.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  const total = totalPass + totalFail;
  if (totalFail === 0) {
    console.log(c.green(c.bold(`✓ ALL PASSED  (${totalPass}/${total})`)));
  } else {
    console.log(c.red(c.bold(`✗ ${totalFail} FAILED / ${totalPass} passed / ${total} total`)));
    console.log();
    console.log(c.red('깨진 항목:'));
    failures.forEach((f, i) => console.log(`  ${c.red((i + 1) + '.')} ${f}`));
  }
  return totalFail === 0;
}

// ============================================
// 메인
// ============================================
(async () => {
  console.log(`\n${c.bold(c.cyan('═══ PlanQ Health Check ═══'))}`);
  console.log(c.gray(`   backend: ${BACKEND}`));
  console.log(c.gray(`   qnote:   ${QNOTE}`));
  if (opts.category) console.log(c.gray(`   카테고리: ${opts.category}`));
  console.log(c.gray(`   time: ${new Date().toISOString()}`));

  // 백엔드 ping
  try {
    await http('GET', `${BACKEND}/api/health`);
  } catch (e) {
    console.error(c.red(`\n✗ 백엔드 응답 없음 (${BACKEND})`));
    console.error(c.gray(`   ${e.message}`));
    console.error(c.gray(`   'pm2 status' 로 planq-dev-backend 상태 확인하세요.`));
    process.exit(1);
  }

  // setup 은 auth 카테고리 테스트에서 lazy 실행 (infra/frontend 만 돌릴 때 불필요)
  // 단, security/qnote/voice 는 토큰이 필요하므로 auth 포함 여부 체크
  const needsAuth = !opts.category || ['auth', 'security', 'qnote', 'voice', 'realtime'].includes(opts.category);
  if (needsAuth) {
    try {
      await setup();
    } catch (e) {
      console.error(c.red(`\n✗ 테스트 계정 준비 실패: ${e.message}`));
      process.exit(1);
    }
  }

  defineInfraTests();
  defineAuthTests();
  defineSecurityTests();
  defineQnoteTests();
  defineVoiceTests();
  defineExternalTests();
  defineFrontendTests();
  defineWikiTests();
  defineBillingLedgerTests();
  defineAccountDeletionTests();
  defineCalendarLinkTests();
  defineRealtimeTests();
  defineDateOnlyTests();

  const allPass = await runTests(tests, opts.category);
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(c.red('\n✗ health-check 자체 오류:'), e.message);
  if (opts.verbose) console.error(c.gray(e.stack));
  process.exit(2);
});
