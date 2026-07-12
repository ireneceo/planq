#!/usr/bin/env node
/**
 * PlanQ — 불변식 정적 가드 (guard-invariants)
 *
 * CLAUDE.md 에 글로만 박제돼 "사람이 기억해야 지켜지던" 불변식을 자동 검출로 전환.
 * health-check.js(런타임) · scripts/e2e(브라우저/카나리)와 3축을 이루는 정적 게이트.
 *
 * 사용법:
 *   node scripts/guard-invariants.js                    # 전체 검사 (exit 0=통과, 1=위반, 2=자체오류)
 *   node scripts/guard-invariants.js --category=mock    # 특정 카테고리만
 *   node scripts/guard-invariants.js --update-baseline  # 래칫 베이스라인 재기록 (위반 정리 후에만!)
 *   node scripts/guard-invariants.js --verbose          # 위반 상세 전체 출력
 *
 * 게이트 방식 2종:
 *   [LOCK]    회귀 잠금 — 존재해야 하는 것이 사라지면 실패 (notify/broadcast/costGuard/owner 가드)
 *   [RATCHET] 래칫 — 기존 부채는 베이스라인으로 동결, "증가"만 실패 (i18n/tenant/pagination/godfile)
 *             부채를 줄였으면 --update-baseline 으로 조여서 되돌아가지 못하게 박제.
 *
 * 카테고리:
 *   mock        — mock/dummy 데이터 잔재 0건 (CLAUDE.md 최상위 원칙, 하드 게이트)
 *   i18n        — 한국어 하드코딩 래칫 (t() 폴백·주석 제외)
 *   tenant      — routes/ findAll·findAndCountAll 중 business_id/scope 마커 없는 호출 래칫
 *   pagination  — GET list 라우트 파일 중 parsePagination/limit 없는 파일 래칫
 *   notify      — 메시지·status 전이 라우트 파일의 notify 호출 잠금 (CLAUDE.md §13)
 *   broadcast   — 데이터 변경 라우트 파일의 socket broadcast 잠금 (CLAUDE.md §16-b)
 *   finance     — invoices.js assertInvoiceMutationOwner 잠금 (PERMISSION_MATRIX §5.10)
 *   costguard   — 외부비용 라우트의 costGuard 잠금 (운영 안정성 §1)
 *   godfile     — 신규 god-file 차단 래칫 (라우트 500줄 / 컴포넌트 800줄, 기존은 동결)
 *   docfresh    — 핵심 문서 신선도 (경고만, 실패 아님)
 *
 * 커버리지 메모 (다른 축이 담당하는 불변식 — 여기 없다고 미커버 아님):
 *   raw <select>/PlanQSelect·POS색·네이티브팝업 → health-check.js frontend 카테고리
 *   표시명 applyMemberDisplayName 누락           → scripts/e2e/canary-crawl.js (런타임 카나리)
 *   L1 파일 스코프                               → scripts/e2e/canary-l1.js
 *   멀티테넌트 런타임 403                        → scripts/e2e/canary-tenant.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = '/opt/planq';
const BASELINE_PATH = path.join(ROOT, 'scripts/guards-baseline.json');

// ── CLI ──────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  category: null,
  update: args.includes('--update-baseline'),
  verbose: args.includes('--verbose'),
};
for (const a of args) if (a.startsWith('--category=')) opts.category = a.split('=')[1];

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

// ── 파일 유틸 ─────────────────────────────────────
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === '__tests__') continue;
      walk(full, exts, out);
    } else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}
const rel = (f) => f.replace(ROOT + '/', '');
const read = (f) => fs.readFileSync(f, 'utf-8');

// ── 베이스라인 ───────────────────────────────────
let baseline = {};
try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')); } catch { baseline = {}; }
const newBaseline = { _comment: '래칫 베이스라인 — guard-invariants.js --update-baseline 으로만 갱신. 수동 편집 금지.', _updated: new Date().toISOString().slice(0, 10) };

/**
 * 래칫 판정 공통기: current = { 파일: 위반수 }, key = 베이스라인 키.
 * 실패 = 파일별 위반수가 베이스라인 초과 또는 베이스라인에 없는 파일에서 신규 발생.
 */
