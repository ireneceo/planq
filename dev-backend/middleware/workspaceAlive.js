// 삭제된 워크스페이스 차단 — **모든 API 요청이 지나는 단일 관문**.
//
// 왜 미들웨어인가 (Fable 치명-4)
//   워크스페이스 접근 판정이 세 갈래로 갈라져 있다:
//     ① `attachWorkspaceScope`(checkBusinessAccess) — 게이트 있음
//     ② `getUserScope`/`assertMember*` 헬퍼 — 게이트 넣음
//     ③ **라우트 안 인라인 `BusinessMember.findOne`** — 40여 파일에 흩어져 있다
//   ③ 때문에 삭제된 워크스페이스를 계속 읽고 쓸 수 있었다
//   (실측: weekly-reviews·records·search GET 200, work-hours PATCH **쓰기 성공**).
//   라우트를 하나씩 고치면 새 라우트가 생길 때마다 같은 구멍이 다시 난다.
//   그래서 판정을 라우트 밖으로 빼서 **여기 한 곳**에서 막는다.
//
// 규칙
//   · 요청에 business_id 가 실려 있고(params/query/body) 그 워크스페이스가 soft-delete 됐으면 404.
//   · platform_admin 은 통과 — 복구·감사 목적 (access_scope 의 기존 설계와 동일).
//   · business_id 가 없는 요청은 그냥 통과 (여기서 판정할 대상이 아니다).
//
// 성능: 삭제된 워크스페이스 id 집합만 30초 캐시한다. 삭제는 극히 드물고 집합이 작아
//   요청당 쿼리가 0 이다. 캐시가 만료돼도 최대 30초 뒤에는 차단된다 — 그 창은
//   ①②의 게이트가 이미 덮고 있어 심층방어로 충분하다.

let cache = { ids: new Set(), expires: 0 };
const TTL_MS = 30_000;

async function deletedBusinessIds() {
  if (Date.now() < cache.expires) return cache.ids;
  try {
    const { Business } = require('../models');
    const { Op } = require('sequelize');
    const rows = await Business.findAll({
      attributes: ['id'],
      where: { deleted_at: { [Op.ne]: null } },
      raw: true,
    });
    cache = { ids: new Set(rows.map((b) => b.id)), expires: Date.now() + TTL_MS };
  } catch (e) {
    // 조회 실패 시 기존 캐시 유지 — 여기서 fail-closed 하면 DB 순단에 전 API 가 404 가 된다.
    console.warn('[workspaceAlive] 조회 실패, 이전 캐시 유지:', e.message);
  }
  return cache.ids;
}

/** 워크스페이스 삭제/복구 직후 즉시 반영 (admin 토글·백필에서 호출). */
function invalidate() {
  cache = { ids: new Set(), expires: 0 };
}

/**
 * 요청에서 business_id 를 찾는다 — 프로젝트 전반의 관례를 모두 본다.
 *
 * ★ `req.params.id` 는 **`/api/businesses` 마운트일 때만** 워크스페이스 id 다.
 *   다른 라우터에서 `:id` 는 task·file·post 등 전혀 다른 것을 가리키므로,
 *   무조건 워크스페이스로 보면 엉뚱한 요청을 404 로 막는다.
 *   (실측: `PATCH /api/businesses/:id/members/:memberId/work-hours` 가 `:businessId` 가 아니라
 *    `:id` 를 써서 이 가드를 통과해 삭제된 워크스페이스에 **쓰기가 성공**했다.)
 */
function extractBusinessId(req) {
  let raw = req.params?.businessId ?? req.params?.business_id
    ?? req.query?.business_id ?? req.body?.business_id;
  if (raw === undefined || raw === null || raw === '') {
    const base = String(req.baseUrl || '');
    if (base === '/api/businesses' || base.endsWith('/api/businesses')) {
      raw = req.params?.id;
    }
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 이 요청이 삭제된 워크스페이스를 향하는가. `authenticateToken` 이 req.user 세팅 직후 호출한다.
 * @returns {Promise<boolean>} true 면 차단해야 한다.
 */
async function workspaceAliveCheck(req) {
  if (req.user?.platform_role === 'platform_admin') return false;
  const businessId = extractBusinessId(req);
  if (!businessId) return false;
  const dead = await deletedBusinessIds();
  return dead.has(businessId);
}

module.exports = { workspaceAliveCheck, invalidate, extractBusinessId };
