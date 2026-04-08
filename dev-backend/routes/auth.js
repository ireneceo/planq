const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessMember } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { sequelize } = require('../config/database');

// ============================================
// Helper: slug 생성
// ============================================
const generateSlug = (name) => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
  const suffix = Date.now().toString(36);
  return `${base}-${suffix}`;
};

// ============================================
// Helper: 토큰 생성
// ============================================
const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

// ============================================
// Helper: 사용자 + 소속 Business 정보 조회
// ============================================
const getUserWithBusiness = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: { exclude: ['password_hash', 'refresh_token', 'reset_token', 'reset_token_expires'] }
  });
  if (!user) return null;

  const membership = await BusinessMember.findOne({
    where: { user_id: userId },
    include: [{ model: Business, attributes: ['id', 'name', 'slug', 'plan'] }]
  });

  const userData = user.toJSON();
  if (membership) {
    userData.business_id = membership.business_id;
    userData.business_name = membership.Business?.name || null;
    userData.business_role = membership.role;
  }

  return userData;
};

// ============================================
// POST /api/auth/register
// ============================================
router.post('/register', async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { email, password, name, business_name } = req.body;

    // Validation
    if (!email || !password || !name || !business_name) {
      await transaction.rollback();
      return errorResponse(res, 'Email, password, name, and business name are required', 400);
    }

    if (password.length < 8) {
      await transaction.rollback();
      return errorResponse(res, 'Password must be at least 8 characters', 400);
    }

    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      await transaction.rollback();
      return errorResponse(res, 'Password must contain both letters and numbers', 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await transaction.rollback();
      return errorResponse(res, 'Invalid email format', 400);
    }

    // Check duplicate
    const existing = await User.findOne({ where: { email }, transaction });
    if (existing) {
      await transaction.rollback();
      return errorResponse(res, 'Email already registered', 409);
    }

    // 1. Create User
    const password_hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email, password_hash, name
    }, { transaction });

    // 2. Create Business
    const slug = generateSlug(business_name);
    const business = await Business.create({
      name: business_name,
      slug,
      owner_id: user.id
    }, { transaction });

    // 3. Create BusinessMember (owner)
    await BusinessMember.create({
      business_id: business.id,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date()
    }, { transaction });

    // 4. Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // 5. Save refresh token
    await user.update({ refresh_token: refreshToken }, { transaction });

    await transaction.commit();

    // 6. Set refresh token as HttpOnly cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth'
    });

    successResponse(res, {
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platform_role: user.platform_role,
        business_id: business.id,
        business_name: business.name,
        business_role: 'owner'
      }
    }, 'Registration successful', 201);
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
});

// ============================================
// POST /api/auth/login
// ============================================
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return errorResponse(res, 'Email and password required', 400);
    }

    // 이메일 또는 username으로 로그인
    const { Op } = require('sequelize');
    const isEmail = email.includes('@');
    const user = await User.findOne({
      where: isEmail ? { email } : { username: email }
    });
    if (!user) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    if (user.status !== 'active') {
      return errorResponse(res, 'Account suspended', 403);
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token + last_login_at
    await user.update({
      refresh_token: refreshToken,
      last_login_at: new Date()
    });

    // Set refresh token as HttpOnly cookie
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });

    // Get user with business info
    const userData = await getUserWithBusiness(user.id);

    successResponse(res, {
      token: accessToken,
      user: userData
    }, 'Login successful');
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/refresh
// ============================================
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    if (!refreshToken) {
      return errorResponse(res, 'Refresh token required', 401);
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      return errorResponse(res, 'Invalid or expired refresh token', 401);
    }

    // Find user with matching refresh token
    const user = await User.findOne({
      where: { id: decoded.userId, refresh_token: refreshToken }
    });

    if (!user || user.status !== 'active') {
      return errorResponse(res, 'Invalid refresh token', 401);
    }

    // Rotate: generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    await user.update({ refresh_token: newRefreshToken });

    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth'
    });

    const userData = await getUserWithBusiness(user.id);

    successResponse(res, {
      token: newAccessToken,
      user: userData
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/logout
// ============================================
router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    if (refreshToken) {
      // Invalidate refresh token in DB
      const decoded = jwt.decode(refreshToken);
      if (decoded?.userId) {
        await User.update(
          { refresh_token: null },
          { where: { id: decoded.userId } }
        );
      }
    }

    // Clear cookie
    res.clearCookie('refresh_token', { path: '/api/auth' });

    successResponse(res, null, 'Logged out');
  } catch (error) {
    next(error);
  }
});

// ============================================
// GET /api/auth/me
// ============================================
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const userData = await getUserWithBusiness(req.user.id);
    if (!userData) {
      return errorResponse(res, 'User not found', 404);
    }
    successResponse(res, userData);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
