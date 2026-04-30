const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.userId || decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token - user not found' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      platform_role: user.platform_role
    };

    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.platform_role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
};

// IDOR 방어: businessId 는 URL 경로 (:businessId) 에서만 신뢰. body/query 는 사용자 조작 가능하므로 폴백 금지.
// 모든 사용 라우트가 :businessId 경로 패턴이므로 변경 영향 없음 (2026-04-30 검증).
const checkBusinessAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const businessId = Number(req.params.businessId);
    if (!businessId || Number.isNaN(businessId)) {
      return res.status(400).json({ success: false, message: 'Business ID required in URL path' });
    }

    if (req.user.platform_role === 'platform_admin') {
      // 라우트가 req.businessRole 을 직접 참조하는 경우 undefined 가드
      req.businessId = businessId;
      req.businessRole = 'owner';
      req.businessMember = null;
      return next();
    }

    const BusinessMember = require('../models/BusinessMember');
    const membership = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'No access to this business' });
    }

    req.businessId = businessId;
    req.businessMember = membership;
    req.businessRole = membership.role;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { authenticateToken, requireRole, checkBusinessAccess };
