// 급여 권한 — 술어 한 곳 (docs/PAYROLL_DESIGN.md §4)
//   보는 사람 = 대표(owner) + 지정 급여 담당자(businesses.permissions.payroll.manager_user_ids ∩ 지금 멤버).
//   ★ admin 자동 아님 · platform_admin 백도어 없음 · client/ai 아님. 보기·쓰기·확정이 같은 술어다
//     (쓰기는 추가로 plan.can('use_payroll')). 직원은 자기 계약·명세서만(canReadOwn*).
const { Business, BusinessMember } = require('../models');
const { getUserScope } = require('../middleware/access_scope');

/** 지정 급여 담당자 id — 지금 멤버(owner/admin/member, 내보내지 않음)인 사람만. 내보낸 사람은 목록에 남아도 빠진다. */
async function payrollManagerIds(biz) {
  const raw = biz?.permissions?.payroll?.manager_user_ids;
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const rows = await BusinessMember.findAll({
    where: { business_id: biz.id, user_id: ids, removed_at: null, role: ['owner', 'admin', 'member'] },
    attributes: ['user_id'],
  });
  return rows.map((r) => r.user_id);
}

/** 이 사람이 이 워크스페이스 급여를 관리할 수 있나. biz 는 행(없으면 읽는다). */
async function canManagePayroll(userId, businessId, platformRole, biz) {
  if (!userId || !businessId) return false;
  const scope = await getUserScope(userId, businessId, platformRole);
  if (scope.isOwner) return true;
  // platform_admin·client·ai 는 담당자 목록에 있어도 안 된다(getUserScope 가 platform_admin 을 owner 로 보지 않는다)
  if (scope.isPlatformAdmin || scope.isClient || scope.isAi || !(scope.isMember || scope.isAdmin)) return false;
  const b = biz || await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
  if (!b) return false;
  return (await payrollManagerIds(b)).includes(Number(userId));
}

/** 미들웨어 — 관리자(owner + 지정 담당자)만. 아니면 403. requireModule 다음에 둔다. */
function requirePayrollManager(req, res, next) {
  canManagePayroll(req.user.id, Number(req.params.businessId), req.user.platform_role)
    .then((ok) => (ok ? next() : res.status(403).json({ success: false, message: 'payroll_forbidden' })))
    .catch(next);
}

/** 미들웨어 — 쓰기 자격(요금제). 읽기 라우트에는 걸지 않는다. */
function requirePayrollWrite(req, res, next) {
  require('./plan').can(Number(req.params.businessId), 'use_payroll')
    .then((r) => (r.ok ? next() : res.status(409).json({ success: false, message: r.reason || 'plan_required' })))
    .catch(next);
}

/** owner 만 — 급여 담당자 지정·기능 켜기는 «대표의 결정» 이다(설계 §2.1). */
async function isOwnerOf(userId, businessId, platformRole) {
  const scope = await getUserScope(userId, businessId, platformRole);
  return !!scope.isOwner;
}

/** 본인 계약 열람 — 대상자의 user_id 가 나 */
function canReadOwnContracts(userId, person) {
  return !!person && person.user_id != null && Number(person.user_id) === Number(userId);
}

module.exports = { payrollManagerIds, canManagePayroll, requirePayrollManager, requirePayrollWrite, isOwnerOf, canReadOwnContracts };
