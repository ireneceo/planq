// 멤버 메뉴 권한 · 역할(member↔admin) · 워크스페이스 «멤버 기본 권한» · 청구 담당 후보 — /api/businesses/:businessId/…
//   2026-10-23 routes/businesses.js 에서 옮겼다(동작 무변경 + member-defaults 신설, docs/MEMBER_PERMISSION_GAPS_DESIGN.md).
//   마운트는 businesses.js 보다 앞 — 여기 경로는 전부 «/:businessId/members-permissions|members/:userId/(permissions|role)|member-defaults|billing-owner-candidates|default-billing-owner» 꼬리라 겹치지 않는다.
const express = require('express');
const router = express.Router();
const { Business, BusinessMember, User } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const { BusinessMemberPermission } = require('../models');
const { getMemberMenuLevels, resolveMemberLevels, getWorkspaceMemberDefaults, normalizeDefaults, SYSTEM_DEFAULTS, VALID_MENUS, VALID_LEVELS, READ_ONLY_MENUS } = require('../middleware/menu_permission');

// 권한 변경은 owner/admin 만
async function assertWorkspaceAdmin(userId, businessId) {
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null },
    attributes: ['role'],
  });
  if (!bm) return { ok: false, code: 'not_member' };
  if (!['owner', 'admin'].includes(bm.role)) return { ok: false, code: 'workspace_admin_required' };
  return { ok: true, role: bm.role };
}

// GET — 워크스페이스 전체 멤버의 메뉴 권한 매트릭스 + role
router.get('/:businessId/members-permissions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null, role: { [require('sequelize').Op.ne]: 'ai' } },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    });
    // 기본값은 한 번만 읽어 모든 멤버에 같이 쓴다. explicit = «따로 정함» 칸(행이 있는 칸) — 나머지는 기본값을 따른다
    const defaults = await getWorkspaceMemberDefaults(businessId);
    const out = await Promise.all(members.map(async (m) => {
      const ml = await getMemberMenuLevels(businessId, m.user_id, { defaults: defaults.levels });
      return {
        user_id: m.user_id,
        name: m.user?.name || '',
        email: m.user?.email || '',
        role: m.role,
        menus: ml?.menus || {},
        explicit: ml?.explicit || {},
      };
    }));
    return successResponse(res, {
      members: out, valid_menus: VALID_MENUS, valid_levels: VALID_LEVELS,
      member_defaults: defaults.levels, system_defaults: SYSTEM_DEFAULTS,
    });
  } catch (e) { next(e); }
});

// PUT — 멤버 메뉴 권한 한 건 업데이트
router.put('/:businessId/members/:userId/permissions', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const targetUserId = Number(req.params.userId);
    const { menu_key, level } = req.body;

    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);

    if (!VALID_MENUS.includes(menu_key)) return errorResponse(res, 'invalid_menu_key', 400);
    // 'default' = 따로 정한 칸을 지워 워크스페이스 기본값을 따르게 한다(2026-10-23 D2)
    if (!VALID_LEVELS.includes(level) && level !== 'default') return errorResponse(res, 'invalid_level', 400);

    // 사이클 N+21-fix — insights 등 read-only 메뉴는 write 강제 차단 → read 로 hint.
    const effectiveLevel = (READ_ONLY_MENUS.includes(menu_key) && level === 'write') ? 'read' : level;

    // 대상 멤버 존재 확인
    const targetMember = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: targetUserId, removed_at: null },
      attributes: ['role'],
    });
    if (!targetMember) return errorResponse(res, 'target_not_member', 404);
    // owner/admin 의 권한은 row 무관 (항상 write). 변경 의미 없으므로 차단.
    if (['owner', 'admin', 'ai'].includes(targetMember.role)) {
      return errorResponse(res, 'role_has_implicit_full_access', 400);
    }

    if (level === 'default') {
      const existing = await BusinessMemberPermission.findOne({ where: { business_id: businessId, user_id: targetUserId, menu_key } }); // menudefault-exempt: 지우기 전 옛 값 기록(판정 아님)
      if (existing) {
        await existing.destroy();
        require('../services/auditService').logAudit(req, {
          action: 'member_permission.update', targetType: 'business_member_permission', targetId: existing.id,
          oldValue: { menu_key, level: existing.level }, newValue: { menu_key, level: 'default' },
        });
        req.app.get('io')?.to(`user:${targetUserId}`).emit('permissions:updated', { business_id: businessId });
      }
      const lv = (await resolveMemberLevels(businessId, targetUserId))[menu_key];
      return successResponse(res, { business_id: businessId, user_id: targetUserId, menu_key, level: lv, explicit: false });
    }

    // upsert
    const [row, created] = await BusinessMemberPermission.findOrCreate({
      where: { business_id: businessId, user_id: targetUserId, menu_key },
      defaults: { level: effectiveLevel, updated_by: req.user.id },
    });
    const old_level = row.level;
    if (!created) {
      await row.update({ level: effectiveLevel, updated_by: req.user.id });
    }
    require('../services/auditService').logAudit(req, {
      action: 'member_permission.update',
      targetType: 'business_member_permission',
      targetId: row.id,
      oldValue: { menu_key, level: old_level },
      newValue: { menu_key, level: effectiveLevel },
    });
    // 그 사람의 화면이 새로고침 없이 메뉴를 따라가게 — 신호만(0-E E-2). 받는 곳은 App 루트 WorkspaceSyncGuard 한 곳.
    req.app.get('io')?.to(`user:${targetUserId}`).emit('permissions:updated', { business_id: businessId });
    return successResponse(res, { id: row.id, business_id: businessId, user_id: targetUserId, menu_key, level: effectiveLevel, explicit: true });
  } catch (e) { next(e); }
});

