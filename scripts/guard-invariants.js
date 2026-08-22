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
// 기존 베이스라인에서 출발한다 — 빈 객체에서 시작하면 이번 실행에서 돌지 않은 카테고리
//   (예: `--category=i18n --update-baseline`) 의 키가 통째로 사라져, 파일을 덮어쓰는 순간
//   tenant·pagination·godfile 래칫이 베이스 0 으로 리셋된다(= 가드가 조용히 죽는다).
//   실제로 그렇게 95줄이 날아간 적이 있다. 돌린 카테고리만 갱신하고 나머지는 보존한다.
const newBaseline = { ...baseline };
newBaseline._comment = '래칫 베이스라인 — guard-invariants.js --update-baseline 으로만 갱신. 수동 편집 금지.';
newBaseline._updated = new Date().toISOString().slice(0, 10);

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
    // ★ 여러 줄 주석 **상태**를 추적한다. 옛 코드는 각 줄을 독립 검사해 블록 주석의 **첫 줄만**
    //   주석으로 인식했다 — 둘째 줄부터 따옴표 안에 한국어를 인용하면(예: 옛 동작을 설명하려고
    //   "…" 로 옮겨 적을 때) 하드코딩으로 오탐했다. 오탐은 `--update-baseline` 을 부르고,
    //   그 순간 **진짜 부채가 같이 통과**한다 — 가드가 조용히 죽는 경로다.
    let inBlock = false;
    const srcAll = read(f);
    // ★ 번역 함수 **별칭**도 t() 다. `const { t: tp } = useTranslation('qproject')` 처럼 한 파일에서
    //   여러 네임스페이스를 쓸 때 별칭이 붙는데, 옛 검사는 `t(` 만 알아서 `tp('키','기본값')` 를
    //   전부 하드코딩으로 셌다. 오탐이 쌓이면 --update-baseline 을 부르고, 그 순간 진짜 부채가
    //   같이 통과한다 (memory feedback_guard_must_be_falsified). 별칭은 파일에서 읽어 정확히 좁힌다.
    const aliases = new Set(['t']);
    for (const m of srcAll.matchAll(/\{\s*t\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*useTranslation/g)) {
      aliases.add(m[1]);
    }
    const callRe = new RegExp(`\\b(?:${[...aliases].join('|')})\\(`);
    srcAll.split('\n').forEach((l, i) => {
      const t = l.trim();
      if (inBlock) {
        if (t.includes('*/')) inBlock = false;
        return;   // 닫는 줄까지는 주석
      }
      // JSX 주석 `{/* … */}` 도 주석이다.
      if (t.startsWith('//') || t.startsWith('*')) return;
      if (t.startsWith('/*') || t.startsWith('{/*')) {
        if (!t.includes('*/')) inBlock = true;   // 같은 줄에서 안 닫히면 블록 진입
        return;
      }
      if (!re.test(l)) return;
      // t() 폴백·i18n 키·콘솔로그·주석성 라벨 제외
      if (callRe.test(l) || /i18nKey|defaultValue|console\.(log|warn|error|info)/.test(l)) return;
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
  // 업무 전이의 notify 는 라우트가 아니라 **행동 계층**에 있다 (D-3) — 사람도 Cue 도 같은 문을 지나므로
  //   여기를 잠가야 Cue 경로의 알림 누락까지 같이 막힌다. 라우트만 잠그면 Cue 가 우회한다.
  'dev-backend/services/actions/task_actions.js',
  'dev-backend/services/taskTransition.js',
  'dev-backend/routes/tasks.js',
  'dev-backend/routes/invoices.js',
  // 서명·확인의 notify 는 #239 분리 후 **공용 코어**에 있다 (routes/signatures.js 와
  //   routes/signature_confirm.js 가 같은 문을 지난다). 위 task_actions 와 같은 이유로 코어를 잠근다 —
  //   라우트만 잠그면 확인 경로가 우회한다.
  'dev-backend/services/signatureCore.js',
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
  // 업무 전이의 broadcast 도 행동 계층에 있다 (D-3)
  'dev-backend/services/actions/task_actions.js',
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
// 6-b. broadcastactor — task broadcast payload 에 actor_user_id 잠금 (운영 #278·#282)
//
//   왜 있는가 — 프론트 NotificationToaster 는 `task.actor_user_id === me` 로 **본인이 한 액션의
//   토스터**를 거른다. 그런데 액션 계층의 broadcastTask() 만 그 값을 안 실어서 필터가 영구 무력이었고,
//   "내가 승인했는데 나한테 완료 알림이 온다"(#282) · "같은 알림이 2개"(#278) 가 났다.
//   emit 지점이 늘어날 때마다 같은 결함이 재발하므로 정적으로 못박는다.
//
//   판정: broadcastTask 정의가 actorUserId 파라미터를 갖고 payload 에 반영하는가 +
//         호출부가 actor 를 넘기는가 (인자 2개 이하로 부르면 누락).
// ═══════════════════════════════════════════════
function checkBroadcastActor() {
  const detail = [];
  const defFile = path.join(ROOT, 'dev-backend/services/taskTransition.js');
  if (!fs.existsSync(defFile)) {
    detail.push('services/taskTransition.js 없음 (이동했으면 이 가드 갱신)');
  } else {
    const src = read(defFile);
    if (!/function broadcastTask\([^)]*actorUserId/.test(src)) {
      detail.push('taskTransition.broadcastTask 시그니처에 actorUserId 없음 — 토스터 자기필터 무력화 회귀');
    }
    // ★ 반드시 **broadcastTask 함수 본문 안**에서만 찾는다.
    //   파일 전체를 보면 TaskStatusHistory.create 의 `actor_user_id: actorUserId` (감사 이력)에
    //   걸려 거짓 통과한다 — 실제로 payload 대입을 지워도 가드가 못 잡는 것을 반증으로 확인했다
    //   (같은 파일에 같은 키 이름이 3번 나온다). 가드는 깨뜨려 확인해야 한다.
    const bodyStart = src.indexOf('async function broadcastTask(');
    if (bodyStart === -1) {
      detail.push('broadcastTask 정의를 찾지 못함 — 이름이 바뀌었으면 이 가드 갱신');
    } else {
      // 다음 최상위 선언(`\nasync function` / `\nfunction`) 직전까지를 본문으로 본다.
      const rest = src.slice(bodyStart + 1);
      const nextDecl = rest.search(/\n(async )?function \w/);
      const body = nextDecl === -1 ? rest : rest.slice(0, nextDecl);
      if (!/actor_user_id:\s*actorUserId/.test(body)) {
        detail.push('broadcastTask payload 에 actor_user_id 미반영 — 파라미터만 있고 안 실린다');
      }
    }
  }
  // 호출부 — actor 인자 없이 부르면 그 경로만 조용히 자기알림이 살아난다.
  for (const f of ['dev-backend/services/actions/task_actions.js', 'dev-backend/services/taskTransition.js']) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) continue;
    read(full).split('\n').forEach((line, i) => {
      // 주석 줄 제외 — 설명문 안의 `broadcastTask(task);` 예시를 호출부로 오인하면 거짓 FAIL 이 난다.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const m = line.match(/(?<!function )broadcastTask\(([^)]*)\)/);
      if (!m) return;
      if (/^\s*(async )?function/.test(line)) return;         // 정의부 제외
      const args = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (args.length < 3) detail.push(`${f}:${i + 1} broadcastTask 호출에 actor 인자 누락 — ${line.trim().slice(0, 70)}`);
    });
  }
  report('broadcastactor', 'task broadcast actor_user_id 잠금 (#278·#282 자기알림 재발 차단)', detail.length === 0, detail);
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
// 8-b. llmgateway — 모든 LLM 호출은 게이트웨이(services/llm.js) 단일 지점을 지난다
//
//   raw fetch 가 다시 기어들어오면: 재시도·타임아웃·입력상한·비용관측이 그 호출에만 없다.
//   여태 13곳이 각자 fetch 를 복붙해서 429 를 아무도 재시도하지 않았고(초안·번역이 조용히 실패),
//   모델을 바꾸려면 13곳을 고쳐야 했고, 한 달에 몇 번 불렀는지 아무도 몰랐다.
//   툴 호출(#81 Cue 실행)·모델 라우팅·평가훅이 앉을 자리도 이 단일 지점이다.
// ═══════════════════════════════════════════════
const LLM_GATEWAY = 'dev-backend/services/llm.js';

function checkLlmGateway() {
  const bad = [];
  const dirs = ['dev-backend/routes', 'dev-backend/services', 'dev-backend/scripts'];
  for (const d of dirs) {
    for (const f of walk(path.join(ROOT, d), ['.js'])) {
      if (rel(f) === LLM_GATEWAY) continue;   // 게이트웨이 자신만 예외
      const src = read(f);
      if (/api\.openai\.com/.test(src)) {
        bad.push(`${rel(f)}: OpenAI 직접 호출 — services/llm.js 의 callLLM/embed 를 쓸 것`);
      }
    }
  }
  // 게이트웨이가 사라지거나 핵심 기능이 빠지면 그것도 실패 (파일만 남고 속이 빈 경우 차단)
  const gw = path.join(ROOT, LLM_GATEWAY);
  if (!fs.existsSync(gw)) bad.push(`${LLM_GATEWAY}: 게이트웨이 파일 없음`);
  else {
    const src = read(gw);
    for (const [feature, re] of [
      ['재시도', /RETRYABLE|MAX_ATTEMPTS/],
      ['타임아웃', /AbortSignal\.timeout/],
      ['입력 상한', /maxInputChars/],
      ['툴 호출', /tool_calls/],
      ['비용 관측', /getStats/],
    ]) {
      if (!re.test(src)) bad.push(`${LLM_GATEWAY}: ${feature} 소실 — 게이트웨이의 존재 이유가 빠졌다`);
    }
  }
  report('llmgateway', 'LLM 호출은 게이트웨이 단일 지점 (raw fetch 0)', bad.length === 0, bad);
}

// ═══════════════════════════════════════════════
// 8-c. actionlayer — 업무 상태 전이는 행동 계층 단일 착지점을 지난다
//
//   라우트가 직접 status 를 쓰고 이력·알림을 인라인으로 처리하면, 라우트를 지나지 않는 실행자
//   (Cue·cron)는 그 규칙을 통째로 우회한다. 실제로 그랬다 — Cue 가 일을 끝내도 이력도 알림도
//   화면 갱신도 없었다. 라우트는 파싱·응답만, 규칙은 services/actions/task_actions.js 안에.
// ═══════════════════════════════════════════════
const ACTION_LAYER = 'dev-backend/services/actions/task_actions.js';
const WORKFLOW_ROUTE = 'dev-backend/routes/task_workflow.js';

function checkActionLayer() {
  const bad = [];
  const layer = path.join(ROOT, ACTION_LAYER);
  if (!fs.existsSync(layer)) {
    bad.push(`${ACTION_LAYER}: 행동 계층 파일 없음`);
  } else {
    const src = read(layer);
    for (const [feature, re] of [
      ['권한 검사', /isAssignee|canManageReviewers/],
      ['전이 규칙', /recalcStatusFromReviewers/],
      ['이력 기록', /TaskStatusHistory/],
      ['알림', /notify/],
      ['broadcast', /broadcastTask/],
    ]) {
      if (!re.test(src)) bad.push(`${ACTION_LAYER}: ${feature} 소실 — 행동 계층의 존재 이유가 빠졌다`);
    }
  }

  // 라우트는 얇아야 한다 — 상태를 직접 쓰거나 이력·알림을 인라인으로 처리하면 우회 구멍이 다시 열린다.
  const route = path.join(ROOT, WORKFLOW_ROUTE);
  if (fs.existsSync(route)) {
    const src = read(route);
    if (/TaskStatusHistory\.create/.test(src)) bad.push(`${WORKFLOW_ROUTE}: 라우트가 이력을 직접 쓴다 — 행동 계층으로`);
    if (/status:\s*'(reviewing|completed|in_progress|revision_requested|waiting|canceled)'/.test(src)) {
      bad.push(`${WORKFLOW_ROUTE}: 라우트가 status 를 직접 쓴다 — 행동 계층으로 (Cue 가 우회한다)`);
    }
    if (/sequelize\.transaction\(/.test(src)) bad.push(`${WORKFLOW_ROUTE}: 라우트가 트랜잭션을 연다 — 도메인 로직이 새고 있다`);
  }
  report('actionlayer', '업무 전이는 행동 계층 단일 착지점 (라우트는 파싱·응답만)', bad.length === 0, bad);
}

// ═══════════════════════════════════════════════
// 8-d. createlayer — 업무·댓글·일정·문서 **생성**도 행동 계층을 지난다 (D-3 2A · 3사이클)
//
//   생성이 여러 곳에 복제돼 있었다(POST /tasks · ai-create/confirm · registerCandidate · copy ·
//   POST /events · POST /documents). 같은 실패에 다른 에러 문자열, 같은 성공에 다른 부수효과 —
//   어느 문으로 들어오느냐로 결과가 달랐다. 라우트가 다시 직접 create 를 부르면 그 문에는
//   권한(메뉴)·알림·감사·socket 이 없다. #81 Cue 대화형 실행이 이 문들을 지나게 하는 것이 목적.
// ═══════════════════════════════════════════════
const SUBJECT_LAYER = 'dev-backend/services/actions/_subject.js';
const EVENT_LAYER = 'dev-backend/services/actions/event_actions.js';
const DOCUMENT_LAYER = 'dev-backend/services/actions/document_actions.js';

const CREATE_FORBIDDEN = [
  // [파일, 금지 패턴, 허용 건수(기존 부채/의도된 예외)]
  ['dev-backend/routes/tasks.js', /Task\.create\(/g, 1],          // copy 라우트 1건 (2A-5 대상, 동결)
  ['dev-backend/routes/tasks.js', /TaskComment\.create\(/g, 0],
  ['dev-backend/services/task_extractor.js', /Task\.create\(/g, 0],
  // 일정 — 기본 생성은 event_actions.createEvent. 정기일정 분할·예외 파생 복제 2건만 인라인 허용
  //   (편집 트랜잭션 내부에서 기존 이벤트를 복사하는 메커닉 — 생성 액션이 아니다. PUT 라우트가 이미 가드).
  ['dev-backend/routes/calendar.js', /CalendarEvent\.create\(/g, 2],
  // 문서 — 기본 생성은 document_actions.createDocument
  ['dev-backend/routes/docs.js', /Document\.create\(/g, 0],
  // 워크스페이스 간 본인 자료 전송 복사 — 배치 단위 가드(member-of-both) + 배치 감사. per-item 게이트는
  //   성능·감사 회귀라 인라인 유지. export.js 1건 · worker 2건(전송+Q Note) 동결.
  ['dev-backend/routes/export.js', /Document\.create\(/g, 1],
  ['dev-backend/services/exportJobWorker.js', /Document\.create\(/g, 2],
];

// 각 행동 계층 파일이 존재 이유(권한·부수효과·재무봉쇄)를 실제로 갖고 있는가 — 파일만 남고 속이 비는 것 차단
function checkLayerFeatures(bad, layerRel, features, { blockFinancial = true } = {}) {
  const full = path.join(ROOT, layerRel);
  if (!fs.existsSync(full)) { bad.push(`${layerRel}: 행동 계층 파일 없음`); return; }
  const src = read(full);
  for (const [feature, re] of features) {
    if (!re.test(src)) bad.push(`${layerRel}: ${feature} 소실 — 생성 계층의 존재 이유가 빠졌다`);
  }
  // 재무는 카탈로그에 없다 (Cue 가 이 문을 통해 돈을 건드릴 수 없다 — 영구 봉쇄). 대문자 모델명만.
  if (blockFinancial && /\b(Invoice|Payment|InvoiceInstallment)\b/.test(src)) {
    bad.push(`${layerRel}: 재무 모델 참조 — Cue 행동 카탈로그에 돈이 들어왔다 (영구 봉쇄 위반)`);
  }
}

function checkCreateLayer() {
  const bad = [];
  for (const [f, re, allowed] of CREATE_FORBIDDEN) {
    const full = path.join(ROOT, f);
    if (!fs.existsSync(full)) { bad.push(`${f}: 파일 없음 (이동했으면 CREATE_FORBIDDEN 갱신)`); continue; }
    const n = (read(full).match(re) || []).length;
    if (n > allowed) {
      bad.push(`${f}: ${String(re).slice(1, -3)} ${n}건 (허용 ${allowed}) — services/actions 의 생성 액션을 쓸 것`);
    }
  }

  // 공용 subject — Cue 는 위임자 권한으로만, 위임자가 AI 면 거부 (권한 세탁 차단)
  checkLayerFeatures(bad, SUBJECT_LAYER, [
    ['위임자 fail-closed', /cue_delegator_required/],
    ['AI 위임자 거부', /delegator_is_ai/],
    ['메뉴 권한', /assertMenuWrite/],
  ]);

  // 업무·댓글 생성 계층
  checkLayerFeatures(bad, ACTION_LAYER, [
    ['createTask', /async function createTask/],
    ['createComment', /async function createComment/],
    ['배정 게이트', /assertAssignable/],
    ['메뉴 권한', /assertMenuWrite/],
    ['커밋 후 부수효과', /afterCommit/],
    ['감사', /task\.create/],
  ]);

  // 일정 생성 계층 — qcalendar 메뉴 게이트 + 감사
  checkLayerFeatures(bad, EVENT_LAYER, [
    ['createEvent', /async function createEvent/],
    ['메뉴 권한(qcalendar)', /assertMenuWrite\([^)]*qcalendar|'qcalendar'/],
    ['감사', /event\.created/],
  ]);

  // 문서 생성 계층 — qdocs 메뉴 게이트 + 감사. 재무 모델 봉쇄.
  checkLayerFeatures(bad, DOCUMENT_LAYER, [
    ['createDocument', /async function createDocument/],
    ['메뉴 권한(qdocs)', /assertMenuWrite\([^)]*qdocs|'qdocs'/],
    ['감사', /document\.create/],
  ]);

  report('createlayer', '업무·댓글·일정·문서 생성도 행동 계층 단일 착지점', bad.length === 0, bad);
}

// ═══════════════════════════════════════════════
// 8-e. cuetools — Cue 대화형 실행(#81): 쓰기는 confirm 게이트를 지나고, 재무는 카탈로그에 없다
//
//   /help 는 툴을 **제안**만 한다(실행 X). 실행은 execute-action → cue_tools.executeTool → 행동 계층.
//   라우트가 행동 계층 create 를 직접 부르면 confirm 게이트를 우회한다 → 차단.
//   Cue 카탈로그에 재무(invoice/payment) 툴이 새로 들어오는 것도 정적으로 막는다(영구 봉쇄).
// ═══════════════════════════════════════════════
const CUE_TOOLS = 'dev-backend/services/cue_tools.js';
const CUE_ROUTE = 'dev-backend/routes/cue.js';

function checkCueTools() {
  const bad = [];
  // 존재 이유(스키마·실행·검증·담당자 해석) + 재무 모델 참조 0 (blockFinancial)
  checkLayerFeatures(bad, CUE_TOOLS, [
    ['TOOL_SCHEMAS', /TOOL_SCHEMAS/],
    ['executeTool', /async function executeTool/],
    ['입력 검증', /function validateNormalize/],
    ['담당자 해석', /resolveAssignees/],
  ]);
  const toolsFull = path.join(ROOT, CUE_TOOLS);
  if (fs.existsSync(toolsFull)) {
    const src = read(toolsFull);
    // 재무 계열이 툴 카탈로그·문서 kind 에 인용부호로 들어오면 실패 (주석의 설명 텍스트는 인용부호가 없어 안 걸림)
    if (/'(invoice|tax_invoice)'/.test(src)) {
      bad.push(`${CUE_TOOLS}: 재무 문서 kind('invoice'/'tax_invoice') 발견 — Cue 카탈로그 재무 봉쇄 위반`);
    }
    if (/name:\s*'(create_invoice|create_payment|mark_paid|issue_receipt)'/i.test(src)) {
      bad.push(`${CUE_TOOLS}: 재무 툴 이름 발견 — Cue 카탈로그 재무 봉쇄 위반`);
    }
  }
  // 라우트는 행동 계층을 직접 require 하지 않는다 — 쓰기는 cue_tools 를 지나야 confirm 게이트가 산다
  const routeFull = path.join(ROOT, CUE_ROUTE);
  if (fs.existsSync(routeFull)) {
    const src = read(routeFull);
    if (/require\(['"]\.\.\/services\/actions\//.test(src)) {
      bad.push(`${CUE_ROUTE}: 행동 계층 직접 require — 쓰기는 cue_tools 경유 (confirm 게이트 우회 차단)`);
    }
    if (!/execute-action/.test(src)) bad.push(`${CUE_ROUTE}: execute-action 라우트 소실`);
  }
  report('cuetools', 'Cue 대화형 실행 — 쓰기 confirm 게이트 + 재무 봉쇄', bad.length === 0, bad);
}

// ═══════════════════════════════════════════════
// 8-f. mcpreadonly — MCP 외부 표면(#D-4)은 읽기 전용. 쓰기는 절대 이 문으로 나가지 않는다
//
//   외부 에이전트에 쓰기를 열면 "Cue 의 권한 우회 직접 write"를 외부에 복제하는 것 — D-4 순서 엄수.
//   MCP 서버는 행동 계층을 require 하지 않고, 도메인 모델을 create/update/destroy 하지 않으며,
//   재무 모델을 참조하지 않는다. 툴 이름에 쓰기 동사(create/update/delete/submit/complete)가 없다.
// ═══════════════════════════════════════════════
const MCP_SERVER = 'dev-backend/mcp/server.js';

function checkMcpReadonly() {
  const bad = [];
  const full = path.join(ROOT, MCP_SERVER);
  if (!fs.existsSync(full)) { report('mcpreadonly', 'MCP 읽기 서버 read-only', true, []); return; }
  const src = read(full);
  // 존재 이유(읽기 4툴·토큰 인증·감사·격리)
  for (const [feature, re] of [
    ['토큰 인증', /token_hash|authenticate/],
    ['scope 격리', /getUserScope/],
    ['감사', /mcp\.\$\{|action: `mcp\.|mcp\.\$\{tool\}/],
    ['stateless transport', /StreamableHTTPServerTransport/],
  ]) {
    if (!re.test(src)) bad.push(`${MCP_SERVER}: ${feature} 소실`);
  }
  // 행동 계층 require 금지 (쓰기 우회 차단)
  if (/require\(['"]\.\.\/services\/actions\//.test(src)) {
    bad.push(`${MCP_SERVER}: 행동 계층 require — MCP 는 읽기 전용, 쓰기 표면 금지`);
  }
  // 도메인 모델 쓰기 금지 — ApiToken.last_used_at 메타 업데이트만 예외로 허용
  const writes = src.match(/\.(create|destroy|bulkCreate)\(/g) || [];
  if (writes.length > 0) bad.push(`${MCP_SERVER}: 모델 쓰기(${writes.join(',')}) — MCP 읽기 전용 위반`);
  // 모델 인스턴스 업데이트는 `.update({...})` 형태(객체 인자). crypto `.update(s)` 는 제외.
  //   token.update({last_used_at}) 메타 1건만 허용.
  const modelUpdates = (src.match(/\.update\(\s*\{/g) || []).length;
  if (modelUpdates > 1) bad.push(`${MCP_SERVER}: 모델 update ${modelUpdates}건 — last_used_at 메타 외 쓰기 금지`);
  // 재무 모델 참조 금지
  if (/\b(Invoice|Payment|InvoiceInstallment)\b/.test(src)) {
    bad.push(`${MCP_SERVER}: 재무 모델 참조 — 외부 표면 재무 봉쇄 위반`);
  }
  // 툴 이름에 쓰기 동사 금지 (이름에 숫자 포함 가능 — get_client_360)
  const toolNames = [...src.matchAll(/registerTool\(\s*['"]([a-z0-9_]+)['"]/g)].map((m) => m[1]);
  const writeVerb = toolNames.filter((n) => /create|update|delete|submit|complete|comment|write|send|mark/.test(n));
  if (writeVerb.length) bad.push(`${MCP_SERVER}: 쓰기 동사 툴(${writeVerb.join(',')}) — MCP 읽기 전용 위반`);
  report('mcpreadonly', `MCP 외부 표면 read-only (툴 ${toolNames.length})`, bad.length === 0, bad);
}

// ═══════════════════════════════════════════════
// routedrift — shell(App.tsx) ↔ pane(appRoutes.tsx) 라우트 일치
//   ★ 이 대조 스크립트(scripts/guard-app-routes.js)는 예전부터 있었는데 **어느 게이트에도
//     붙어 있지 않아 아무도 실행하지 않았다.** 그 사이 /attendance 가 pane 표에서 빠져
//     탭 모드에서 메뉴를 눌러도 빈 화면이 나왔다(운영 2026-08-22, 원인 추적에 반나절).
//     안 부르는 가드는 없는 가드다 — 여기에 묶는다.
function checkRouteDrift() {
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, [`${ROOT}/scripts/guard-app-routes.js`], { stdio: 'pipe' });
    report('routedrift', 'shell(App.tsx) ↔ pane(appRoutes.tsx) 라우트 일치', true, []);
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n').filter(Boolean);
    report('routedrift', 'shell(App.tsx) ↔ pane(appRoutes.tsx) 라우트 일치', false, out.slice(0, 10));
  }
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
// 10. panelhandle — 패널 핸들 시각 단일 정의 + 숨김 경계 봉합
//   패널 접기 핸들이 두 컴포넌트로 갈라져 시각이 따로 놀았다(하나는 그라데이션+그림자 2겹,
//   하나는 단색). 게다가 숨김 경계가 어긋나(1024 vs 1200) 1025~1200px 에서 핸들 두 개가
//   동시에 떠 "붙을 패널이 없는 화살표"가 혼자 떠 있었다.
//   → 시각은 panelHandleStyle 한 곳에만. 경계는 right=1200 / left=1024 로 맞물린다.
// ═══════════════════════════════════════════════
function checkPanelHandle() {
  const STYLE = 'dev-frontend/src/components/Layout/panelHandleStyle.ts';
  const FLOAT = 'dev-frontend/src/components/Common/FloatingPanelToggle.tsx';
  const fails = [];

  for (const f of [STYLE, FLOAT]) {
    if (!fs.existsSync(path.join(ROOT, f))) { fails.push(`${f}: 없음 — 핸들 단일 정의가 사라졌다`); }
  }
  if (fails.length) { report('panelhandle', '패널 핸들 단일 정의', false, fails); return; }

  // ① 시각 계약 — 단색. 그라데이션·그림자 금지 (Irene 확정)
  for (const f of [STYLE, FLOAT]) {
    const src = read(path.join(ROOT, f));
    if (/linear-gradient|radial-gradient/.test(src)) fails.push(`${f}: 그라데이션 재유입 — 핸들은 단색만`);
    // box-shadow: none 은 허용, 그 외 값은 금지
    const shadows = src.match(/box-shadow:\s*([^;]+);/g) || [];
    shadows.filter((s) => !/none/.test(s)).forEach((s) => fails.push(`${f}: 그림자 재유입 — ${s.trim()}`));
  }

  // ② 시각은 panelHandleStyle 단일 정의를 공유 — 자체 선언하면 드리프트
  const float = read(path.join(ROOT, FLOAT));
  if (!float.includes('panelHandleStyle')) {
    fails.push(`${FLOAT}: panelHandleStyle 미사용 — 시각을 자체 선언하면 다시 갈라진다`);
  }

  // ③ 단일 표준 — FloatingPanelToggle 이 좌·우 대칭을 모두 지원(뷰포트 변 플로팅).
  //    Irene 확정: 데스크탑 경계선 세로바는 폐기하고 전 폭·좌우 이 하나로 통일.
  if (!/\$side === 'right'/.test(float) || !/'left'/.test(float)) {
    fails.push(`${FLOAT}: 좌/우 side 지원이 사라졌다 — 좌우 대칭 단일 핸들이어야 한다`);
  }

  // ④ 폐기된 경계선 핸들(PanelEdgeHandle) 재유입 차단 — 화면마다 제각각이던 원흉.
  //    좌우 통일 플로팅 핸들만 쓴다. import·JSX 어느 쪽도 금지.
  const usages = [];
  for (const dir of ['dev-frontend/src/pages', 'dev-frontend/src/components']) {
    for (const file of walk(path.join(ROOT, dir), ['.tsx', '.ts'])) {
      if (/<PanelEdgeHandle|PanelEdgeHandle['"]/.test(read(file))) usages.push(rel(file));
    }
  }
  if (usages.length) {
    fails.push(`PanelEdgeHandle 재유입(${usages.length}) — 좌우 통일 플로팅 핸들만 사용: ${usages.slice(0, 4).join(', ')}`);
  }

  report('panelhandle', '패널 핸들 — 단색 단일 정의 + 좌우 대칭 플로팅(경계선 세로바 폐기)', fails.length === 0, fails);
}

// ═══════════════════════════════════════════════
// 11. docfresh — 핵심 문서 신선도 (경고만 — 게이트 실패 아님)
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

// ═══════════════════════════════════════════════
// spalink — 존재하지 않는 SPA 라우트로 보내는 링크 0건 (하드 게이트)
//
// 운영 #246 계열: `/qtalk` `/qmail` `/qtask` `/qnote` `/qbill` `/documents/:id` 처럼
// **라우트 대장에 없는 경로**로 navigate/link 하면 catch-all(`path="*"`) 이 잡아
// 대시보드로 조용히 튕긴다. 버튼은 눌리는데 아무 일도 안 일어나므로 tsc·기존 가드가
// 전부 통과하고 사용자만 "안 열려" 라고 신고한다. 메뉴 이름(Q talk)과 라우트(/talk)가
// 다른 것이 이 실수의 근원 — 사람이 계속 재발시킨다. 기계가 잡아야 한다.
// (memory feedback_notify_link_must_match_route)
// ═══════════════════════════════════════════════
// ── 라우트 대장 → 매칭기 ──────────────────────────
// 첫 세그먼트만 비교하면 `/memo`(라우트는 `/memo/:id` 뿐) 나 `/documents/3`(라우트 없음, 다만
//   `documents` 로 시작하는 다른 라우트 존재) 같은 **2단계 이하 오류를 통째로 놓친다.**
//   실제로 그렇게 새어나간 링크가 있었다. 전체 경로를 패턴에 맞춰 본다.
function collectRoutePatterns() {
  const routeFiles = [
    `${ROOT}/dev-frontend/src/App.tsx`,
    `${ROOT}/dev-frontend/src/routes/appRoutes.tsx`,
  ].filter((f) => fs.existsSync(f));
  const pats = [];
  for (const f of routeFiles) {
    // App.tsx 는 JSX `path="/x"`, routes/appRoutes.tsx 는 객체 `path: '/x'` 문법이다.
    //   후자를 안 읽으면 대장이 반쪽이 되고, 트리를 스왑하는 순간 멀쩡한 링크가 무더기로 잡힌다.
    const src = read(f);
    for (const m of src.matchAll(/path="([^"]*)"/g)) pats.push(m[1]);
    for (const m of src.matchAll(/path:\s*['"`]([^'"`]*)['"`]/g)) pats.push(m[1]);
  }
  return pats.filter((p) => p.startsWith('/') || p === '*');
}

/** react-router 패턴 1개와 실제 경로가 맞는지. `:param` 은 1세그먼트, `*` 는 나머지 전부. */
function routeMatches(pattern, path) {
  if (pattern === '*') return false;   // catch-all 은 "라우트 있음" 이 아니다 — 그게 이 가드의 대상이다
  const ps = pattern.split('/').filter(Boolean);
  const xs = path.split('/').filter(Boolean);
  for (let i = 0; i < ps.length; i += 1) {
    if (ps[i] === '*') return true;
    if (i >= xs.length) return false;
    if (ps[i].startsWith(':')) continue;          // 파라미터 — 아무 세그먼트나
    if (xs[i] === '\u0001') continue;       // 링크쪽 ${...} 보간 — 값을 알 수 없으니 통과
    if (ps[i] !== xs[i]) return false;
  }
  return ps.length === xs.length;
}

function checkSpaLink() {
  const patterns = collectRoutePatterns();
  if (patterns.length === 0) {
    report('spalink', 'SPA 라우트 링크 정합 (하드 게이트)', false, ['라우트 대장을 읽지 못했다 — App.tsx 확인']);
    return;
  }
  const known = (p) => patterns.some((pat) => routeMatches(pat, p));

  // SPA 라우터가 다루지 않는 경로 — API·정적·외부 프로세스·번역 리소스 등.
  //   ★ `qnote` 는 여기 있으면 안 된다: `/qnote` 는 실제 죽은 라우트이고 Q Note 페이지는 `/notes` 다.
  //     프론트 fetch 가 쓰는 것은 `/qnote/api/...` 라 아래 2세그먼트 규칙으로 걸러진다.
  const SKIP_PREFIX = [
    '/api/', '/uploads/', '/assets/', '/static/', '/public/', '/locales/',
    '/qnote/api', '/mcp/', '/socket.io', '/.well-known/', '/favicon', '/icons/', '/images/',
    // 네이티브 앱 딥링크 — react-router 가 아니라 NativeBridge 가 pathname 으로 가로챈다
    '/oauth/native-return', '/sounds/',
  ];
  const skip = (p) => p === '/' || SKIP_PREFIX.some((s) => p === s.replace(/\/$/, '') || p.startsWith(s));

  const hits = [];
  // 문자열 리터럴에서 경로 후보를 뽑는다. **호출 문법을 열거하지 않는다** —
  //   navigate()/Link 만 세던 옛 방식은 `navTo('/qbill')` 같은 래퍼나
  //   `invoice: (id) => \`/bill?invoice=${id}\`` 같은 매핑 테이블을 통째로 놓쳤다(실사고 2건).
  const candidates = (line) => {
    const out = [];
    for (const m of line.matchAll(/['"`](\/[^'"`\s]*)['"`]/g)) {
      // 쿼리·해시 제거 후 경로만. `${...}` 보간 세그먼트는 NUL 로 치환해 와일드카드 취급.
      let p = m[1].split('?')[0].split('#')[0].replace(/\$\{[^}]*\}/g, '\u0001');
      if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
      if (p.length <= 1) continue;
      // SPA 경로의 모양이 아닌 것은 애초에 후보가 아니다.
      //   - 확장자가 붙으면 정적 자산(`/logo.svg` `/sw.js` `/sounds/x.mp3`)이지 라우트가 아니다
      //   - 경로 문자 외의 것이 섞였으면 JSX 조각(`/></svg>{t(`) 같은 정규식 아티팩트다
      if (/\.[a-zA-Z0-9]{2,5}$/.test(p)) continue;
      if (!/^\/[a-zA-Z0-9_\-/\u0001]*$/.test(p)) continue;
      out.push({ raw: m[1], path: p, idx: m.index });
    }
    return out;
  };
  const isComment = (t) => t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*');

  // 경로 리터럴이라고 다 네비게이션이 아니다. **판정 방향은 "기본 검출, 명시적 제외"** 로 둔다 —
  //   네비게이션 문법을 열거하는 반대 방향은 `navTo()` 같은 새 래퍼가 생기는 순간 침묵한다.
  //   여기 제외되는 것은 "경로를 목적지가 아니라 값으로 쓰는" 용법뿐이다:
  //     · API 호출 인자          apiFetch('/api/x') · callAction('/hold') · fetch(...)
  //     · 경로 비교/파싱          pathname.includes('/storage') · startsWith('/memo/') · === '/login'
  //     · 접두 목록 상수          const NON_TAB_PREFIX = ['/login', ...]
  const CALL_CTX = /(?<![a-zA-Z0-9_$])(?:apiFetch|callAction|runAction|fetch|axios|get|post|put|patch|del|delete|request)\s*\([^)]*$/;
  const CMP_CTX = /(?<!location\.)(?<![a-zA-Z0-9_$])(?:includes|startsWith|endsWith|indexOf|lastIndexOf|match|test|split|replace|replaceAll|search)\s*\(\s*$|[=!]==?\s*$/;
  const PREFIX_LIST_DECL = /(?:PREFIX|PATH|ROUTE|URL)[A-Z_]*\s*=\s*\[/;
  const isValueUse = (line, idx) => {
    const before = line.slice(0, idx);
    return CALL_CTX.test(before) || CMP_CTX.test(before) || PREFIX_LIST_DECL.test(line);
  };

  // 프론트 — src 전체. 앱 안에서 쓰이는 모든 경로 리터럴이 대상.
  for (const f of walk(`${ROOT}/dev-frontend/src`, ['.ts', '.tsx'])) {
    read(f).split('\n').forEach((l, i) => {
      const t = l.trim();
      if (isComment(t)) return;
      // 줄 끝 주석 안의 경로는 코드가 아니다 (`code; // navigate('/x')` 오탐 차단).
      const code = l.replace(/\/\/.*$/, '');
      for (const c of candidates(code)) {
        if (skip(c.path) || known(c.path) || isValueUse(code, c.idx)) continue;
        hits.push(`${rel(f)}:${i + 1}: ${c.raw} → 라우트 없음`);
      }
    });
  }

  // 백엔드 — 알림·통계가 사용자 브라우저로 내보내는 deep link.
  //   express 라우트 정의(`router.get('/x')`)와 파일 경로는 SPA 경로가 아니므로 제외한다.
  const BACKEND_NOISE = /(?:router|app)\s*\.\s*(?:get|post|put|patch|delete|use|all)\s*\(|require\s*\(|path\.(?:join|resolve)|__dirname|createReadStream|writeFileSync|readFileSync|process\.env/;
  for (const f of [...walk(`${ROOT}/dev-backend/routes`, ['.js']), ...walk(`${ROOT}/dev-backend/services`, ['.js'])]) {
    read(f).split('\n').forEach((l, i) => {
      const t = l.trim();
      if (isComment(t)) return;
      const code = l.replace(/\/\/.*$/, '');
      if (BACKEND_NOISE.test(code) || /\/api\/|api\.push\.apple|googleapis|https?:\/\/|':path'|':method'/.test(code)) return;
      for (const c of candidates(code)) {
        if (skip(c.path) || known(c.path) || isValueUse(code, c.idx)) continue;
        hits.push(`${rel(f)}:${i + 1}: ${c.raw} → 라우트 없음`);
      }
    });
  }

  report('spalink', 'SPA 라우트 링크 정합 — 죽은 링크 0건 (하드 게이트)', hits.length === 0, hits);
}

// ── 메인 ─────────────────────────────────────────

// ═══════════════════════════════════════════════
// N. schemacol — 코드가 참조하는 컬럼이 DB 에 실재하는가 (하드 게이트)
//
//   왜 있는가 (2026-08-17 — 한 사이클에 같은 계열 2건)
//     · `server.js` 의 `where: { status: 'active' }` — `businesses.status` 는 **없다**.
//       매번 throw 했고 호출부 catch 가 삼켜, 월간 보고서가 **한 번도 생성되지 않았는데
//       아무도 몰랐다**(운영 reports 0행).
//     · 새 멱등 키 `Notification.tag` — 그 컬럼도 없었다. 실호출에서야 드러났다.
//   둘 다 로그에도 화면에도 안 남는다. **정적 검사로만 잡힌다.**
//
//   ★ 정본은 모델 파일이 아니라 **DB 스키마 스냅샷**(`scripts/schema-snapshot.json`)이다.
//     Sequelize 는 연관관계로 `project_id`·`business_id` 같은 FK 를 자동 생성하는데
//     그건 모델 파일 어디에도 안 적혀 있다 — 모델만 보면 멀쩡한 코드가 대량 오탐된다(실측).
//     스키마를 바꿨으면 `node scripts/dump-schema.js` 로 스냅샷을 갱신할 것.
//
//   보수적으로 본다 — 거짓 FAIL 이 가드를 죽이는 것이 더 나쁘다:
//     · `include` 안의 where 는 **다른 모델의 것**이라 건너뛴다(옵션 객체 depth 1 의 where 만)
//     · Op 심볼·문자열 키·`$중첩$`·주석은 건너뛴다
//     · 스냅샷에 테이블이 없거나 모델의 tableName 을 못 읽으면 검사 대상에서 제외
//
//   ★ 사각지대 (Fable 실측 — **이 가드를 과신하지 말 것**):
//     · `[Op.or]: [{ badcol: 1 }]` 중첩 내부 키 · shorthand `where: { badcol }`(콜론 없음)
//     · `update({ badcol: 1 }, ...)` 의 **SET 값 객체**(where 만 본다)
//     · `where: 변수/함수()` (원리상 정적 불가 — 실측 검사대상의 2%)
//     · 별칭 모델(`ClientM` 등 tableName 매핑 실패 ~16호출) · `Model.scope(...)` ·
//       `create`/`findOrCreate` 값 객체 · raw `sequelize.query`
//     실측 커버리지: 모델 호출 ~1442 중 1426 매핑(99%), 리터럴 where 1310건(92%) 검사.
//     ★ 스냅샷 미갱신 시 방향: 컬럼 추가 = 거짓 FAIL(시끄러움·안전) /
//       **테이블 누락·컬럼 drop = 미탐(조용함·위험)** → 스키마 변경 후 dump-schema 재실행 필수.
// ═══════════════════════════════════════════════
function modelTableMap() {
  const map = {};
  for (const f of walk(`${ROOT}/dev-backend/models`, ['.js'])) {
    const src = read(f);
    const mi = src.match(/(\w+)\.init\(/);
    const tn = src.match(/tableName:\s*'([^']+)'/);
    if (mi && tn) map[mi[1]] = tn[1];
  }
  return map;
}

/** 옵션 객체 문자열에서 **depth 1** 의 `where: { ... }` 본문만 뽑는다 (include 안의 것 제외). */
function topLevelWhereBody(optionsSrc) {
  const open = optionsSrc.indexOf('{');
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < optionsSrc.length; i++) {
    const ch = optionsSrc[i];
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (depth === 1 && optionsSrc.startsWith('where:', i)) {
      // ★ `where: scopeWhere` / `where: myWeekWhere(...)` 처럼 **객체 리터럴이 아니면** 검사하지 않는다.
      //   여기서 다음 `{` 를 무작정 잡으면 뒤따르는 include·attributes 블록을 where 로 오인해
      //   `where.model`·`where.include` 같은 거짓 FAIL 이 난다(실측).
      let k = i + 'where:'.length;
      while (k < optionsSrc.length && /\s/.test(optionsSrc[k])) k++;
      if (optionsSrc[k] !== '{') return null;
      const ws = k;
      let d = 0;
      for (let j = ws; j < optionsSrc.length; j++) {
        if (optionsSrc[j] === '{') d++;
        else if (optionsSrc[j] === '}') { d--; if (d === 0) return optionsSrc.slice(ws + 1, j); }
      }
      return null;
    }
  }
  return null;
}

function checkSchemaCol() {
  const snapPath = `${ROOT}/scripts/schema-snapshot.json`;
  if (!fs.existsSync(snapPath)) {
    report('schemacol', '모델에 없는 컬럼 참조 (스냅샷 없음 — node scripts/dump-schema.js)', true, [], true);
    return;
  }
  const snap = JSON.parse(read(snapPath));
  const tables = snap.tables || {};
  const m2t = modelTableMap();
  const METHODS = 'findOne|findAll|findAndCountAll|count|update|destroy|sum|max|min';
  const current = {};
  const samples = [];
  const targets = [
    ...walk(`${ROOT}/dev-backend/routes`, ['.js']),
    ...walk(`${ROOT}/dev-backend/services`, ['.js']),
    ...walk(`${ROOT}/dev-backend/middleware`, ['.js']),
    `${ROOT}/dev-backend/server.js`,
  ].filter((f) => fs.existsSync(f));

  for (const f of targets) {
    const src = read(f);
    const re = new RegExp(`\\b([A-Z]\\w+)\\.(${METHODS})\\s*\\(`, 'g');
    let m; let n = 0;
    while ((m = re.exec(src)) !== null) {
      const table = m2t[m[1]];
      const cols = table && tables[table];
      if (!cols) continue;                       // 매핑·스냅샷 없으면 검사 안 함
      const open = src.indexOf('(', m.index + m[0].length - 1);
      let depth = 0, close = -1;
      for (let i = open; i < Math.min(src.length, open + 6000); i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
      }
      if (close === -1) continue;
      const body = topLevelWhereBody(src.slice(open, close));
      if (!body) continue;
      const known = new Set(cols);
      // ★ 줄 단위가 아니라 **최상위 쉼표 단위**로 키를 뽑는다.
      //   `where: { token, nonexistent_col: 1 }` 처럼 한 줄에 여러 키가 있으면
      //   줄 파싱은 첫 키만 보고 나머지를 놓친다(실측 — 반증에서 안 잡혔다).
      const segments = [];
      let d2 = 0, cur = '';
      for (const ch of body) {
        if (ch === '{' || ch === '[' || ch === '(') d2++;
        else if (ch === '}' || ch === ']' || ch === ')') d2--;
        if (ch === ',' && d2 === 0) { segments.push(cur); cur = ''; } else cur += ch;
      }
      segments.push(cur);
      for (const seg of segments) {
        // 주석 줄 제거 후 첫 토큰만 본다
        const t = seg.split('\n').map((l) => l.trim())
          .filter((l) => l && !l.startsWith('//') && !l.startsWith('*')).join(' ').trim();
        if (!t || t.startsWith('...')) continue;
        const km = t.match(/^([a-z_][a-zA-Z0-9_]*)\s*:/);
        if (!km) continue;
        // Sequelize `underscored: true` — 코드의 camelCase 는 DB 의 snake_case 로 매핑된다
        //   (`createdAt` → `created_at`). 둘 다 실재로 인정한다.
        const snake = km[1].replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
        if (!known.has(km[1]) && !known.has(snake)) {
          n++;
          if (samples.length < 12) {
            const ln = src.slice(0, m.index).split('\n').length;
            samples.push(`${rel(f)}:${ln}: ${m[1]}.${m[2]}() where.${km[1]} — ${table} 에 없는 컬럼`);
          }
        }
      }
    }
    if (n > 0) current[rel(f)] = n;
  }
  const r = ratchet('schemacol', current);
  const detail = r.fails.length ? [...r.fails, ...samples] : (opts.verbose ? samples : []);
  report('schemacol', `DB 에 없는 컬럼 참조 래칫 (현재 ${r.curTotal} / 베이스 ${r.baseTotal})`, r.fails.length === 0, detail);
}

const CATEGORIES = {
  mock: checkMock,
  i18n: checkI18n,
  parity: checkParity,
  tenant: checkTenant,
  pagination: checkPagination,
  notify: checkNotify,
  broadcast: checkBroadcast,
  broadcastactor: checkBroadcastActor,
  finance: checkFinance,
  cuefinance: checkCueFinance,
  cueauth: checkCueAuth,
  costguard: checkCostGuard,
  llmgateway: checkLlmGateway,
  actionlayer: checkActionLayer,
  createlayer: checkCreateLayer,
  cuetools: checkCueTools,
  mcpreadonly: checkMcpReadonly,
  godfile: checkGodfile,
  spalink: checkSpaLink,
  panelhandle: checkPanelHandle,
  docfresh: checkDocFresh,
  schemacol: checkSchemaCol,
  routedrift: checkRouteDrift,
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
