#!/usr/bin/env node
/**
 * PlanQ Health Check
 *
 * 핵심 기능 전수 검증. 매 개발 완료 시 자동 실행.
 * 통과해야만 "개발 완료" 처리.
 *
 * 사용법:
 *   node /opt/planq/scripts/health-check.js
 *   node /opt/planq/scripts/health-check.js --verbose
 *
 * 종료 코드:
 *   0 — 모든 체크 통과
 *   1 — 1개 이상 실패
 *
 * Phase별 체크 추가 위치: CHECKS 배열 하단
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const BACKEND = 'http://localhost:3003';
const QNOTE = 'http://localhost:8000';

// 전용 테스트 계정 (DB에 영속, 매번 같은 계정 재사용)
const TEST_USER = {
  email: 'health-check@planq.kr',
  password: 'HealthCheck2026!',
  name: 'Health Check Bot',
  business_name: 'Health Check Biz',
};

// 토큰 캐시 파일 — rate limit 회피용. JWT는 15분, 12분만 사용.
const TOKEN_CACHE_PATH = '/tmp/.planq-health-token.json';
const TOKEN_TTL_MS = 12 * 60 * 1000;

// ─────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

const ok = (s) => `${C.green}✓${C.reset} ${s}`;
const fail = (s) => `${C.red}✗${C.reset} ${s}`;
const info = (s) => `${C.gray}${s}${C.reset}`;

async function http(method, url, { headers = {}, body, expectStatus = 200 } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (res.status !== expectStatus) {
    throw new Error(`${method} ${url} → ${res.status} (expected ${expectStatus}): ${text.slice(0, 200)}`);
  }
  return data;
}

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

// 공유 컨텍스트 (이전 체크 결과를 다음 체크가 사용)
const ctx = {};

// ─────────────────────────────────────────────────────────
// 체크 정의
// ─────────────────────────────────────────────────────────

const CHECKS = [
  // ── 인프라 ──
  {
    phase: 'Infra',
    name: 'PM2 planq-dev-backend online',
    fn: () => {
      if (!pm2Online('planq-dev-backend')) throw new Error('process not online');
    },
  },
  {
    phase: 'Infra',
    name: 'PM2 planq-qnote online',
    fn: () => {
      if (!pm2Online('planq-qnote')) throw new Error('process not online');
    },
  },
  {
    phase: 'Infra',
    name: 'Backend /api/health',
    fn: async () => {
      const r = await http('GET', `${BACKEND}/api/health`);
      if (r.status !== 'ok') throw new Error(`status=${r.status}`);
    },
  },
  {
    phase: 'Infra',
    name: 'Q Note /health',
    fn: async () => {
      const r = await http('GET', `${QNOTE}/health`);
      if (r.status !== 'ok') throw new Error(`status=${r.status}`);
      if (!r.deepgram_configured) throw new Error('DEEPGRAM_API_KEY missing');
      if (!r.openai_configured) throw new Error('OPENAI_API_KEY missing');
    },
  },

  // ── Phase 2: 인증 ──
  {
    phase: 'Phase 2 (Auth)',
    name: 'Test user 토큰 확보 (cache or login)',
    fn: async () => {
      // 1. 캐시 확인
      try {
        const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
        if (cached.expires_at > Date.now() && cached.token && cached.business_id) {
          ctx.token = cached.token;
          ctx.userId = cached.user_id;
          ctx.businessId = cached.business_id;
          return;
        }
      } catch {}

      // 2. 캐시 없으면 login. 실패 시에만 register.
      let loginRes;
      try {
        loginRes = await http('POST', `${BACKEND}/api/auth/login`, {
          body: { email: TEST_USER.email, password: TEST_USER.password },
        });
      } catch (e) {
        // 401(존재하지 않는 사용자)일 때만 register
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
      if (!ctx.token || !ctx.businessId) throw new Error('no token or business_id');

      // 3. 캐시 저장
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
      } catch {}
    },
  },

  // ── Q Note B-1 ──
  {
    phase: 'Q Note B-1',
    name: 'Session 생성 (POST /api/sessions)',
    fn: async () => {
      const r = await http('POST', `${QNOTE}/api/sessions`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
        body: { business_id: ctx.businessId, title: 'health-check', language: 'multi' },
      });
      if (!r.success || !r.data?.id) throw new Error('no session id');
      ctx.sessionId = r.data.id;
    },
  },
  {
    phase: 'Q Note B-1',
    name: 'Session 목록 (GET /api/sessions)',
    fn: async () => {
      const r = await http('GET', `${QNOTE}/api/sessions?business_id=${ctx.businessId}`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
      });
      if (!Array.isArray(r.data)) throw new Error('not array');
    },
  },
  {
    phase: 'Q Note B-1',
    name: 'Session 상세 + utterances (GET /api/sessions/:id)',
    fn: async () => {
      const r = await http('GET', `${QNOTE}/api/sessions/${ctx.sessionId}`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
      });
      if (r.data.id !== ctx.sessionId) throw new Error('id mismatch');
      if (!Array.isArray(r.data.utterances)) throw new Error('no utterances array');
    },
  },
  {
    phase: 'Q Note B-1',
    name: 'Session 수정 (PUT /api/sessions/:id)',
    fn: async () => {
      const r = await http('PUT', `${QNOTE}/api/sessions/${ctx.sessionId}`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
        body: { title: 'health-check-updated' },
      });
      if (r.data.title !== 'health-check-updated') throw new Error('title not updated');
    },
  },
  {
    phase: 'Q Note B-1',
    name: 'Session 인증 미적용 → 401',
    fn: async () => {
      await http('GET', `${QNOTE}/api/sessions?business_id=${ctx.businessId}`, {
        expectStatus: 401,
      });
    },
  },
  {
    phase: 'Q Note B-1',
    name: 'Session 잘못된 토큰 → 401',
    fn: async () => {
      await http('GET', `${QNOTE}/api/sessions?business_id=${ctx.businessId}`, {
        headers: { Authorization: 'Bearer invalid.token.here' },
        expectStatus: 401,
      });
    },
  },
  {
    phase: 'Q Note B-1',
    name: 'Session 삭제 + 404 확인',
    fn: async () => {
      await http('DELETE', `${QNOTE}/api/sessions/${ctx.sessionId}`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
      });
      await http('GET', `${QNOTE}/api/sessions/${ctx.sessionId}`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
        expectStatus: 404,
      });
    },
  },

  // ── 외부 의존성 ──
  {
    phase: 'External',
    name: 'Deepgram API 키 유효성',
    fn: async () => {
      // REST 엔드포인트로 가벼운 검증 (프로젝트 정보 조회)
      const key = require('fs')
        .readFileSync('/opt/planq/q-note/.env', 'utf-8')
        .match(/DEEPGRAM_API_KEY=(\S+)/)?.[1];
      if (!key) throw new Error('key not in .env');
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${key}` },
      });
      if (res.status !== 200) throw new Error(`Deepgram returned ${res.status}`);
    },
  },

  // ── Q Note B-2: LLM (translation + question detection) ──
  {
    phase: 'Q Note B-2',
    name: 'LLM 번역 (영→한) + 질문 감지',
    fn: async () => {
      const r = await http('POST', `${QNOTE}/api/llm/translate`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
        body: { text: 'Could you send me the report by Friday?' },
      });
      if (!r.success) throw new Error('not success');
      if (!r.data.translation) throw new Error('no translation');
      if (r.data.is_question !== true) throw new Error(`is_question=${r.data.is_question} (expected true)`);
      if (VERBOSE) console.log(info(`      translation: ${r.data.translation}`));
    },
  },
  {
    phase: 'Q Note B-2',
    name: 'LLM 번역 (한→영) + 평서문',
    fn: async () => {
      const r = await http('POST', `${QNOTE}/api/llm/translate`, {
        headers: { Authorization: `Bearer ${ctx.token}` },
        body: { text: '오늘 회의는 30분 만에 끝났습니다.' },
      });
      if (!r.success || !r.data.translation) throw new Error('no translation');
      if (r.data.is_question !== false) throw new Error(`is_question=${r.data.is_question} (expected false)`);
      if (VERBOSE) console.log(info(`      translation: ${r.data.translation}`));
    },
  },
  {
    phase: 'Q Note B-2',
    name: 'LLM 번역 인증 미적용 → 401',
    fn: async () => {
      await http('POST', `${QNOTE}/api/llm/translate`, {
        body: { text: 'test' },
        expectStatus: 401,
      });
    },
  },

  // ── Frontend Lint (UI 일관성) ──
  {
    phase: 'Frontend Lint',
    name: 'POS 보라색(#6C5CE7) 잔재 없음',
    fn: () => {
      const files = walkSrc('/opt/planq/dev-frontend/src');
      const hits = findPattern(files, /#6C5CE7|#5B4ED6|#7C6FE7|108,\s*92,\s*231|#F0ECFF|#B8B3FF/i);
      if (hits.length > 0) {
        throw new Error(`POS 컬러 ${hits.length}곳 발견:\n      ` + hits.slice(0, 5).join('\n      '));
      }
    },
  },
  {
    phase: 'Frontend Lint',
    name: 'raw <select> 사용 금지 (PlanQSelect 사용)',
    fn: () => {
      const files = walkSrc('/opt/planq/dev-frontend/src', ['.tsx']);
      // <select 또는 styled.select 또는 styled(select)를 검사
      const hits = findPattern(
        files,
        /<select[\s>]|styled\.select\b|styled\(\s*['"]?select['"]?\s*\)/,
        [
          'components/Common/PlanQSelect.tsx',
          'components/Common/LanguageSelector.tsx', // 기존 컴포넌트, 단계적 마이그레이션
          'components/Common/FilterComponents.tsx', // legacy, 곧 제거 예정
        ]
      );
      if (hits.length > 0) {
        throw new Error(`raw <select> ${hits.length}곳 발견:\n      ` + hits.slice(0, 5).join('\n      '));
      }
    },
  },
  {
    phase: 'Frontend Lint',
    name: 'react-select 직접 import 금지 (PlanQSelect 경유)',
    fn: () => {
      const files = walkSrc('/opt/planq/dev-frontend/src', ['.tsx', '.ts']);
      const hits = findPattern(
        files,
        /from\s+['"]react-select['"]/,
        ['components/Common/PlanQSelect.tsx']
      );
      if (hits.length > 0) {
        throw new Error(`react-select 직접 import ${hits.length}곳:\n      ` + hits.slice(0, 5).join('\n      '));
      }
    },
  },

  // 새 Phase 추가 시 여기 아래에 체크 추가
];

// ─────────────────────────────────────────────────────────
// 러너
// ─────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${C.bold}${C.cyan}═══ PlanQ Health Check ═══${C.reset}`);
  console.log(info(`time: ${new Date().toISOString()}\n`));

  let passed = 0;
  let failed = 0;
  const failures = [];
  let currentPhase = '';

  for (const check of CHECKS) {
    if (check.phase !== currentPhase) {
      currentPhase = check.phase;
      console.log(`${C.bold}[${currentPhase}]${C.reset}`);
    }
    try {
      await check.fn();
      console.log(`  ${ok(check.name)}`);
      passed++;
    } catch (e) {
      console.log(`  ${fail(check.name)}`);
      console.log(`    ${C.red}${e.message}${C.reset}`);
      if (VERBOSE && e.stack) console.log(C.gray + e.stack + C.reset);
      failures.push({ name: check.name, error: e.message });
      failed++;
    }
  }

  console.log();
  console.log(`${C.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  if (failed === 0) {
    console.log(`${C.green}${C.bold}✓ ALL PASSED${C.reset}  (${passed}/${passed + failed})`);
    process.exit(0);
  } else {
    console.log(`${C.red}${C.bold}✗ FAILED${C.reset}  passed=${passed} failed=${failed}`);
    console.log(`\n${C.red}깨진 항목:${C.reset}`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.error}`));
    process.exit(1);
  }
})().catch((e) => {
  console.error(`${C.red}health-check 자체 오류:${C.reset}`, e);
  process.exit(2);
});
