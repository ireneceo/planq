// 워크스페이스 일정 분류 (2026-11-27) — 설계 docs/CALENDAR_CATEGORIES_DESIGN.md §6
//
// 마운트: `/api/businesses` 접두어(business_leave_types.js 와 공유). 이 파일에는 `/:businessId/calendar-categories…` 꼬리 경로만 둔다.
// 권한: 읽기 = 워크스페이스 멤버(고객 403) · 추가 = 멤버 누구나 · 이름·색·켜고 끄기·순서·삭제 = owner/admin(+platform_admin).
// 규칙(이름 중복·한도·시스템 분류·other 잠금·삭제 시 «기타»로 옮김)·감사·방송은 전부 services/calendarCategories 안에 있다. 여기는 권한과 입출력만.
const express = require('express');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const CC = require('../services/calendarCategories');

const router = express.Router();

const actorOf = (req) => ({ platformRole: req.user?.platform_role, businessRole: req.businessRole });
function blockClient(req, res) {
  if (req.businessRole === 'client') { errorResponse(res, 'forbidden', 403); return true; }
  return false;
}
function requireManage(req, res) {
  if (!CC.canManage(actorOf(req))) { errorResponse(res, 'Admin permission required', 403); return false; }
  return true;
}
function fail(res, err, next) {
  if (err instanceof CC.CalendarCategoryError) return errorResponse(res, err.code, err.status || 400);
  return next(err);
}

async function listPayload(req, businessId) {
  const manage = CC.canManage(actorOf(req));
  const includeInactive = manage && (req.query.include_inactive === '1' || req.query.include_inactive === 'true');
  const withUsage = manage && (req.query.with_usage === '1' || req.query.with_usage === 'true');
  const rows = await CC.list(businessId, { includeInactive });
  const usage = withUsage ? await CC.usageCounts(businessId) : null;
  return {
    categories: rows.map((r) => CC.serialize(r, usage ? (usage.get(r.id) || 0) : undefined)),
    can_manage: manage,
    custom_limit: CC.CUSTOM_LIMIT,
  };
}

// GET /api/businesses/:businessId/calendar-categories?include_inactive=1&with_usage=1 (끝 둘은 관리자만)
router.get('/:businessId/calendar-categories', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    return successResponse(res, await listPayload(req, Number(req.params.businessId)));
  } catch (err) { return fail(res, err, next); }
});

// audit-exempt: 감사(calendar_category.*)는 services/calendarCategories 안에서 쓴다 — 규칙과 같은 자리
router.post('/:businessId/calendar-categories', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    const b = req.body || {};
    const row = await CC.createCategory(Number(req.params.businessId), req.user.id, { name: b.name, color: b.color });
    return successResponse(res, CC.serialize(row), null, 201);
  } catch (err) { return fail(res, err, next); }
});

// ★ '/order' 는 '/:id' 보다 먼저 — 순서가 바뀌면 'order' 가 id 로 읽혀 404 가 된다
// audit-exempt: 감사(calendar_category.reorder)는 services/calendarCategories 안에서 쓴다
router.put('/:businessId/calendar-categories/order', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    if (!requireManage(req, res)) return;
    const rows = await CC.reorder(Number(req.params.businessId), req.user.id, (req.body || {}).ids);
    return successResponse(res, { categories: rows.map((r) => CC.serialize(r)) });
  } catch (err) { return fail(res, err, next); }
});

// audit-exempt: 감사(calendar_category.update)는 services/calendarCategories 안에서 쓴다
router.put('/:businessId/calendar-categories/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    if (!requireManage(req, res)) return;
    const b = req.body || {};
    const patch = {};
    for (const k of ['name', 'color', 'is_active']) if (b[k] !== undefined) patch[k] = b[k];
    const row = await CC.updateCategory(Number(req.params.businessId), req.user.id, req.params.id, patch);
    return successResponse(res, CC.serialize(row));
  } catch (err) { return fail(res, err, next); }
});

// audit-exempt: 감사(calendar_category.delete)는 services/calendarCategories 안에서 쓴다
router.delete('/:businessId/calendar-categories/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    if (!requireManage(req, res)) return;
    const r = await CC.deleteCategory(Number(req.params.businessId), req.user.id, req.params.id);
    return successResponse(res, { deleted: true, moved: r.moved });
  } catch (err) { return fail(res, err, next); }
});

module.exports = router;