// PUT — 워크스페이스 «멤버 기본 권한» 한 칸 (2026-10-23 D2, docs/MEMBER_PERMISSION_GAPS_DESIGN.md)
//   따로 정하지 않은 멤버 전원에게 **즉시** 적용된다(행 없음 = 기본값 하나가 정본). owner/admin 은 영향 없음(항상 전권).
//   level 'default' = 시스템 기본값으로 되돌림. 저장은 permissions JSON 의 member_defaults 칸 — 다른 키는 보존.
router.put('/:businessId/member-defaults', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { menu_key, level } = req.body || {};
    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);
    if (!VALID_MENUS.includes(menu_key)) return errorResponse(res, 'invalid_menu_key', 400);
    if (!VALID_LEVELS.includes(level) && level !== 'default') return errorResponse(res, 'invalid_level', 400);

    const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
    if (!biz) return errorResponse(res, 'not_found', 404);
    const base = biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
    const custom = normalizeDefaults(base.member_defaults);
    const oldLevel = custom[menu_key] || SYSTEM_DEFAULTS[menu_key];
    if (level === 'default') delete custom[menu_key];
    else {
      const eff = (READ_ONLY_MENUS.includes(menu_key) && level === 'write') ? 'read' : level;
      if (eff === SYSTEM_DEFAULTS[menu_key]) delete custom[menu_key]; else custom[menu_key] = eff;
    }
    // JSON 칸은 새 객체로 통째로 넣는다(in-place 수정은 저장되지 않는다 — memory feedback_sequelize_json_inplace_mutation)
    await biz.update({ permissions: { ...base, member_defaults: custom } });
    const levels = { ...SYSTEM_DEFAULTS, ...custom };
    require('../services/auditService').logAudit(req, {
      action: 'business.member_defaults.update', targetType: 'business', targetId: businessId,
      oldValue: { menu_key, level: oldLevel }, newValue: { menu_key, level: levels[menu_key] },
    });
    // 행 없는 멤버의 사이드바가 따라오게 — 일반 멤버 전원 개인 방에 신호(WorkspaceSyncGuard 가 받아 다시 읽는다)
    const io = req.app.get('io');
    if (io) {
      const mems = await BusinessMember.findAll({ where: { business_id: businessId, removed_at: null, role: 'member' }, attributes: ['user_id'] });
      for (const m of mems) if (m.user_id) io.to(`user:${m.user_id}`).emit('permissions:updated', { business_id: businessId });
    }
    return successResponse(res, { member_defaults: levels, menu_key, level: levels[menu_key] });
  } catch (e) { next(e); }
});

