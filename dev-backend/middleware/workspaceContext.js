// 요청의 워크스페이스 — docs/WORKSPACE_SCOPE_DESIGN.md C2·C3·C5 (단계 3~5, 2026-09-11)
//
// Irene: "모든 페이지가 하나의 워크스페이스로만 연결되어야지." · "절대 데이터 새면 안돼."
//
// 창은 자기가 믿는 워크스페이스를 `X-Workspace-Id` 로 싣는다(apiFetch · apiUpload). 서버의 정본은
// users.active_business_id 하나다. 여태 범위 인자가 없는 라우트는 **정본을 그대로 기본값으로** 썼다 —
// 다른 창·기기가 방금 전환했으면, 옛 워크스페이스를 그리고 있는 창에 **새 워크스페이스 데이터**가 담겼다.
//
//   observe(req, canonical)   authenticateToken 이 req.user 를 만든 직후 부른다. 헤더를 정본과 대조해
//                             req.workspaceHeader / workspaceId / workspaceStale / workspaceCanonical 을 싣고 관찰 카운터를 올린다.
//   requestScope(req, explicit, { legacy })   범위 인자가 없는 라우트가 **추측 대신** 부른다.
//        ① 명시값(params/query/body)            → 그것 (권한 검증은 라우트 몫 — 종전과 같다)
//        ② 헤더 == 정본                          → 헤더
//        ③ 헤더 ≠ 정본                           → stale → 409 workspace_stale (창은 WorkspaceSyncGuard 로 따라간다)
//        ④ 헤더 없음(옛 번들)                    → 옛 동작 그대로. legacy:'active' = 정본 · 'aggregate' = null(합산 라우트)
//           ★ ④ 는 X-Workspace-Id 를 안 싣는 **옛 번들 전용 호환**이다. 요약 로그 `[wsctx]` 의 legacy 가 0 이 되면
//             이 분기를 지운다(설계 C5 "옛 번들 소진 뒤"). 지울 때는 이 파일 한 곳만 고치면 된다.
//   staleResponse(res, scope) 409 응답의 한 모양.
//
// ★ 엔티티 id 로 주소되는 요청(`/api/tasks/:id` 등)은 requestScope 를 부르지 않는다 — 권한은 엔티티의
//   business_id 로 이미 판정하고, 보류 중인 창의 편집·자동저장이 계속 저장돼야 한다(C3).
// ★ 명시값 ≠ 헤더(Q3 workspace_mismatch)는 **관찰만** 한다 — 목록·집계 라우트 분류가 끝나기 전에 409 로 막으면
//   의도적으로 다른 워크스페이스를 부르는 화면(엔티티 워크스페이스로 부르는 첨부 등)이 깨진다.

const SUMMARY_MS = 60 * 60 * 1000;   // 요약 한 줄 주기
const ONCE_MS = 10 * 60 * 1000;      // 같은 (사용자·경로) 개별 로그 최소 간격

const fresh = () => ({ authed: 0, header: 0, no_header: 0, stale: 0, mismatch: 0, legacy: 0, stale_409: 0 });
let counters = fresh();
let since = Date.now();
const lastLogged = new Map();

function bump(key) {
  counters[key] += 1;
  if (Date.now() - since >= SUMMARY_MS) {
    console.log(`[wsctx] summary ${Math.round((Date.now() - since) / 60000)}m ${JSON.stringify(counters)}`);
    counters = fresh();
    since = Date.now();
  }
}

function logOnce(key, line) {
  const now = Date.now();
  const last = lastLogged.get(key);
  if (last && now - last < ONCE_MS) return;
  if (lastLogged.size > 5000) lastLogged.clear();
  lastLogged.set(key, now);
  console.warn(line);
}

const pathOf = (req) => String(req.originalUrl || req.url || '').split('?')[0];
const positiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** authenticateToken · optionalAuth 가 req.user 직후 부른다. 절대 throw 하지 않는다(판정 실패로 트래픽을 막지 않는다). */
function observe(req, canonical) {
  const header = positiveInt(req.headers['x-workspace-id']);
  const canon = positiveInt(canonical);
  req.workspaceHeader = header;
  req.workspaceCanonical = canon;
  req.workspaceStale = !!(header && canon && header !== canon);
  req.workspaceId = header && header === canon ? header : null;

  const path = pathOf(req);
  // /api/auth/* 는 전환·me·refresh 자체라 헤더가 옛값인 것이 정상이다 — 세지 않는다
  if (path.startsWith('/api/auth/')) return;
  bump('authed');
  if (!header) { bump('no_header'); return; }
  bump('header');
  const uid = req.user && req.user.id;
  if (req.workspaceStale) {
    bump('stale');
    logOnce(`s:${uid}:${path}`, `[wsctx] stale user=${uid} header=${header} canonical=${canon} ${req.method} ${path}`);
  }
  try {
    const { extractBusinessId } = require('./workspaceAlive');
    const explicit = extractBusinessId(req);
    if (explicit && explicit !== header) {
      bump('mismatch');
      logOnce(`m:${uid}:${path}`, `[wsctx] mismatch user=${uid} header=${header} explicit=${explicit} ${req.method} ${path}`);
    }
  } catch { /* 관찰 실패는 무시 */ }
}

/**
 * 범위 인자가 없을 때 무엇으로 채울지 — 추측하지 않는다.
 * @param {object} req
 * @param {*} explicit  요청이 명시한 business_id (query/body/params 중 라우트가 고른 것)
 * @param {{ legacy?: 'active'|'aggregate' }} [opts]  헤더 없는 옛 번들의 종전 동작
 * @returns {{ businessId: number|null, source: string, stale?: boolean, canonical?: number|null }}
 */
function requestScope(req, explicit, opts = {}) {
  const e = positiveInt(explicit);
  if (e) return { businessId: e, source: 'explicit' };
  if (req.workspaceId) return { businessId: req.workspaceId, source: 'header' };
  if (req.workspaceStale) {
    bump('stale_409');
    return { businessId: null, source: 'stale', stale: true, canonical: req.workspaceCanonical || null };
  }
  // 헤더는 왔는데 정본이 없다(소속이 모두 끊겼다) — 채울 범위가 없다. 라우트의 400/403 이 말한다.
  if (req.workspaceHeader) return { businessId: null, source: 'no_canonical' };

  bump('legacy');
  logOnce(`l:${req.user && req.user.id}:${pathOf(req)}`,
    `[wsctx] legacy(no X-Workspace-Id) user=${req.user && req.user.id} ${req.method} ${pathOf(req)}`);
  // 옛 번들 호환 — 위 머리말 ④. legacy 가 0 이 되면 이 두 줄을 지운다.
  if (opts.legacy === 'aggregate') return { businessId: null, source: 'legacy' };
  return { businessId: req.workspaceCanonical || null, source: 'legacy' };
}

function staleResponse(res, scope) {
  return res.status(409).json({
    success: false,
    message: 'Workspace changed in another window or device',
    code: 'workspace_stale',
    business_id: (scope && scope.canonical) || null,
  });
}

/** 검증·진단용 — 현재 창(프로세스)의 관찰 카운터 */
function snapshot() {
  return { since: new Date(since).toISOString(), ...counters };
}

module.exports = { observe, requestScope, staleResponse, snapshot };