function ratchet(key, current, sampleLines) {
  newBaseline[key] = current;
  const base = baseline[key] || {};
  const fails = [];
  let improved = 0;
  for (const [f, n] of Object.entries(current)) {
    const b = base[f] ?? 0;
    if (n > b) fails.push(`${f}: ${b} → ${n} (+${n - b})`);
    else if (n < b) improved++;
  }
  const curTotal = Object.values(current).reduce((a, b) => a + b, 0);
  const baseTotal = Object.values(base).filter((v) => typeof v === 'number').reduce((a, b) => a + b, 0);
  return { fails, curTotal, baseTotal, improved, sampleLines };
}

// ── 결과 수집 ─────────────────────────────────────
const results = []; // { category, name, ok, warnOnly, detail: [] }
function report(category, name, ok, detail = [], warnOnly = false) {
  results.push({ category, name, ok, detail, warnOnly });
}

// ═══════════════════════════════════════════════
// 1. mock — 하드 게이트 0건 (CLAUDE.md 🚫 mock 데이터 절대 금지)
// ═══════════════════════════════════════════════
function checkMock() {
  const targets = [
    ...walk(`${ROOT}/dev-frontend/src`, ['.ts', '.tsx']),
    ...walk(`${ROOT}/dev-backend/routes`, ['.js']),
    ...walk(`${ROOT}/dev-backend/services`, ['.js']),
    ...walk(`${ROOT}/dev-backend/models`, ['.js']),
    ...walk(`${ROOT}/dev-backend/middleware`, ['.js']),
  ];
  const re = /\bmock[A-Z_]\w*|\bdummyData\b|\bDUMMY_DATA\b|\bMOCK_[A-Z]/;
  const hits = [];
  for (const f of targets) {
    read(f).split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (re.test(l)) hits.push(`${rel(f)}:${i + 1}: ${t.slice(0, 90)}`);
    });
  }
  report('mock', 'mock/dummy 데이터 잔재 0건 (하드 게이트)', hits.length === 0, hits);
}

