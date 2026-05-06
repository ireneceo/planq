const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessMember, Client } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { sequelize } = require('../config/database');

// refresh_token 은 평문 저장 금지 — DB 유출 시 세션 탈취 위험.
// SHA-256 해시만 저장 + 클라이언트엔 raw 를 쿠키로 전달.
const hashRefreshToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

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

  // 1) 멤버십 (owner / member) — name/name_localized 도 가져와서 워크스페이스별 표시명 fallback 으로
  const memberships = await BusinessMember.findAll({
    where: { user_id: userId },
    attributes: ['business_id', 'role', 'name', 'name_localized', 'removed_at'],
    include: [{ model: Business, attributes: ['id', 'name', 'slug', 'plan', 'brand_name', 'brand_logo_url', 'timezone', 'reference_timezones'] }]
  });

  // 2) 고객 (client) — 활성 상태만. display_name 도 가져와 표시명 fallback
  const clientRows = await Client.findAll({
    where: { user_id: userId, status: 'active' },
    attributes: ['id', 'business_id', 'display_name', 'display_name_localized'],
    include: [{ model: Business, attributes: ['id', 'name', 'slug', 'plan', 'brand_name', 'brand_logo_url', 'timezone', 'reference_timezones'] }]
  });

  // 3) workspaces 배열 빌드 — 같은 business 에 둘 다 있으면 멤버십 우선
  const map = new Map();
  for (const m of memberships) {
    if (!m.Business) continue;
    map.set(m.business_id, {
      business_id: m.business_id,
      brand_name: m.Business.brand_name || m.Business.name,
      brand_logo_url: m.Business.brand_logo_url || null,
      slug: m.Business.slug,
      plan: m.Business.plan,
      role: m.role,  // 'owner' | 'member' | 'ai'
      timezone: m.Business.timezone || 'Asia/Seoul',
      reference_timezones: Array.isArray(m.Business.reference_timezones) ? m.Business.reference_timezones : [],
      // 워크스페이스별 표시명 (메모 project_account_workspace_profile_split)
      member_name: m.name || null,
      member_name_localized: m.name_localized || null,
    });
  }
  for (const c of clientRows) {
    if (!c.Business) continue;
    if (!map.has(c.business_id)) {
      map.set(c.business_id, {
        business_id: c.business_id,
        brand_name: c.Business.brand_name || c.Business.name,
        brand_logo_url: c.Business.brand_logo_url || null,
        slug: c.Business.slug,
        plan: c.Business.plan,
        role: 'client',
        timezone: c.Business.timezone || 'Asia/Seoul',
        reference_timezones: Array.isArray(c.Business.reference_timezones) ? c.Business.reference_timezones : [],
        // Client 의 워크스페이스 표시명
        member_name: c.display_name || null,
        member_name_localized: c.display_name_localized || null,
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
    userData.workspace_timezone = activeWs.timezone;
    userData.workspace_reference_timezones = activeWs.reference_timezones || [];
    // 워크스페이스 컨텍스트의 표시명 — 사이드바 등 UI 가 active workspace 의 이름을 보여주도록.
    // 메모 project_account_workspace_profile_split: 계정 (User.name) vs 워크스페이스 (BusinessMember.name) 분리.
    userData.display_name = activeWs.member_name || user.name;
    userData.display_name_localized = activeWs.member_name_localized || user.name_localized || null;
  } else {
    userData.business_id = null;
    userData.business_name = null;
    userData.business_role = null;
    userData.display_name = user.name;
    userData.display_name_localized = user.name_localized || null;
    userData.workspace_timezone = null;
    userData.workspace_reference_timezones = [];
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
      username,
      // 신규: 워크스페이스 이름(브랜드) — 레거시 호환 위해 business_name 도 허용
      workspace_name,
      business_name,
      brand_name_en,
      default_language,
      // 약관 동의 (필수, 2026-05-05)
      terms_accepted,
      privacy_accepted,
    } = req.body;

    const brandName = workspace_name || business_name;
    const lang = default_language === 'en' ? 'en' : 'ko';

    // Validation
    if (!email || !password || !name || !brandName) {
      await transaction.rollback();
      return errorResponse(res, 'Email, password, name, and workspace name are required', 400);
    }
    // 약관 동의 필수 — 한국 개인정보보호법 + GDPR 명시 동의
    if (!terms_accepted || !privacy_accepted) {
      await transaction.rollback();
      return errorResponse(res, 'terms_and_privacy_required', 400);
    }

    // username 검증 (선택 — 안 주면 이메일 prefix 로 자동 생성, 충돌 시 _2, _3... )
    const RESERVED_USERNAMES = new Set([
      'admin', 'administrator', 'root', 'system', 'support', 'help', 'api',
      'planq', 'cue', 'null', 'undefined', 'me', 'profile', 'settings',
    ]);
    let finalUsername = null;
    if (username !== undefined && username !== null && username !== '') {
      const u = String(username).toLowerCase().trim();
      if (!/^[a-z0-9_-]{3,30}$/.test(u)) {
        await transaction.rollback();
        return errorResponse(res, 'invalid_username_format', 400);
      }
      if (RESERVED_USERNAMES.has(u)) {
        await transaction.rollback();
        return errorResponse(res, 'username_reserved', 409);
      }
      const dup = await User.findOne({ where: { username: u }, transaction });
      if (dup) {
        await transaction.rollback();
        return errorResponse(res, 'username_taken', 409);
      }
      finalUsername = u;
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
    // username 미입력 시 이메일 prefix 로 자동 생성 (충돌 시 _2, _3 ...)
    if (!finalUsername) {
      const base = String(email).split('@')[0]
        .toLowerCase().replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || `user_${Date.now()}`;
      let candidate = base.length >= 3 ? base : (base + '___').slice(0, 3);
      let n = 1;
      while (n < 100) {
        const exists = await User.findOne({ where: { username: candidate }, transaction });
        if (!exists) { finalUsername = candidate; break; }
        n += 1;
        const suffix = `_${n}`;
        candidate = base.slice(0, 30 - suffix.length) + suffix;
      }
    }

    const password_hash = await bcrypt.hash(password, 12);
    // 약관 버전 — platform_settings 의 현재 버전 기록
    let termsVersion = '1.0';
    let privacyVersion = '1.0';
    try {
      const { PlatformSetting } = require('../models');
      const ps = await PlatformSetting.findOne({ order: [['id', 'ASC']], transaction });
      if (ps) {
        termsVersion = ps.terms_version || '1.0';
        privacyVersion = ps.privacy_version || '1.0';
      }
    } catch { /* fallback default */ }
    // 회원가입 이메일 인증 토큰 (raw 는 메일에만, DB 는 sha256 hash)
    const crypto = require('crypto');
    const verifyTokenRaw = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(verifyTokenRaw).digest('hex');
    const verifyExpires = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h
    const user = await User.create({
      email, password_hash, name, username: finalUsername, language: lang, is_ai: false,
      terms_accepted_at: new Date(),
      terms_version: termsVersion,
      privacy_accepted_at: new Date(),
      privacy_version: privacyVersion,
      email_verify_token: verifyTokenHash,
      email_verify_expires: verifyExpires,
    }, { transaction });

    // 2. Create Business (워크스페이스)
    // 신규 가입 = Starter 14일 trial 자동 부여 (2026-05-05). Free 플랜 폐지.
    const TRIAL_DAYS = 14;
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const slug = generateSlug(brandName);
    const business = await Business.create({
      name: brandName,                // legacy 호환
      brand_name: brandName,
      brand_name_en: lang === 'ko' ? (brand_name_en || null) : null,
      slug,
      owner_id: user.id,
      default_language: lang,
      cue_mode: 'smart',
      cue_paused: false,
      plan: 'starter',
      subscription_status: 'trialing',
      trial_ends_at: trialEndsAt,
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

    // 6. Save refresh token (해시만 DB 저장, raw 는 클라이언트 쿠키)
    await user.update({ refresh_token: hashRefreshToken(refreshToken) }, { transaction });

    await transaction.commit();

    // 6. Set refresh token as HttpOnly cookie
    // remember=true (default, 기존 동작): 7일 persistent cookie — 브라우저 닫아도 유지
    // remember=false (사용자 명시 OFF): session cookie — 브라우저 닫으면 자동 로그아웃 (공용 PC 안전)
    const remember = req.body?.remember !== false;
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
    };
    if (remember) cookieOpts.maxAge = 7 * 24 * 60 * 60 * 1000;
    res.cookie('refresh_token', refreshToken, cookieOpts);

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

    // 플랫폼 관리자 알림 + 회원가입 이메일 인증 메일 — fan-out 비동기 (응답 지연 X)
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      notifyPlatformAdmins({
        eventKind: 'signup',
        title: `신규 가입 — ${business.brand_name || business.name}`,
        body: `${user.name} (${user.email}) 가 워크스페이스 "${business.brand_name || business.name}" 으로 가입했습니다.`,
        link: `${APP_URL}/admin/businesses?id=${business.id}`,
        ctaLabel: '워크스페이스 보기',
        relatedEntityId: business.id,
      }).catch(() => null);
      // 신규 가입자에게 이메일 인증 메일 자동 발송
      const emailService = require('../services/emailService');
      emailService.sendSignupVerifyEmail({
        to: user.email,
        name: user.name,
        verifyToken: verifyTokenRaw,
        ttlHours: 72,
      }).catch(() => null);
    });
  } catch (error) {
    await transaction.rollback();
    // Race: 두 요청이 동시에 같은 email/username 으로 가입 시도 시 UNIQUE constraint 발동.
    // findOne 검증을 통과해도 DB 레벨에서 마지막 1건만 살고 나머지는 여기서 catch.
    if (error?.name === 'SequelizeUniqueConstraintError') {
      const fields = error.errors?.map((e) => e.path) || [];
      if (fields.includes('email')) return errorResponse(res, 'Email already registered', 409);
      if (fields.includes('username')) return errorResponse(res, 'username_taken', 409);
      if (fields.includes('slug')) return errorResponse(res, 'workspace_slug_taken', 409);
      return errorResponse(res, 'duplicate_constraint', 409);
    }
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

    // Save refresh token (해시만 DB 저장) + last_login_at
    await user.update({
      refresh_token: hashRefreshToken(refreshToken),
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

    // Find user with matching refresh token (해시 비교)
    const user = await User.findOne({
      where: { id: decoded.userId, refresh_token: hashRefreshToken(refreshToken) }
    });

    if (!user || user.status !== 'active' || user.is_ai) {
      return errorResponse(res, 'Invalid refresh token', 401);
    }

    // Rotate: generate new tokens
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    await user.update({ refresh_token: hashRefreshToken(newRefreshToken) });

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

    // Clear cookie — path 정합성 (과거 path='/' 또는 다른 path 로 발급된 쿠키 잔존 방지)
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.clearCookie('refresh_token', { path: '/' });

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
    // 공지 배너 + 약관 버전 같이 (사이드바 / 약관 재동의 모달용)
    try {
      const { PlatformSetting } = require('../models');
      const ps = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
      if (ps) {
        userData.platform = {
          announcement_text: ps.announcement_text || null,
          announcement_dismissible: !!ps.announcement_dismissible,
          announcement_severity: ps.announcement_severity || 'info',
          current_terms_version: ps.terms_version || '1.0',
          current_privacy_version: ps.privacy_version || '1.0',
        };
      }
    } catch { /* skip */ }
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

// ============================================
// POST /api/auth/forgot-password
// ============================================
// 이메일 받아서 reset_token 발급 + 메일. 보안: 이메일 존재 여부 누설 X (항상 200).
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') return errorResponse(res, 'email_required', 400);
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ where: { email: cleanEmail } });
    // 이메일 존재 여부 누설 방지 — 무조건 200 + 동일 메시지
    if (user && user.status === 'active') {
      const crypto = require('crypto');
      const tokenRaw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1시간
      await user.update({
        password_reset_token: tokenHash,
        password_reset_expires: expires,
      });
      const emailService = require('../services/emailService');
      emailService.sendPasswordResetEmail({
        to: user.email, name: user.name, resetToken: tokenRaw, ttlMinutes: 60,
      }).catch(() => null);
    }
    return successResponse(res, { sent: true }, '이메일을 발송했습니다. 받은편지함을 확인해주세요. (메일이 안 오면 입력한 이메일이 가입돼있지 않을 수 있습니다.)');
  } catch (err) { next(err); }
});

