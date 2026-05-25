const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─────────────────────────────────────────────
// HTTP status 정책 (RFC 7235 / 7231)
//   401 Unauthorized  — 신원 미확인/실패: 토큰 없음, 만료, 위조, 사용자 없음
//                       → 프론트는 refresh 시도 후 재시도
//   403 Forbidden     — 신원 확인됐으나 자원 접근 거부: 정지된 계정, 권한 부족
//                       → 프론트는 refresh 시도하지 않음 (해도 통과 안 됨)
//
// 모든 응답에 `code` 필드를 같이 보내서 프론트/관제에서 구분 가능하게 한다.
// ─────────────────────────────────────────────

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required',
      code: 'no_token',
    });
  }

  // JWT verify 만 별도 try — 위조/만료 vs DB 에러를 분리해서 다룬다.
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        code: 'token_expired',
      });
    }
    // JsonWebTokenError, NotBeforeError, signature mismatch 등
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      code: 'invalid_token',
    });
  }

  // DB 조회 — 에러는 글로벌 errorHandler 로 위임 (403 으로 위장 금지)
  try {
    const user = await User.findByPk(decoded.userId || decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
        code: 'user_not_found',
      });
    }

    if (user.status !== 'active') {
      // 신원은 확인됨 — refresh 해도 풀리지 않음 → 403 + 명시적 code
      return res.status(403).json({
        success: false,
        message: 'Account suspended',
        code: 'account_suspended',
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      platform_role: user.platform_role,
    };

    next();
  } catch (error) {
    return next(error);
  }
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'no_auth_context',
      });
    }
    if (!allowedRoles.includes(req.user.platform_role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'insufficient_role',
      });
    }
    next();
  };
};

// N+69 — checkBusinessAccess 를 attachWorkspaceScope 로 위임 (137 호출처 통일).
// memberOnly: true (client 차단 옛 동작) + platformAdminAs: 'owner' (platform_admin 의 businessRole 호환)
// 효과: 모든 옛 라우트가 자동으로 req.scope 풀세트 + scope.isClient/isMember/projectMemberIds 사용 가능.
const { attachWorkspaceScope } = require('./access_scope');
const checkBusinessAccess = attachWorkspaceScope({ memberOnly: true, platformAdminAs: 'owner' });

module.exports = { authenticateToken, requireRole, checkBusinessAccess };