// ═══════════════════════════════════════════════
// 2. i18n — 한국어 하드코딩 래칫
//    memory feedback_i18n_tdefault_not_hardcoding: t() 폴백은 하드코딩 아님 → 제외.
// ═══════════════════════════════════════════════
function checkI18n() {
  const files = walk(`${ROOT}/dev-frontend/src`, ['.ts', '.tsx']);
  const re = /(['"`])[^'"`]*[가-힣][^'"`]*\1/;
  const current = {};
  const samples = [];
  for (const f of files) {
    let n = 0;
    read(f).split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (!re.test(l)) return;
      // t() 폴백·i18n 키·콘솔로그·주석성 라벨 제외
      if (/\bt\(|i18nKey|defaultValue|console\.(log|warn|error|info)/.test(l)) return;
      n++;
      if (samples.length < 8) samples.push(`${rel(f)}:${i + 1}: ${t.slice(0, 80)}`);
    });
    if (n > 0) current[rel(f)] = n;
  }
  const r = ratchet('i18n', current);
  const detail = r.fails.length ? [...r.fails, ...(opts.verbose ? samples : [])] : [];
  report('i18n', `한국어 하드코딩 래칫 (현재 ${r.curTotal} / 베이스 ${r.baseTotal})`, r.fails.length === 0, detail);
  if (r.improved > 0 && r.fails.length === 0) {
    report('i18n', `부채 ${r.improved}개 파일 감소 — --update-baseline 으로 조이기 권장`, true, [], true);
  }
}

// ═══════════════════════════════════════════════
// 2b. parity — locales ko/en 키 패리티 래칫 + i18n.ts ns 등록 하드 게이트
//     "기획 단계부터 ko/en 동시 작성" (CLAUDE.md 다국어 필수) 자동 검출.
// ═══════════════════════════════════════════════
function flattenKeys(obj, prefix = '', out = []) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') flattenKeys(v, prefix + k + '.', out);
    else out.push(prefix + k);
  }
  return out;
}
function checkParity() {
  const koDir = `${ROOT}/dev-frontend/public/locales/ko`;
  const enDir = `${ROOT}/dev-frontend/public/locales/en`;
  const koFiles = fs.readdirSync(koDir).filter((f) => f.endsWith('.json')).sort();
  const enFiles = fs.readdirSync(enDir).filter((f) => f.endsWith('.json')).sort();

  // (1) 파일 목록 일치 — 하드 게이트
  const onlyKo = koFiles.filter((f) => !enFiles.includes(f));
  const onlyEn = enFiles.filter((f) => !koFiles.includes(f));
  report('parity', 'locales ko/en 네임스페이스 파일 일치 (하드 게이트)', onlyKo.length + onlyEn.length === 0,
    [...onlyKo.map((f) => `ko에만 존재: ${f}`), ...onlyEn.map((f) => `en에만 존재: ${f}`)]);

  // (2) i18n.ts ns 배열 등록 — 하드 게이트 (JSON 있는데 미등록 = silent 미번역)
  const i18nSrc = read(`${ROOT}/dev-frontend/src/i18n.ts`);
  const unregistered = koFiles.map((f) => f.replace('.json', '')).filter((ns) => !new RegExp(`['"]${ns}['"]`).test(i18nSrc));
  report('parity', 'i18n.ts ns 배열 등록 (하드 게이트)', unregistered.length === 0,
    unregistered.map((ns) => `locales/${ns}.json 존재하나 i18n.ts ns 배열에 미등록`));

  // (3) 키 패리티 — 래칫 (기존 누락은 동결, 신규 누락만 실패)
  const current = {};
  const samples = [];
  for (const f of koFiles) {
    if (!enFiles.includes(f)) continue;
    try {
      const ko = new Set(flattenKeys(JSON.parse(read(path.join(koDir, f)))));
      const en = new Set(flattenKeys(JSON.parse(read(path.join(enDir, f)))));
      const missEn = [...ko].filter((k) => !en.has(k));
      const missKo = [...en].filter((k) => !ko.has(k));
      const n = missEn.length + missKo.length;
      if (n > 0) {
        current[f] = n;
        missEn.slice(0, 3).forEach((k) => samples.push(`${f}: en 누락 키 "${k}"`));
        missKo.slice(0, 3).forEach((k) => samples.push(`${f}: ko 누락 키 "${k}"`));
      }
    } catch (e) { current[f] = 9999; samples.push(`${f}: JSON parse 실패 — ${e.message}`); }
  }
  const r = ratchet('parity_keys', current);
  const detail = r.fails.length ? [...r.fails, ...samples] : (opts.verbose ? samples : []);
  report('parity', `ko/en 키 패리티 래칫 (불일치 ${r.curTotal}키 / 베이스 ${r.baseTotal}키)`, r.fails.length === 0, detail);
}

// ═══════════════════════════════════════════════
// 3. tenant — routes/ 의 list 쿼리 business_id/scope 마커 래칫
//    Sequelize WHERE 수동 강제 환경 — 신규 무마커 쿼리 유입만 차단 (기존은 베이스라인 동결).
// ═══════════════════════════════════════════════
const NON_TENANT_MODELS = new Set([
  'User', 'RefreshToken', 'PlatformSetting', 'PlatformSettings',
  'HelpArticle', 'HelpCategory', 'PushLog', 'EmailLog', 'ContactInquiry',
  'Plan', 'DocumentTemplate', 'Payment',
]);
// 호출 스니펫 안에서 "테넌트 스코프 처리됨" 으로 인정하는 마커
const TENANT_MARKERS = /business_id|businessId|listWhere|Where\(scope|scope\)|attachWorkspaceScope|canAccess|req\.workspace|findByPk/;

function extractCallSnippet(src, idx) {
  // idx = '(' 위치. 괄호 균형으로 호출 인자 스니펫 추출 (최대 2500자)
  let depth = 0;
  for (let i = idx; i < Math.min(src.length, idx + 2500); i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  return src.slice(idx, idx + 2500);
}

function checkTenant() {
  const files = walk(`${ROOT}/dev-backend/routes`, ['.js']);
  const current = {};
  const samples = [];
  for (const f of files) {
    const src = read(f);
    const re = /\b([A-Z]\w+)\.(findAll|findAndCountAll)\s*\(/g;
    let m; let n = 0;
    while ((m = re.exec(src)) !== null) {
      const model = m[1];
      if (NON_TENANT_MODELS.has(model)) continue;
      if (model === 'Promise' || model === 'Op') continue;
      const snippet = extractCallSnippet(src, re.lastIndex - 1);
      // 스니펫 자체 또는 직전 30줄 컨텍스트에 스코프 마커가 있으면 통과
      const before = src.slice(Math.max(0, m.index - 1800), m.index);
      if (TENANT_MARKERS.test(snippet) || TENANT_MARKERS.test(before)) continue;
      n++;
      const line = src.slice(0, m.index).split('\n').length;
      if (samples.length < 10) samples.push(`${rel(f)}:${line}: ${model}.${m[2]}(...) — business_id/scope 마커 없음`);
    }
    if (n > 0) current[rel(f)] = n;
  }
  const r = ratchet('tenant', current);
  const detail = r.fails.length ? [...r.fails, ...samples] : (opts.verbose ? samples : []);
  report('tenant', `무스코프 list 쿼리 래칫 (현재 ${r.curTotal} / 베이스 ${r.baseTotal})`, r.fails.length === 0, detail);
}

// ═══════════════════════════════════════════════
// 4. pagination — GET list 파일 단위 래칫 (CLAUDE.md List 라우트 pagination 표준)
// ═══════════════════════════════════════════════
function checkPagination() {
  const files = walk(`${ROOT}/dev-backend/routes`, ['.js']);
  const current = {};
  for (const f of files) {
    const src = read(f);
    const hasGetList = /router\.get\([^)]*\)/.test(src) && /\.findAll\s*\(/.test(src);
    if (!hasGetList) continue;
    const hasPagination = /parsePagination|paginatedResponse/.test(src);
    const hasLimit = /\blimit\s*[:,]/.test(src);
    if (!hasPagination && !hasLimit) current[rel(f)] = 1;
  }
  const r = ratchet('pagination', current);
  report('pagination',
    `pagination/limit 없는 GET list 파일 래칫 (현재 ${Object.keys(current).length}개 / 베이스 ${Object.keys(baseline.pagination || {}).length}개)`,
    r.fails.length === 0, r.fails.map((x) => x + ' — parsePagination+paginatedResponse 적용 필요'));
}

// ═══════════════════════════════════════════════
// 5. notify — 잠금 (CLAUDE.md 운영 안정성 §13: 메시지/status 전이 라우트는 notify 강제)
//    사이클 N+13 실회귀: projects.js 메시지 라우트 + task_workflow.js 7 라우트 notify 누락 → OS push 0.
// ═══════════════════════════════════════════════
const NOTIFY_LOCKED = [
  'dev-backend/routes/conversations.js',
  'dev-backend/routes/projects.js',
  'dev-backend/routes/task_workflow.js',
  'dev-backend/routes/tasks.js',
  'dev-backend/routes/invoices.js',
  'dev-backend/routes/signatures.js',
  'dev-backend/routes/calendar.js',
];
function checkNotify() {
  const missing = [];
  for (const f of NOTIFY_LOCKED) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { missing.push(`${f}: 파일 없음 (이동했으면 guard-invariants.js NOTIFY_LOCKED 갱신)`); continue; }
    if (!/\bnotify(Many)?\s*\(/.test(read(full))) missing.push(`${f}: notify()/notifyMany() 호출 소멸 — §13 회귀 (push 0건 위험)`);
  }
  report('notify', `메시지·전이 라우트 notify 잠금 (${NOTIFY_LOCKED.length}개 파일)`, missing.length === 0, missing);
}

// ═══════════════════════════════════════════════
// 6. broadcast — 잠금 (CLAUDE.md 운영 안정성 §16-b: 변경 라우트 socket broadcast 강제)
// ═══════════════════════════════════════════════
const BROADCAST_LOCKED = [
  'dev-backend/routes/tasks.js',
  'dev-backend/routes/task_workflow.js',
  'dev-backend/routes/conversations.js',
  'dev-backend/routes/posts.js',
  'dev-backend/routes/files.js',
  'dev-backend/routes/invoices.js',
  'dev-backend/routes/calendar.js',
  'dev-backend/routes/projects.js',
];
function checkBroadcast() {
  const missing = [];
  for (const f of BROADCAST_LOCKED) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { missing.push(`${f}: 파일 없음 (이동했으면 BROADCAST_LOCKED 갱신)`); continue; }
    if (!/io\.to\(|broadcast/.test(read(full))) missing.push(`${f}: io.to()/broadcast 소멸 — §16 회귀 ("리프레시해야 보임" 호소 재발)`);
  }
  report('broadcast', `변경 라우트 socket broadcast 잠금 (${BROADCAST_LOCKED.length}개 파일)`, missing.length === 0, missing);
}

// ═══════════════════════════════════════════════
// 7. finance — invoices.js owner_only 가드 잠금 (PERMISSION_MATRIX §5.10)
//    send / mark-paid / unmark-paid / mark-tax-invoice / delete 5개 라우트 보호.
// ═══════════════════════════════════════════════
function checkFinance() {
  const f = path.join(ROOT, 'dev-backend/routes/invoices.js');
  const detail = [];
  if (!fs.existsSync(f)) detail.push('routes/invoices.js 없음');
  else {
    const n = (read(f).match(/assertInvoiceMutationOwner/g) || []).length;
    if (n < 5) detail.push(`assertInvoiceMutationOwner 등장 ${n}회 (< 5) — 재무 mutation owner 가드 소실 의심`);
  }
  report('finance', 'Invoice 재무 owner_only 가드 잠금 (≥5 호출)', detail.length === 0, detail);
}

// ═══════════════════════════════════════════════
// 7-b. cuefinance — Cue(AI) 재무 행동 영구 봉쇄 (Irene 확정, 되돌리지 말 것)
//   Cue 는 청구서·결제·구독을 절대 생성/수정/삭제하지 않는다. 사람이 누른 것만 돈이 움직인다.
//   읽기(컨텍스트용 조회)는 허용 — 권한자에게만 보이도록 cue_context 가 이미 scope 를 건다.
//   여기서 막는 건 '쓰기' 와 '결제 확정 서비스 호출'. 신규 Cue 코드가 이 선을 넘으면 exit 1.
// ═══════════════════════════════════════════════
const CUE_FILES = [
  'dev-backend/services/cue_task_executor.js',
  'dev-backend/services/cue_orchestrator.js',
  'dev-backend/services/cue_context.js',
  'dev-backend/services/cueKnowledge.js',
  'dev-backend/routes/cue.js',
  'dev-backend/routes/cue_knowledge.js',
];
const FIN_MODELS = ['Invoice', 'InvoiceItem', 'InvoiceInstallment', 'InvoicePayment', 'Payment', 'ClientSubscription', 'BillEvent'];
const FIN_SERVICES = /require\([^)]*(invoicePayments|billing|clientSubscriptionBilling|recurring_invoice|overdue_handler|stripe)[^)]*\)/i;
const FIN_WRITE = new RegExp(`\\b(${FIN_MODELS.join('|')})\\s*\\.\\s*(create|update|destroy|upsert|increment|decrement|bulkCreate)\\s*\\(`);
const FIN_PAY_FN = /\b(markInvoicePaid|markInstallmentPaid|markPaymentPaid|ensureRenewalPayment|createInvoice)\s*\(/;

// 주석(줄 //, 블록 /* */)을 공백으로 치환 — 주석 안 예시 코드가 오탐되지 않게, 그러면서
// 멀티라인 코드는 그대로 남겨 줄바꿈 우회를 막는다.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length))
    .replace(/([^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - 1));
}

function checkCueFinance() {
  const viol = [];
  const at = (src, idx) => src.slice(0, idx).split('\n').length;
  for (const f of CUE_FILES) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;   // 파일 이동/삭제는 다른 가드가 잡음
    const src = read(full);
    const code = stripComments(src);
    for (const m of code.matchAll(new RegExp(FIN_WRITE.source, 'g'))) viol.push(`${f}:${at(src, m.index)} 재무 모델 쓰기 — ${m[0]}`);
    for (const m of code.matchAll(new RegExp(FIN_PAY_FN.source, 'g'))) viol.push(`${f}:${at(src, m.index)} 결제 확정 함수 호출 — ${m[0]}`);
    for (const m of code.matchAll(new RegExp(FIN_SERVICES.source, 'gi'))) viol.push(`${f}:${at(src, m.index)} 재무 서비스 require — ${m[0].slice(0, 60)}`);
  }
  report('cuefinance', `Cue 재무 행동 영구 봉쇄 (${CUE_FILES.length}개 파일, 쓰기·결제확정·재무서비스 0건)`, viol.length === 0, viol);
}

// ═══════════════════════════════════════════════
// 7-c. cueauth — Cue(AI) 권한 우회 차단
//   Cue 는 위임자(업무 요청자)의 권한으로만 행동한다. 실행기가 access_scope 게이트를 잃거나,
//   taskTransition 단일 착지점을 우회해 status 를 직접 쓰면 사람 가드(reviewer 등)가 무력화된다.
// ═══════════════════════════════════════════════
function checkCueAuth() {
  const f = 'dev-backend/services/cue_task_executor.js';
  const full = path.join(ROOT, f);
  const detail = [];
  if (!fs.existsSync(full)) {
    detail.push(`${f} 없음 (이동했으면 이 가드 갱신)`);
  } else {
    const src = read(full);
    if (!/access_scope/.test(src)) detail.push(`${f}: access_scope 참조 소멸 — Cue 가 권한 게이트 없이 데이터를 읽는다`);
    if (!/canAccessConversation/.test(src)) detail.push(`${f}: canAccessConversation 소멸 — 대화방 IDOR 재개방`);
    if (!/resolvePrincipal|acting_for/.test(src)) detail.push(`${f}: 위임 주체(principal) 해석 소멸 — 권한 원소유자 불명`);
    if (!/submitForReview/.test(src)) detail.push(`${f}: taskTransition 우회 — 상태 전이가 사람 가드를 통과하지 않는다`);
    // status 직접 쓰기 금지 (taskTransition 경유만). 멀티라인 표기도 잡는다 —
    //   .update({\n  status: 'reviewing',\n }) 처럼 줄바꿈하면 라인 단위 검사는 못 본다 (Fable 지적).
    for (const m of stripComments(src).matchAll(/\.update\(\s*\{[\s\S]{0,200}?status\s*:/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      detail.push(`${f}:~${line} status 직접 쓰기 — taskTransition 경유 필수`);
    }
  }
  report('cueauth', 'Cue 권한 모델 잠금 (위임자 scope · 읽기 게이트 · 전이 단일착지점)', detail.length === 0, detail);
}

// ═══════════════════════════════════════════════
// 8. costguard — 외부비용 라우트 잠금 (운영 안정성 §1)
// ═══════════════════════════════════════════════
const COSTGUARD_LOCKED = [
  'dev-backend/routes/cue.js',
  'dev-backend/routes/tasks.js',
  'dev-backend/routes/posts.js',
  'dev-backend/routes/share.js',
  'dev-backend/routes/users.js',
  'dev-backend/routes/clients.js',
  'dev-backend/routes/businesses.js',
  'dev-backend/routes/inquiries.js',
  'dev-backend/routes/message_attachments.js',
  'dev-backend/routes/task_attachments.js',
  'dev-backend/routes/task_estimations.js',
];
function checkCostGuard() {
  const missing = [];
  for (const f of COSTGUARD_LOCKED) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { missing.push(`${f}: 파일 없음 (이동했으면 COSTGUARD_LOCKED 갱신)`); continue; }
    if (!/costGuard/.test(read(full))) missing.push(`${f}: costGuard 참조 소멸 — LLM/발송 quota 폭주 위험`);
  }
  report('costguard', `외부비용 라우트 costGuard 잠금 (${COSTGUARD_LOCKED.length}개 파일)`, missing.length === 0, missing);
}

// ═══════════════════════════════════════════════
// 9. godfile — 신규 god-file 차단 래칫 (기존 초과분은 동결, 15% 이상 추가 성장도 실패)
// ═══════════════════════════════════════════════
function checkGodfile() {
  const current = {};
  for (const f of walk(`${ROOT}/dev-backend/routes`, ['.js'])) {
    const n = read(f).split('\n').length;
    if (n > 500) current[rel(f)] = n;
  }
  for (const f of [...walk(`${ROOT}/dev-frontend/src/components`, ['.tsx']), ...walk(`${ROOT}/dev-frontend/src/pages`, ['.tsx'])]) {
    const n = read(f).split('\n').length;
    if (n > 800) current[rel(f)] = n;
  }
  newBaseline.godfile = current;
  const base = baseline.godfile || {};
  const fails = [];
  for (const [f, n] of Object.entries(current)) {
    const b = base[f];
    if (b === undefined) fails.push(`${f}: ${n}줄 — 신규 god-file (라우트>500/컴포넌트>800). 분리 설계 필요`);
    else if (n > b * 1.15) fails.push(`${f}: ${b} → ${n}줄 (+${Math.round((n / b - 1) * 100)}%) — 동결 초과 성장`);
  }
  report('godfile', `god-file 래칫 (동결 ${Object.keys(base).length}개 / 현재 ${Object.keys(current).length}개)`, fails.length === 0, fails);
}

// ═══════════════════════════════════════════════
// 10. docfresh — 핵심 문서 신선도 (경고만 — 게이트 실패 아님)
// ═══════════════════════════════════════════════
function checkDocFresh() {
  const DOCS = ['docs/SYSTEM_ARCHITECTURE.md', 'docs/DATABASE_ERD.md', 'docs/ONBOARDING.md', 'docs/PERMISSION_MATRIX.md'];
  const stale = [];
  for (const d of DOCS) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) { stale.push(`${d}: 없음`); continue; }
    const days = (Date.now() - fs.statSync(full).mtimeMs) / 86400000;
    if (days > 60) stale.push(`${d}: ${Math.round(days)}일 미갱신`);
  }
  report('docfresh', '핵심 문서 신선도 60일 (경고만)', stale.length === 0, stale, true);
}

// ── 메인 ─────────────────────────────────────────
const CATEGORIES = {
  mock: checkMock,
  i18n: checkI18n,
  parity: checkParity,
  tenant: checkTenant,
  pagination: checkPagination,
  notify: checkNotify,
  broadcast: checkBroadcast,
  finance: checkFinance,
  cuefinance: checkCueFinance,
  cueauth: checkCueAuth,
  costguard: checkCostGuard,
  godfile: checkGodfile,
  docfresh: checkDocFresh,
};

try {
  console.log(`\n${c.bold(c.cyan('═══ PlanQ 불변식 가드 (guard-invariants) ═══'))}`);
  const run = opts.category ? { [opts.category]: CATEGORIES[opts.category] } : CATEGORIES;
  if (opts.category && !CATEGORIES[opts.category]) {
    console.error(c.red(`알 수 없는 카테고리: ${opts.category} (가능: ${Object.keys(CATEGORIES).join(', ')})`));
    process.exit(2);
  }
  for (const fn of Object.values(run)) fn();

  let fail = 0;
  let lastCat = '';
  for (const r of results) {
    if (r.category !== lastCat) { console.log(`\n${c.cyan(c.bold('▶ ' + r.category.toUpperCase()))}`); lastCat = r.category; }
    const mark = r.ok ? c.green('✓') : (r.warnOnly ? c.yellow('⚠') : c.red('✗'));
    console.log(`  ${mark} ${r.name}`);
    const show = opts.verbose ? r.detail : r.detail.slice(0, 8);
    show.forEach((d) => console.log(`      ${r.ok || r.warnOnly ? c.gray(d) : c.red(d)}`));
    if (!opts.verbose && r.detail.length > 8) console.log(c.gray(`      ... 외 ${r.detail.length - 8}건 (--verbose)`));
    if (!r.ok && !r.warnOnly) fail++;
  }

  if (opts.update) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2) + '\n');
    console.log(`\n${c.yellow('베이스라인 갱신됨: ' + rel(BASELINE_PATH))}`);
  }

  console.log('\n' + c.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  if (fail === 0) console.log(c.green(c.bold(`✓ 불변식 가드 통과 (${results.filter((r) => r.ok).length}/${results.length})`)));
  else console.log(c.red(c.bold(`✗ ${fail}개 카테고리 실패 — 신규 위반을 정리하거나, 의도된 부채 감소면 --update-baseline`)));
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error(c.red('guard-invariants 자체 오류: ' + e.message));
  console.error(c.gray(e.stack));
  process.exit(2);
}
