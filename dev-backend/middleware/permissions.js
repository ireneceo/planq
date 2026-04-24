/**
 * 권한 미들웨어 — PERMISSION_MATRIX.md §4 (워크스페이스 토글) 구현체
 *
 * 3축 토글: financial / schedule / client_info
 * 기본값: 모두 "all" (열린 문화). owner/platform_admin 은 항상 통과.
 *
 * 사용:
 *   router.post('/api/invoices/:businessId',
 *     authenticateToken,
 *     checkBusinessAccess,
 *     canFinancial(),
 *     handler
 *   );
 *
 *   projectId 를 토글 체크에 사용하려면 extractor 전달:
 *   canFinancial({ projectIdFrom: (req) => req.body.project_id })
 *
 * 런타임 안전장치:
 *   - businesses.permissions 컬럼 없거나 NULL → 전 토글 "all" 로 간주 (기본값 동작)
 *   - project_members.is_pm 컬럼 없거나 PM 조회 실패 → pm 모드에서는 owner 만 통과
 */

const { Business, BusinessMember, ProjectMember } = require('../models');

const TOGGLE_KEYS = ['financial', 'schedule', 'client_info'];

/** 토글 값 해석 — 컬럼 없거나 NULL 이면 기본값 "all" */
function resolveToggle(permissionsJson, key) {
  if (!permissionsJson || typeof permissionsJson !== 'object') return 'all';
  const v = permissionsJson[key];
  return v === 'pm' ? 'pm' : 'all';
}

/** 해당 프로젝트의 PM 여부. is_pm 컬럼 없거나 project_id 없으면 false. */
async function isProjectPM(userId, projectId) {
  if (!projectId) return false;
  try {
    const pm = await ProjectMember.findOne({
      where: { project_id: projectId, user_id: userId, is_pm: true },
      attributes: ['id'],
    });
    return !!pm;
  } catch {
    // is_pm 컬럼 없는 과도기 → false 반환 (owner 만 통과하게)
    return false;
  }
}

/**
 * 공통 토글 체크 — 미들웨어 팩토리.
 * @param {'financial'|'schedule'|'client_info'} toggleKey
 * @param {object} [opts]
 * @param {(req) => (number|null)} [opts.projectIdFrom] — pm 모드 판정에 쓸 project_id 추출기
 */
function makeToggleMiddleware(toggleKey, opts = {}) {
  if (!TOGGLE_KEYS.includes(toggleKey)) {
    throw new Error(`[permissions] unknown toggle key: ${toggleKey}`);
  }

  return async function togglePermission(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // platform_admin 자동 통과
      if (req.user.platform_role === 'platform_admin') return next();

      // businessId 추출 — checkBusinessAccess 가 이미 세팅했으면 그걸 쓰고, 아니면 라우트 파라미터에서.
      const businessId =
        (req.businessMember && req.businessMember.business_id) ||
        req.params.businessId ||
        req.body?.business_id ||
        req.query?.business_id;

      if (!businessId) {
        return res.status(400).json({ success: false, message: 'business_id required' });
      }

      // role 확보 — checkBusinessAccess 경유했으면 req.businessRole 있음.
      let role = req.businessRole;
      if (!role) {
        const bm = await BusinessMember.findOne({
          where: { business_id: businessId, user_id: req.user.id },
          attributes: ['role'],
        });
        if (!bm) return res.status(403).json({ success: false, message: 'No access to this business' });
        role = bm.role;
      }

      // owner 는 항상 통과 (재무/일정/고객정보 전부)
      if (role === 'owner') return next();

      // 토글 값 조회
      const biz = await Business.findByPk(businessId, { attributes: ['permissions'] });
      const mode = resolveToggle(biz?.permissions, toggleKey);

      // all 모드 → member 전원 통과
      if (mode === 'all') return next();

      // pm 모드 → 해당 프로젝트 PM 만 통과 (projectId 필수)
      const projectId = opts.projectIdFrom ? opts.projectIdFrom(req) : null;
      if (!projectId) {
        // project_id 없으면 PM 여부 판단 불가 → 거부 (토글 pm 모드에서 조직 단위 액션은 owner 만)
        return res.status(403).json({
          success: false,
          message: `이 액션은 프로젝트 PM 또는 오너만 수행할 수 있습니다 (${toggleKey})`,
          code: 'pm_required',
        });
      }

      const ok = await isProjectPM(req.user.id, projectId);
      if (!ok) {
        return res.status(403).json({
          success: false,
          message: `이 액션은 프로젝트 PM 또는 오너만 수행할 수 있습니다 (${toggleKey})`,
          code: 'pm_required',
        });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

const canFinancial = (opts) => makeToggleMiddleware('financial', opts);
const canSchedule = (opts) => makeToggleMiddleware('schedule', opts);
const canClientInfo = (opts) => makeToggleMiddleware('client_info', opts);

/**
 * owner 강제 미들웨어 — 토글과 무관하게 owner/platform_admin 만 통과해야 하는 액션용.
 * 예: 멤버 초대/제거, 플랜 변경, 결제 수동 기록, 세금계산서 발행.
 * (이미 기존 라우트들이 수동으로 `req.businessRole === 'owner'` 검사하지만, 공통화해두면 일관성.)
 */
function requireBusinessOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (req.user.platform_role === 'platform_admin') return next();
  if (req.businessRole !== 'owner') {
    return res.status(403).json({ success: false, message: '이 액션은 워크스페이스 오너만 수행할 수 있습니다', code: 'owner_only' });
  }
  return next();
}

module.exports = {
  canFinancial,
  canSchedule,
  canClientInfo,
  requireBusinessOwner,
  // 단위 테스트용 내부 헬퍼
  _resolveToggle: resolveToggle,
  _isProjectPM: isProjectPM,
};
