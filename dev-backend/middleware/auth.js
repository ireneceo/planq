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
      // 활성 워크스페이스 — 여태 여기에 안 실려 `req.user.active_business_id` 를 읽는 라우트가
      // 전부 undefined 를 받았다(Cue 는 그 탓에 워크스페이스 전환을 못 따라가고 첫 멤버십에 고정).
      //   ⚠️ 이 값은 "사용자가 마지막으로 고른 워크스페이스" 일 뿐 권한 근거가 아니다.
      //      switch-workspace 가 저장 시점에 멤버십을 검증하지만 그 뒤 멤버 해제·워크스페이스
      //      삭제로 stale 이 될 수 있다 → 소비처는 반드시 생존·멤버십을 재확인할 것.
      active_business_id: user.active_business_id || null,
    };

    // ★ 삭제된 워크스페이스 차단 — **인증 요청의 단일 관문** (Fable 치명-4).
    //   워크스페이스 접근 판정이 attachWorkspaceScope / getUserScope / 라우트 인라인
    //   `BusinessMember.findOne` 세 갈래로 갈라져 있어, 인라인 쪽(40여 파일)이 삭제된
    //   워크스페이스를 계속 읽고 썼다(실측: work-hours PATCH 200 쓰기 성공).
    //   라우트를 하나씩 고치면 새 라우트마다 같은 구멍이 다시 나므로 여기서 한 번에 막는다.
    //   platform_admin 은 통과 — 복구·감사 목적(access_scope 설계와 동일).
    try {
      const { workspaceAliveCheck } = require('./workspaceAlive');
      const blocked = await workspaceAliveCheck(req);
      if (blocked) {
        return res.status(404).json({
          success: false,
          message: 'Workspace not found',
          code: 'workspace_deleted',
        });
      }
    } catch (e) {
      console.warn('[authenticateToken workspaceAlive]', e.message);   // 판정 실패로 정상 트래픽을 막지 않는다
    }

    next();
  } catch (error) {
    return next(error);
  }
};

// optionalAuth — 토큰이 있고 유효하면 req.user 세팅, 없거나 무효면 게스트(req.user=null)로 통과.
// Q위키처럼 공개+로그인 모두 허용하는 read 라우트용. 인증 실패해도 401 안 냄.
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  req.user = null;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.userId || decoded.id);
    if (user && user.status === 'active') {
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        platform_role: user.platform_role,
        // authenticateToken 과 같은 모양으로 유지 — 두 생성자가 갈라지면
        // "어느 미들웨어를 탔느냐" 에 따라 라우트 동작이 달라진다.
        active_business_id: user.active_business_id || null,
      };
    }
  } catch (_) {
    // 무효 토큰 → 게스트로 계속
  }
  next();
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

module.exports = { authenticateToken, optionalAuth, requireRole, checkBusinessAccess };
