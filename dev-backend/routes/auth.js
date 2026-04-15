const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessMember, Client } = require('../models');
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
// Helper: 사용자 + 모든 소속 Workspace (멤버 + 고객)
// ============================================
//
// 한 사용자가 여러 워크스페이스에 속할 수 있고(자기 회사 = 멤버, 거래처 = 고객),
// 각 워크스페이스에서 다른 역할(owner / member / client)을 가짐.
//
// 반환 구조:
//   userData.workspaces = [
//     { business_id, brand_name, slug, role: 'owner'|'member'|'client', plan, is_active },
//     ...
//   ]
//   userData.business_id   = active workspace 의 id (없으면 첫 항목)
//   userData.business_name = active workspace 의 brand_name
//   userData.business_role = active workspace 에서의 역할
//
// active workspace 는 users.active_business_id 로 영구 저장. 없으면 첫 워크스페이스 fallback.
// ============================================
const getUserWithBusiness = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: { exclude: ['password_hash', 'refresh_token', 'reset_token', 'reset_token_expires'] }
  });
  if (!user) return null;

  // 1) 멤버십 (owner / member)
  const memberships = await BusinessMember.findAll({
    where: { user_id: userId },
    include: [{ model: Business, attributes: ['id', 'name', 'slug', 'plan', 'brand_name'] }]
  });

  // 2) 고객 (client) — 활성 상태만
  const clientRows = await Client.findAll({
    where: { user_id: userId, status: 'active' },
    include: [{ model: Business, attributes: ['id', 'name', 'slug', 'plan', 'brand_name'] }]
  });

  // 3) workspaces 배열 빌드 — 같은 business 에 둘 다 있으면 멤버십 우선
  const map = new Map();
  for (const m of memberships) {
    if (!m.Business) continue;
    map.set(m.business_id, {
      business_id: m.business_id,
      brand_name: m.Business.brand_name || m.Business.name,
      slug: m.Business.slug,
      plan: m.Business.plan,
      role: m.role,  // 'owner' | 'member' | 'ai'
    });
  }
  for (const c of clientRows) {
    if (!c.Business) continue;
    if (!map.has(c.business_id)) {
      map.set(c.business_id, {
        business_id: c.business_id,
        brand_name: c.Business.brand_name || c.Business.name,
        slug: c.Business.slug,
        plan: c.Business.plan,
        role: 'client',
      });
    }
  }

  const workspaces = Array.from(map.values()).sort((a, b) => a.business_id - b.business_id);

  // 4) active workspace 결정
  let activeId = user.active_business_id;
  if (!activeId || !map.has(activeId)) {
    activeId = workspaces[0]?.business_id || null;
  }
  const activeWs = activeId ? map.get(activeId) : null;

  // 5) is_active 플래그 부착
  for (const w of workspaces) w.is_active = (w.business_id === activeId);

  const userData = user.toJSON();
  userData.workspaces = workspaces;
  if (activeWs) {
    userData.business_id = activeWs.business_id;
    userData.business_name = activeWs.brand_name;
    userData.business_role = activeWs.role;
  } else {
    userData.business_id = null;
    userData.business_name = null;
    userData.business_role = null;
  }
  return userData;
};

// ============================================
// POST /api/auth/register
// ============================================
router.post('/register', async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const {
      email,
      password,
      name,
      // 신규: 워크스페이스 이름(브랜드) — 레거시 호환 위해 business_name 도 허용
      workspace_name,
      business_name,
      brand_name_en,
      default_language
    } = req.body;

    const brandName = workspace_name || business_name;
    const lang = default_language === 'en' ? 'en' : 'ko';

    // Validation
    if (!email || !password || !name || !brandName) {
      await transaction.rollback();
      return errorResponse(res, 'Email, password, name, and workspace name are required', 400);
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

    // Cue 시스템 이메일 차단 (일반 가입에서 사용 불가)
    if (/^cue\+\d+@system\.planq\.kr$/.test(email)) {
      await transaction.rollback();
      return errorResponse(res, 'Reserved email address', 400);
    }

    // Check duplicate
    const existing = await User.findOne({ where: { email }, transaction });
    if (existing) {
      await transaction.rollback();
      return errorResponse(res, 'Email already registered', 409);
    }

    // 1. Create human User
    const password_hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email, password_hash, name, language: lang, is_ai: false
    }, { transaction });

    // 2. Create Business (워크스페이스)
    const slug = generateSlug(brandName);
    const business = await Business.create({
      name: brandName,                // legacy 호환
      brand_name: brandName,
      brand_name_en: lang === 'ko' ? (brand_name_en || null) : null,
      slug,
      owner_id: user.id,
      default_language: lang,
      cue_mode: 'smart',
      cue_paused: false
    }, { transaction });

    // 3. Create BusinessMember (관리자)
    await BusinessMember.create({
      business_id: business.id,
      user_id: user.id,
      role: 'owner',
      joined_at: new Date()
    }, { transaction });

    // 4. Create Cue 시스템 계정 (AI 팀원)
    const cueRandomHash = await bcrypt.hash(Math.random().toString(36) + Date.now(), 12);
    const cueUser = await User.create({
      email: `cue+${business.id}@system.planq.kr`,
      password_hash: cueRandomHash,
      name: 'Cue',
      avatar_url: '/static/cue.svg',
      is_ai: true,
      platform_role: 'user',
      status: 'active',
      language: lang
    }, { transaction });

    // Cue 의 email 은 business.id 가 필요하므로 이미 반영됨.
    // business.cue_user_id 업데이트
    await business.update({ cue_user_id: cueUser.id }, { transaction });

    await BusinessMember.create({
      business_id: business.id,
      user_id: cueUser.id,
      role: 'ai',
      joined_at: new Date()
    }, { transaction });

    // 5. Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // 6. Save refresh token
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

    // AI 계정(Cue) 로그인 차단
    if (user.is_ai) {
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

    if (!user || user.status !== 'active' || user.is_ai) {
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

// ============================================
// POST /api/auth/switch-workspace { business_id }
// 사용자가 속한 워크스페이스 중 하나로 active 전환.
// 권한: 본인이 멤버 또는 클라이언트로 속한 워크스페이스만 가능.
// 응답: 갱신된 user 객체 (workspaces[] + 새 active 정보 포함)
// ============================================
router.post('/switch-workspace', authenticateToken, async (req, res, next) => {
  try {
    const { business_id } = req.body || {};
    const targetId = Number(business_id);
    if (!targetId || Number.isNaN(targetId)) {
      return errorResponse(res, 'business_id is required', 400);
    }

    // 권한 체크: 멤버 또는 활성 클라이언트
    const isMember = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: targetId } });
    const isClient = isMember ? null : await Client.findOne({
      where: { user_id: req.user.id, business_id: targetId, status: 'active' }
    });
    if (!isMember && !isClient) {
      return errorResponse(res, 'You do not have access to this workspace', 403);
    }

    await User.update({ active_business_id: targetId }, { where: { id: req.user.id } });

    const userData = await getUserWithBusiness(req.user.id);
    successResponse(res, userData);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