// ============================================
// POST /api/auth/reset-password
// ============================================
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return errorResponse(res, 'token_and_password_required', 400);
    if (String(password).length < 8) return errorResponse(res, 'password_too_short', 400);
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const user = await User.findOne({
      where: {
        password_reset_token: tokenHash,
        password_reset_expires: { [require('sequelize').Op.gt]: new Date() },
      },
    });
    if (!user) return errorResponse(res, 'invalid_or_expired_token', 400);
    const password_hash = await bcrypt.hash(password, 12);
    await user.update({
      password_hash,
      password_reset_token: null,
      password_reset_expires: null,
    });
    return successResponse(res, { reset: true }, 'password_reset_success');
  } catch (err) { next(err); }
});

// ============================================
// POST /api/auth/verify-email-confirm
// ============================================
router.post('/verify-email-confirm', async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) return errorResponse(res, 'token_required', 400);
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const user = await User.findOne({
      where: {
        email_verify_token: tokenHash,
        email_verify_expires: { [require('sequelize').Op.gt]: new Date() },
      },
    });
    if (!user) return errorResponse(res, 'invalid_or_expired_token', 400);
    await user.update({
      email_verified_at: new Date(),
      email_verify_token: null,
      email_verify_expires: null,
    });
    return successResponse(res, { verified: true, email: user.email }, 'email_verified');
  } catch (err) { next(err); }
});

// ============================================
// POST /api/auth/resend-verify-email
// ============================================
router.post('/resend-verify-email', authenticateToken, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return errorResponse(res, 'user_not_found', 404);
    if (user.email_verified_at) return successResponse(res, { already_verified: true });
    const crypto = require('crypto');
    const tokenRaw = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000);
    await user.update({ email_verify_token: tokenHash, email_verify_expires: expires });
    const emailService = require('../services/emailService');
    emailService.sendSignupVerifyEmail({
      to: user.email, name: user.name, verifyToken: tokenRaw, ttlHours: 72,
    }).catch(() => null);
    return successResponse(res, { sent: true });
  } catch (err) { next(err); }
});

module.exports = router;
