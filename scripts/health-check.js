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
  --category=NAME    특정 카테고리만 (infra|auth|security|qnote|voice|external|frontend)
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
function pm2Online(name) {
  try {
    const out = execSync('pm2 jlist', { encoding: 'utf-8' });
    const list = JSON.parse(out);
    const proc = list.find((p) => p.name === name);
    return proc && proc.pm2_env.status === 'online';
  } catch {
    return false;
  }
}

// ============================================
// 테스트 등록
// ============================================
const tests = [];
function test(category, name, fn) {
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
      body: { text: 'Could you send me the report by Friday?' },
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
}

// ============================================
// 카테고리 7: frontend (정적 린트)
// ============================================
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
  const needsAuth = !opts.category || ['auth', 'security', 'qnote', 'voice'].includes(opts.category);
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

  const allPass = await runTests(tests, opts.category);
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error(c.red('\n✗ health-check 자체 오류:'), e.message);
  if (opts.verbose) console.error(c.gray(e.stack));
  process.exit(2);
});
