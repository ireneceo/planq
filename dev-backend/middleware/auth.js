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

const checkBusinessAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.platform_role === 'platform_admin') {
      return next();
    }

    const businessId = req.params.businessId || req.body.business_id || req.query.business_id;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business ID required' });
    }

    const BusinessMember = require('../models/BusinessMember');
    const membership = await BusinessMember.findOne({
      where: { business_id: businessId, user_id: req.user.id }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'No access to this business' });
    }

    req.businessMember = membership;
    req.businessRole = membership.role;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { authenticateToken, requireRole, checkBusinessAccess };
