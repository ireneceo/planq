// 워크스페이스 휴가 종류 설정 (2026-10-22) — 설계 docs/LEAVE_TYPES_DESIGN.md §5.3
//
// 마운트: `/api/businesses` 접두어(businesses.js·business_holidays.js 와 공유). 이 파일에는 `/:businessId/leave-types…` 꼬리 경로만 둔다.
// 권한: 읽기 = 워크스페이스 멤버(고객 제외) · 쓰기 = owner/admin(+platform_admin) — 휴일 설정과 같은 술어(services/attendanceAdmin).
// 규칙(이름 중복·유급/무급 잠금·시스템 종류·마지막 활성)·감사·방송은 전부 services/leaveTypes 안에 있다. 여기는 권한과 입출력만.
const express = require('express');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { canWrite, blockClient } = require('../services/attendanceAdmin');
const LT = require('../services/leaveTypes');

const router = express.Router();

function fail(res, err, next) {
  if (err instanceof LT.LeaveTypeError) return errorResponse(res, err.code, err.status || 400);
  return next(err);
}

async function listPayload(req, businessId) {
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  const types = await LT.listTypes(businessId, { includeInactive });
  const used = await Promise.all(types.map((t) => LT.isUsed(t)));
  return { types: types.map((t, i) => LT.serializeType(t, used[i])), can_edit: canWrite(req) };
}

// GET /api/businesses/:businessId/leave-types?include_inactive=1
router.get('/:businessId/leave-types', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    return successResponse(res, await listPayload(req, Number(req.params.businessId)));
  } catch (err) { return fail(res, err, next); }
});

// audit-exempt: 감사(leave_type.create|update|delete)는 services/leaveTypes 안에서 쓴다 — 규칙과 같은 자리
router.post('/:businessId/leave-types', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    const businessId = Number(req.params.businessId);
    const type = await LT.createType(businessId, req.user.id, req.body || {});
    return successResponse(res, LT.serializeType(type, false), null, 201);
  } catch (err) { return fail(res, err, next); }
});

// audit-exempt: 감사(leave_type.create|update|delete)는 services/leaveTypes 안에서 쓴다 — 규칙과 같은 자리
router.patch('/:businessId/leave-types/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    const businessId = Number(req.params.businessId);
    const b = req.body || {};
    const patch = {};
    for (const k of ['name', 'pay', 'default_days', 'is_active']) if (b[k] !== undefined) patch[k] = b[k];
    const type = await LT.updateType(businessId, req.user.id, req.params.id, patch);
    return successResponse(res, LT.serializeType(type, await LT.isUsed(type)));
  } catch (err) { return fail(res, err, next); }
});

// audit-exempt: 감사(leave_type.create|update|delete)는 services/leaveTypes 안에서 쓴다 — 규칙과 같은 자리
router.delete('/:businessId/leave-types/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (blockClient(req, res)) return;
    if (!canWrite(req)) return errorResponse(res, 'Admin permission required', 403);
    await LT.deleteType(Number(req.params.businessId), req.user.id, req.params.id);
    return successResponse(res, { deleted: true });
  } catch (err) { return fail(res, err, next); }
});

module.exports = router;