// PUT — 멤버 role 변경 (member ↔ admin). owner 변경은 별도 라우트 (인사 권한).
router.put('/:businessId/members/:userId/role', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const targetUserId = Number(req.params.userId);
    const { role } = req.body;

    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);

    // role 전이 정책: member ↔ admin 만. owner 임명/해제는 owner 만 (별도 라우트).
    if (!['member', 'admin'].includes(role)) {
      return errorResponse(res, 'role_must_be_member_or_admin', 400);
    }
    const targetMember = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: targetUserId, removed_at: null },
    });
    if (!targetMember) return errorResponse(res, 'target_not_member', 404);
    if (targetMember.role === 'owner' || targetMember.role === 'ai') {
      return errorResponse(res, 'cannot_change_owner_or_ai_role', 400);
    }
    if (targetMember.role === role) {
      return successResponse(res, { user_id: targetUserId, role, unchanged: true });
    }
    const oldRole = targetMember.role;
    await targetMember.update({ role });
    require('../services/auditService').logAudit(req, {
      action: 'member_role.change',
      targetType: 'business_member',
      targetId: targetMember.id,
      // 두 문(PUT 권한 · PATCH 소유권)이 **같은 이름·같은 모양** — 원장에서 한 사건으로 읽혀야 한다(AUDIT_GAPS §C).
      oldValue: { role: oldRole, user_id: targetMember.user_id },
      newValue: { role },
    });
    req.app.get('io')?.to(`user:${targetUserId}`).emit('permissions:updated', { business_id: businessId });   // 0-E E-2
    return successResponse(res, { user_id: targetUserId, role });
  } catch (e) { next(e); }
});

// GET — Q Bill 청구서 owner 후보 (write 권한 가진 멤버만)
router.get('/:businessId/billing-owner-candidates', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const members = await BusinessMember.findAll({
      where: { business_id: businessId, removed_at: null, role: { [require('sequelize').Op.ne]: 'ai' } },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
    });
    const candidates = [];
    for (const m of members) {
      // owner/admin = 무조건 후보
      if (m.role === 'owner' || m.role === 'admin') {
        candidates.push({ user_id: m.user_id, name: m.user?.name || '', email: m.user?.email || '', role: m.role, level: 'write' });
        continue;
      }
      // member — qbill level 평가 (기본값까지 requireMenu 와 같은 함수)
      const level = (await resolveMemberLevels(businessId, m.user_id)).qbill;
      if (level === 'write') {
        candidates.push({ user_id: m.user_id, name: m.user?.name || '', email: m.user?.email || '', role: m.role, level });
      }
    }
    return successResponse(res, candidates);
  } catch (e) { next(e); }
});

// PUT — workspace default_billing_owner 변경
router.put('/:businessId/default-billing-owner', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { user_id } = req.body;

    const adm = await assertWorkspaceAdmin(req.user.id, businessId);
    if (!adm.ok) return errorResponse(res, adm.code, 403);

    const biz = await Business.findByPk(businessId);
    if (!biz) return errorResponse(res, 'not_found', 404);
    const oldValue = biz.default_billing_owner_id;

    if (user_id != null) {
      // 후보 검증 — write 권한자만 OK
      const targetMember = await BusinessMember.findOne({
        where: { business_id: businessId, user_id: Number(user_id), removed_at: null },
        attributes: ['role'],
      });
      if (!targetMember) return errorResponse(res, 'target_not_member', 404);
      if (!['owner', 'admin'].includes(targetMember.role)) {
        const level = (await resolveMemberLevels(businessId, Number(user_id))).qbill;
        if (level !== 'write') return errorResponse(res, 'target_lacks_qbill_write', 400);
      }
    }
    await biz.update({ default_billing_owner_id: user_id || null });
    require('../services/auditService').logAudit(req, {
      action: 'business.default_billing_owner.update',
      targetType: 'business',
      targetId: businessId,
      oldValue: { default_billing_owner_id: oldValue },
      newValue: { default_billing_owner_id: user_id || null },
    });
    return successResponse(res, { default_billing_owner_id: user_id || null });
  } catch (e) { next(e); }
});

module.exports = router;
