// Visibility 미들웨어
// 리소스 단위 가시성 정책을 시행.
//
// 리소스 객체에 다음 필드가 있을 때 적용:
//   visibility: 'private' | 'workspace' | 'custom'
//   owner_user_id: 소유자
//   shared_with: custom 일 때 user_id 배열 (JSON)
//
// 사용 예:
//   router.get('/documents/:id',
//     authenticateToken, checkBusinessAccess,
//     loadResource(Document, 'id'),
//     checkVisibility('document'),
//     handler);

const errorResponse = (res, msg, code = 403) =>
  res.status(code).json({ success: false, message: msg });

// 공통 시행 함수 — 다른 라우트에서 직접 호출 가능
function canAccess(resource, user, businessRole) {
  if (!resource) return false;

  // platform_admin 은 모든 워크스페이스 접근 허용 (이미 상위 미들웨어에서 통과됨)
  if (user.platform_role === 'platform_admin') return true;

  // visibility 필드가 없으면 기본 workspace 공개로 간주 (레거시 호환)
  const vis = resource.visibility || 'workspace';

  if (vis === 'private') {
    return resource.owner_user_id === user.id;
  }
  if (vis === 'workspace') {
    return true; // checkBusinessAccess 가 이미 통과시켰으므로 워크스페이스 소속 보장
  }
  if (vis === 'custom') {
    const list = Array.isArray(resource.shared_with) ? resource.shared_with : [];
    return list.includes(user.id) || resource.owner_user_id === user.id;
  }
  return false;
}

// loadResource(Model, paramKey) — 리소스를 req._resource 에 로드
function loadResource(Model, paramKey = 'id') {
  return async (req, res, next) => {
    try {
      const id = req.params[paramKey];
      if (!id) return errorResponse(res, 'Resource ID required', 400);
      const resource = await Model.findByPk(id);
      if (!resource) return errorResponse(res, 'Resource not found', 404);
      req._resource = resource;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// checkVisibility — req._resource 기준으로 접근 허용 검사
function checkVisibility() {
  return (req, res, next) => {
    const resource = req._resource;
    if (!resource) return errorResponse(res, 'Resource not loaded', 500);
    if (!canAccess(resource, req.user, req.businessRole)) {
      return errorResponse(res, 'Access denied by visibility policy', 403);
    }
    next();
  };
}

module.exports = {
  canAccess,
  loadResource,
  checkVisibility
};
