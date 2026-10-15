// 역할 사전 — /api/member-roles (2026-10-15, Fable 설계 · docs/MEMBER_ROLES_DESIGN.md)
//
// 프로젝트 멤버 역할 · 멤버 기본 역할이 함께 쓰는 워크스페이스 목록. 쓰는 규칙은 services/memberRoles.js 한 곳.
//   - 조회·추가 = 멤버 이상(고객 403) — 피커의 «'xx' 추가» 와 같은 권한
//   - 이름 변경·정렬·삭제 = owner/admin — 남의 멤버 행을 일괄로 바꾼다(태그와 다른 점)
// 실시간: `member_role:updated` 신호(business 방) — 받는 화면이 사전을 다시 읽는다.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requestScope, staleResponse } = require('../middleware/workspaceContext');
const { getUserScope, isMemberOrAbove, isWorkspaceAdmin } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { MemberRole } = require('../models');
const { logAudit } = require('../services/auditService');
const roles = require('../services/memberRoles');

const MESSAGES = {
  role_name_required: '역할 이름을 입력하세요',
  role_too_long: `역할 이름은 ${roles.MAX_LEN}자 이내입니다`,
  role_limit: `역할은 워크스페이스당 최대 ${roles.MAX_PER_BIZ}개입니다`,
  role_duplicate: '같은 이름의 역할이 이미 있습니다',
};
function sendRoleError(res, err, next) {
  if (err instanceof roles.RoleError) return errorResponse(res, MESSAGES[err.code] || err.code, err.http || 400);
  return next(err);
}

function serialize(r, usage) {
  const u = usage?.get(String(r.name).trim().toLowerCase()) || { project: 0, default: 0 };
  return { id: r.id, name: r.name, sort_order: r.sort_order, usage_project: u.project, usage_default: u.default };
}

function broadcast(req, businessId) {
  const io = req.app.get('io');
  if (io) io.to(`business:${businessId}`).emit('member_role:updated', { business_id: businessId, actor_user_id: req.user.id });
}

async function scopeFor(req, res, businessId, { admin = false } = {}) {
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  if (!isMemberOrAbove(scope)) { errorResponse(res, 'forbidden', 403); return null; }
  if (admin && !isWorkspaceAdmin(scope)) { errorResponse(res, 'owner_or_admin_only', 403); return null; }
  return scope;
}

function bizFromReq(req, res) {
  const ws = requestScope(req, req.body?.business_id || req.query?.business_id);
  if (ws.stale) { staleResponse(res, ws); return null; }
  const id = Number(ws.businessId);
  if (!id) { errorResponse(res, 'business_id required', 400); return null; }
  return id;
}

async function loadRole(req, res) {
  const role = await MemberRole.findByPk(Number(req.params.id));
  if (!role) { errorResponse(res, 'role_not_found', 404); return null; }
  return role;
}

// GET /api/member-roles?business_id= — 사전 + 사용 수(프로젝트 멤버·기본 역할 두 축)
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = bizFromReq(req, res);
    if (!businessId) return;
    if (!(await scopeFor(req, res, businessId))) return;
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await MemberRole.findAndCountAll({
      where: { business_id: businessId },
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
      limit, offset,
    });
    const usage = await roles.usageCounts(businessId);
    return paginatedResponse(res, rows.map((r) => serialize(r, usage)), count, { limit, page, offset });
  } catch (err) { next(err); }
});

// POST /api/member-roles { business_id, name } — 추가(멤버 이상). 이미 있으면 그 행을 200 으로 돌려준다(피커 «추가» 가 멱등).
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = bizFromReq(req, res);
    if (!businessId) return;
    if (!(await scopeFor(req, res, businessId))) return;
    const before = await MemberRole.count({ where: { business_id: businessId } });
    let name;
    try {
      name = await roles.ensureRole(businessId, req.body?.name, { userId: req.user.id });
    } catch (err) { return sendRoleError(res, err, next); }
    if (!name) return errorResponse(res, MESSAGES.role_name_required, 400);
    const row = await MemberRole.findOne({ where: { business_id: businessId, name } });
    const created = (await MemberRole.count({ where: { business_id: businessId } })) > before;
    if (created) {
      logAudit(req, { action: 'member_role.create', targetType: 'member_role', targetId: row.id, businessId, newValue: { name } });
      broadcast(req, businessId);
    }
    return successResponse(res, serialize(row), created ? 'Role created' : undefined, created ? 201 : 200);
  } catch (err) { next(err); }
});

// PUT /api/member-roles/order { business_id, ids: [] } — 정렬(owner/admin)
router.put('/order', authenticateToken, async (req, res, next) => {
  try {
    const businessId = bizFromReq(req, res);
    if (!businessId) return;
    if (!(await scopeFor(req, res, businessId, { admin: true }))) return;
    const n = await roles.reorder(businessId, req.body?.ids);
    logAudit(req, { action: 'member_role.reorder', targetType: 'business', targetId: businessId, businessId, newValue: { ids: req.body?.ids } });
    broadcast(req, businessId);
    return successResponse(res, { reordered: n });
  } catch (err) { next(err); }
});

// PUT /api/member-roles/:id { name } — 이름 변경(owner/admin). 이 역할을 단 멤버 칸도 함께 바뀐다.
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const role = await loadRole(req, res);
    if (!role) return;
    if (!(await scopeFor(req, res, role.business_id, { admin: true }))) return;
    let r;
    try { r = await roles.renameRole(role, req.body?.name); } catch (err) { return sendRoleError(res, err, next); }
    if (r.old) {
      logAudit(req, {
        action: 'member_role.rename', targetType: 'member_role', targetId: role.id, businessId: role.business_id,
        oldValue: { name: r.old }, newValue: { name: r.name, changed: r.changed },
      });
      broadcast(req, role.business_id);
    }
    return successResponse(res, { ...serialize(role), changed: r.changed });
  } catch (err) { next(err); }
});

// DELETE /api/member-roles/:id — 삭제(owner/admin). 그 역할을 단 칸은 비운다 — 응답에 비운 수.
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const role = await loadRole(req, res);
    if (!role) return;
    if (!(await scopeFor(req, res, role.business_id, { admin: true }))) return;
    const id = role.id; const businessId = role.business_id;
    const r = await roles.deleteRole(role);
    logAudit(req, { action: 'member_role.delete', targetType: 'member_role', targetId: id, businessId, oldValue: { name: r.name, cleared: r.cleared } });
    broadcast(req, businessId);
    return successResponse(res, { id, deleted: true, cleared: r.cleared });
  } catch (err) { next(err); }
});

module.exports = router;
