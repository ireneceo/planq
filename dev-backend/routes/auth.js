const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessMember, Client, RefreshToken } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { sequelize } = require('../config/database');

// 세션 토큰·쿠키 정책은 services/authTokens 단일 원천 (라우팅 ≠ 세션 정책).
//   auth_oauth.js 도 같은 규칙을 쓴다 — 두 벌로 두면 반드시 어긋난다.
const {
  hashRefreshToken, TTL_MS_BY_KIND, resolveClientKind, createRefreshTokenRow,
  generateAccessToken, generateRefreshToken, authWarn,
  SESSION_HINT, setSessionHint, setRefreshCookies, DELIVERY_EPOCH_MS,
} = require('../services/authTokens');

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
    include: [{ model: Business, attributes: ['id', 'name', 'slug', 'plan', 'brand_name', 'brand_logo_url', 'timezone', 'reference_timezones', 'owner_id'] }]
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
      // 운영 #14/#36 — businesses.owner_id 본인이면 BM role 이 'owner' 로 안 박혀있어도 owner 로 표시.
      // 백엔드 getUserScope 와 동일 기준 → 프론트 canEdit(title/description/project 등) 플래그 정합.
      role: (m.Business.owner_id === userId) ? 'owner' : m.role,  // 'owner' | 'admin' | 'member' | 'ai'
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
      // 초대 기반 가입 — 토큰 있으면 워크스페이스 생성 안 함 (초대된 워크스페이스에 고객으로 바로 합류)
      invite_token,
    } = req.body;

    const brandName = workspace_name || business_name;
    const lang = default_language === 'en' ? 'en' : 'ko';

    // 초대 토큰 유효성 — ProjectClient/Client/BusinessMember invite_token 매칭 시 워크스페이스 미생성
    let isInviteSignup = false;
    if (invite_token) {
      const { ProjectClient, Client: ClientM } = require('../models');
      const pc = await ProjectClient.findOne({ where: { invite_token }, attributes: ['id'], transaction });
      const cl = pc ? null : await ClientM.findOne({ where: { invite_token }, attributes: ['id'], transaction });
      const bm = (pc || cl) ? null : await BusinessMember.findOne({ where: { invite_token }, attributes: ['id'], transaction });
      isInviteSignup = !!(pc || cl || bm);
    }

    // Validation — 초대 가입은 워크스페이스명 불필요
    if (!email || !password || !name || (!brandName && !isInviteSignup)) {
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

    // 2. Create Business (워크스페이스) — 초대 가입은 skip (초대된 워크스페이스에 고객으로 합류)
    let business = null;
    let cueUser = null;
    if (!isInviteSignup) {
    // 신규 가입 = Starter 14일 trial 자동 부여 (2026-05-05). Free 플랜 폐지.
    const TRIAL_DAYS = 14;
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const slug = generateSlug(brandName);
    business = await Business.create({
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
    cueUser = await User.create({
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
    } // end if(!isInviteSignup) — 초대 가입은 워크스페이스 미생성
    //  연결(초대 수락)은 가입 직후 프론트가 /invite/:token 로 redirect → 기존 자동수락이 처리.

    // 5. Generate tokens
    // remember=true (default): pwa=365일 / web=30일 persistent cookie — sliding renewal 로 활동 시 자동 연장
    // remember=false (공용 PC OFF): session cookie — 브라우저 닫으면 자동 로그아웃
    //   #244 — remember 를 토큰 발급보다 먼저 읽어 persist claim 에 실어 보낸다 (회전 시 승격 차단).
    const remember = req.body?.remember !== false;
    const clientKind = resolveClientKind(req);
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, clientKind, remember);

    // 6. Save refresh token row (다중 디바이스 세션 — 신규 row, 기존 row 영향 X)
    await createRefreshTokenRow(user, refreshToken, req, transaction, { clientKind });

    await transaction.commit();

    // 6. Set refresh token as HttpOnly cookie
    const secure = process.env.NODE_ENV === 'production';
    const cookieOpts = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' };
    if (remember) cookieOpts.maxAge = TTL_MS_BY_KIND[clientKind];
    res.cookie('refresh_token', refreshToken, cookieOpts);
    setSessionHint(res, { maxAge: cookieOpts.maxAge, secure });

    successResponse(res, {
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platform_role: user.platform_role,
        business_id: business ? business.id : null,
        business_name: business ? business.name : null,
        business_role: business ? 'owner' : null,
      }
    }, 'Registration successful', 201);

    // 플랫폼 관리자 알림 + 회원가입 이메일 인증 메일 — fan-out 비동기 (응답 지연 X)
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('../services/platformNotify');
      // 워크스페이스 생성 가입만 신규-워크스페이스 알림 (초대 가입은 워크스페이스 없음 → skip)
      if (business) {
        notifyPlatformAdmins({
          eventKind: 'signup',
          title: `신규 가입 — ${business.brand_name || business.name}`,
          body: `${user.name} (${user.email}) 가 워크스페이스 "${business.brand_name || business.name}" 으로 가입했습니다.`,
          link: `${APP_URL}/admin/businesses?id=${business.id}`,
          ctaLabel: '워크스페이스 보기',
          relatedEntityId: business.id,
        }).catch(() => null);
      }
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

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return errorResponse(res, 'Invalid email or password', 401);
    }

    // ★ 상태 검사는 비밀번호 검증 뒤에 (enumeration 방지 — Fable 🟠3).
    //   탈퇴 유예 중이면 복구 안내 code 로 구분(프론트가 suspended 와 다르게 "복구하시겠습니까" 표시).
    if (user.status === 'deleted') {
      const pending = user.deletion_scheduled_at && new Date(user.deletion_scheduled_at) > new Date();
      if (pending) {
        return res.status(403).json({
          success: false, message: 'Account pending deletion', code: 'account_deleted_pending',
          recoverable: true, grace_until: user.deletion_scheduled_at,
        });
      }
      return errorResponse(res, 'Account deleted', 403, 'account_deleted');
    }
    if (user.status !== 'active') {
      return errorResponse(res, 'Account suspended', 403, 'account_suspended');
    }

    // Generate tokens
    // remember=true (default): pwa=365일 / web=30일 persistent cookie — sliding renewal
    // remember=false (공용 PC): session cookie — 브라우저 닫으면 자동 로그아웃
    //   #244 — remember 를 발급 전에 읽어 persist claim 으로 실어 보낸다 (회전 시 영구쿠키 승격 차단).
    const remember = req.body?.remember !== false;
    const clientKind = resolveClientKind(req);
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user, clientKind, remember);

    // 다중 디바이스 — 신규 row 추가 (기존 디바이스 row 들 영향 X)
    await createRefreshTokenRow(user, refreshToken, req, null, { clientKind });
    await user.update({ last_login_at: new Date() });

    // Set refresh token as HttpOnly cookie
    const secure = process.env.NODE_ENV === 'production';
    const cookieOpts = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth' };
    if (remember) cookieOpts.maxAge = TTL_MS_BY_KIND[clientKind];
    res.cookie('refresh_token', refreshToken, cookieOpts);
    setSessionHint(res, { maxAge: cookieOpts.maxAge, secure });

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
      // #244 (D3) — 동반 쿠키로 "게스트 부팅"과 "refresh_token 표적 소실"을 갈라 기록한다.
      //   hint=1 인데 refresh_token 이 없다 = 세션이 있어야 정상인데 사라졌다 → 진짜 사고.
      //   hint 도 없다 = jar 전체 삭제 또는 그냥 게스트/크롤러 → 정상일 수 있음(노이즈).
      const hint = req.cookies?.[SESSION_HINT] === '1';
      authWarn(
        'refresh 401 no_cookie session_hint=%s ua=%s ip=%s',
        hint ? 'PRESENT(세션 증발 의심)' : 'absent',
        (req.headers['user-agent'] || '').slice(0, 80), req.ip
      );
      return errorResponse(res, 'Refresh token required', 401, 'no_cookie');
    }

    // 1. JWT 시그니처 / 만료 검증
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (err) {
      authWarn('refresh 401 jwt_invalid name=%s', err.name);
      return errorResponse(res, 'Invalid or expired refresh token', 401, 'jwt_invalid');
    }

    // 2. refresh_tokens row 조회 — token_hash 매칭
    const tokenHash = hashRefreshToken(refreshToken);
    const tokenRow = await RefreshToken.findOne({ where: { token_hash: tokenHash } });

    // 3. row 없음 또는 user_id 불일치 — 위조/탈취 의심
    if (!tokenRow || tokenRow.user_id !== decoded.userId) {
      authWarn('refresh 401 no_row user=%s row_exists=%s', decoded.userId, !!tokenRow);
      return errorResponse(res, 'Invalid refresh token', 401, 'no_row');
    }

    // 4. 이미 revoked — 재사용 시도.
    //    grace window (15분) 내 + 후속 row active → 정상 race (다중 탭 / PWA wake / bfcache) 로 간주.
    //    → 새 access token 만 발급 (cookie 미갱신). 도난 방어 유지하면서 멀쩡한 사용자 강제 logout 회귀 차단.
    //
    //    grace 변경 사이클별:
    //      30s → 5min (N+7, PWA wake-up 흡수)
    //      → 15min (N+17, Chrome bfcache + 14분 idle 후 stale tab 시나리오 실 발생 박제)
    //
    //    [중요 변경 — 사이클 N+17] chain follow 자체 폐지.
    //      이전 동작: revoke grace 밖이면 successor chain 끝까지 따라가 active row 들도 reuse_detected.
    //      문제: 다중 탭 / bfcache / 다른 디바이스 race 가 정상 사용자의 마지막 active token 까지 죽임.
    //            Irene 실 사례 (#1451) — 14분 idle 후 옛 cookie 호출 → chain 따라 active 까지 죽음 → logout.
    //      신 동작: grace 밖이어도 chain 안 따라감. 호출된 stale row 만 audit log 남기고 401.
    //              정상 사용자의 다른 active row 보존 → cookie 살아있는 한 다음 호출은 정상 통과.
    //      도난 trade-off: 도난자가 stale token 으로 한 번 401 받지만 chain 차단 없음.
    //                     PlanQ 의 실제 도난 의심 0건 vs race-induced logout 빈도 vs UX 안정성 trade-off.
    if (tokenRow.revoked_at) {
      const ROTATION_GRACE_MS = 15 * 60 * 1000;  // 5min → 15min
      const revokedAgo = Date.now() - new Date(tokenRow.revoked_at).getTime();

      // ── #244 수령 확인(delivery-confirmation) 회전 ───────────────────────────
      //
      //   사망 기전(운영 실측): 회전은 서버에 커밋됐는데 응답의 Set-Cookie 가 브라우저에
      //   착지하지 못하면 jar 에는 **이미 revoke 된 옛 쿠키**만 남는다. 그 쿠키는 grace 15분이
      //   지나는 순간 영구 401 이 된다. 실제 사망 3건의 경과는 23분/44분/89분 — **전부 창 밖**이었다.
      //   Mac Chrome 은 PWA 창과 탭이 jar 를 공유하므로 한 번 독이 되면 전부 연쇄로 죽는다.
      //
      //   ★ 시간 창을 늘리는 것은 대리 지표를 늘리는 것일 뿐이다.
      //     진짜 질문은 **"클라이언트가 후속 토큰을 실제로 받았는가"** 이고,
      //     그 답은 **후속 row 가 한 번이라도 사용됐는가**(first_used_at)로 알 수 있다.
      //
      //   후속이 **한 번도 안 쓰였다** = 클라이언트가 못 받았다 → 우리 잘못이므로 **치유**한다.
      //     이때 안 쓰인 후속은 폐기(superseded_undelivered)하고 새 토큰을 발급해 fork 를 막는다.
      //   후속이 **이미 쓰였다** = 클라이언트가 받았다 → 옛 것을 내미는 건 정상 race(창 안) 이거나
      //     도난이다 → 창 안이면 옛 동작(access token 만), 창 밖이면 401.
      //
      //   도난 상한: 후속 미사용이어도 revoke 후 72시간이 지나면 치유하지 않는다.
      //     수령 실패는 즉시 다음 요청에서 드러나므로 72h 면 충분히 넉넉하고,
      //     오래 전 유출된 쿠키가 영구 유효해지는 것을 막는다.
      //
      //   ★ 순서가 계약이다 — **grace 창 안(무쓰기 경로)이 먼저**다.
      //     치유를 앞에 두면 같은 쿠키로 들어온 병렬 요청 10발이 전부 쓰기를 시도해
      //     서로의 후속을 폐기하며 경합한다(실측: 200 이 10/10 → 5/10 으로 붕괴).
      //     in-flight race 는 옛 grace 경로가 쓰기 없이 흡수하고,
      //     치유는 **창을 넘긴 진짜 독(poison) 상태**에서만 발동한다.
      const DELIVERY_HEAL_MAX_MS = 72 * 60 * 60 * 1000;
      if (tokenRow.revoked_reason === 'rotated' && tokenRow.replaced_by_id
        && revokedAgo >= ROTATION_GRACE_MS && revokedAgo < DELIVERY_HEAL_MAX_MS) {
        const succ = await RefreshToken.findByPk(tokenRow.replaced_by_id);
        // first_used_at 이 NULL 이고 succ 가 아직 살아있을 때만 = "못 받은 것이 확실"
        //   ★ 배포 직후 옛 row 는 전부 first_used_at=NULL 이다. 그래서 `succ.created_at` 이
        //     컬럼 도입 이전이면 판단 근거가 없다고 보고 이 경로를 타지 않는다(옛 시간 grace 로 폴백).
        //   ★ `succ.created_at` 로 읽으면 안 된다 — 이 모델은 underscored 라 **인스턴스 속성은
        //     `createdAt`** 이다. `created_at` 은 undefined → NaN 비교 → 가드가 **항상 거짓**이 되어
        //     치유 경로가 통째로 죽는다(이 저장소의 알려진 ORM 표면 함정).
        const succCreatedMs = new Date(succ && (succ.createdAt || succ.created_at) || 0).getTime();
        const succUnused = succ && !succ.revoked_at && !succ.first_used_at
          && succCreatedMs >= DELIVERY_EPOCH_MS;
        if (succUnused) {
          const user = await User.findByPk(tokenRow.user_id);
          if (user && user.status === 'active' && !user.is_ai) {
            const persist = decoded.persist !== false;
            const inheritKind = tokenRow.client_kind || 'web';
            const accessTok = generateAccessToken(user);
            const healToken = generateRefreshToken(user, inheritKind, persist);
            const healRow = await createRefreshTokenRow(user, healToken, req, null, { clientKind: inheritKind });
            // 미수령 후속은 폐기 — 놔두면 회전마다 체인이 갈라져 활성 row 가 무한 증식한다.
            await succ.update({ revoked_at: new Date(), revoked_reason: 'superseded_undelivered', replaced_by_id: healRow.id });
            await tokenRow.update({ replaced_by_id: healRow.id });
            setRefreshCookies(res, healToken, healRow, persist);
            authWarn(
              'refresh delivery_heal user=%d stale_row=%d undelivered_row=%d new_row=%d revoked_ago_min=%d kind=%s',
              user.id, tokenRow.id, succ.id, healRow.id, Math.round(revokedAgo / 60000), inheritKind
            );
            const userData = await getUserWithBusiness(user.id);
            return successResponse(res, { token: accessTok, user: userData });
          }
        }
      }

      if (
        tokenRow.revoked_reason === 'rotated' &&
        tokenRow.replaced_by_id &&
        revokedAgo < ROTATION_GRACE_MS
      ) {
        const successor = await RefreshToken.findByPk(tokenRow.replaced_by_id);
        if (successor && !successor.revoked_at) {
          const user = await User.findByPk(tokenRow.user_id);
          if (user && user.status === 'active' && !user.is_ai) {
            // ── #244 (D2) grace 창 쿠키 자가치유 ──────────────────────────────
            //
            //   왜: 여기 도달했다는 건 브라우저가 **이미 회전된 옛 쿠키**를 아직 들고 있다는 뜻이다
            //   (회전 응답의 Set-Cookie 유실 — 응답 중단·탭 종료·경합). 종전 동작은 access token 만
            //   주고 쿠키를 고쳐주지 않아, 그 쿠키는 grace 15분이 지나는 순간 **영구히 401** 이 됐다.
            //   → 사용자는 아무 잘못 없이 강제 로그아웃. 누적 stale_reuse 267건이 그 흔적이다.
            //   서버는 raw 토큰을 해시로만 보관하므로 후속 토큰을 다시 내려줄 수 없다 →
            //   **새 토큰을 발급해 쿠키를 고쳐주는 것이 유일한 치유법**이다.
            //
            //   캡: stale row 당 1회. 도난된 stale 쿠키 하나로 365일 체인을 반복 분기시키는 것을 막는다.
            //   2회차부터는 종전 동작(access token 만, 쿠키 미갱신)으로 폴백 — 무회귀.
            const persist = decoded.persist !== false;
            const accessTok = generateAccessToken(user);
            const userData = await getUserWithBusiness(user.id);

            if (!tokenRow.grace_successor_id) {
              const inheritKind = tokenRow.client_kind || 'web';
              const healToken = generateRefreshToken(user, inheritKind, persist);
              const healRow = await createRefreshTokenRow(user, healToken, req, null, { clientKind: inheritKind });
              await tokenRow.update({ grace_successor_id: healRow.id });
              setRefreshCookies(res, healToken, healRow, persist);
              authWarn(
                'refresh grace_reissue user=%d stale_row=%d new_row=%d revoked_ago_s=%d kind=%s',
                user.id, tokenRow.id, healRow.id, Math.round(revokedAgo / 1000), inheritKind
              );
            } else {
              // 캡 발동 — 이미 이 stale row 로 한 번 치유했다. 종전 동작 유지.
              authWarn(
                'refresh grace_cap user=%d stale_row=%d already_reissued_row=%d',
                user.id, tokenRow.id, tokenRow.grace_successor_id
              );
            }
            return successResponse(res, { token: accessTok, user: userData });
          }
        }
      }
      // grace 밖 — audit log 만 (chain follow 폐지)
      authWarn(
        'refresh 401 stale_reuse user=%d row=%d revoked_ago_min=%d reason=%s',
        tokenRow.user_id, tokenRow.id, Math.round(revokedAgo / 60000), tokenRow.revoked_reason
      );
      return errorResponse(res, 'Refresh token reuse detected', 401, 'stale_reuse');
    }

    // 5. 만료
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      await tokenRow.update({ revoked_at: new Date(), revoked_reason: 'expired' });
      return errorResponse(res, 'Expired refresh token', 401, 'expired');
    }

    // 6. user 검증
    const user = await User.findByPk(tokenRow.user_id);
    if (!user || user.status !== 'active' || user.is_ai) {
      return errorResponse(res, 'Invalid user', 401, 'invalid_user');
    }

    // 7. Rotate — 옛 row revoke (rotated) + 새 row 생성 + 새 cookie
    //    옛 row 의 replaced_by_id 에 새 row id 저장 (다중 탭 race 흡수에 사용)
    //    client_kind 는 옛 row 그대로 따라감 (PWA 모바일은 365일 유지, 데스크탑은 30일).
    //    sliding renewal — createRefreshTokenRow 가 NOW + TTL_MS_BY_KIND[kind] 로 새 만료 갱신.
    //    persist 는 최초 로그인의 remember 를 그대로 승계 (#244 — 세션쿠키가 영구쿠키로 승격되던 것 차단).
    // #244 — **수령 확인 기록**. 이 토큰이 클라이언트에 실제로 도달했다는 유일한 증거다.
    //   최초 1회만 쓴다(이후 회전마다 UPDATE 하지 않는다 — 쓰기 증폭 방지).
    if (!tokenRow.first_used_at) await tokenRow.update({ first_used_at: new Date() });

    const inheritKind = tokenRow.client_kind || 'web';
    const persist = decoded.persist !== false;
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user, inheritKind, persist);

    const successorRow = await createRefreshTokenRow(user, newRefreshToken, req, null, { clientKind: inheritKind });
    await tokenRow.update({
      revoked_at: new Date(),
      revoked_reason: 'rotated',
      replaced_by_id: successorRow.id,
    });

    // Rolling renewal — DB 새 row 의 expires_at 과 cookie maxAge 를 동기화.
    // 회귀 fix: 이전엔 옛 row.expires_at 기준이라 DB(매번 새로 갱신)와 cookie(점진 감소)가
    // 불일치 → 만료 전인데도 cookie 가 먼저 사라져 자주 로그아웃. 새 row 의 만료시각으로 통일.
    setRefreshCookies(res, newRefreshToken, successorRow, persist);

    const userData = await getUserWithBusiness(user.id);
    successResponse(res, { token: newAccessToken, user: userData });
  } catch (error) {
    next(error);
  }
});

// ============================================
// POST /api/auth/session-diag  — #244 (D3) 세션 종결 비콘
// ============================================
//
//   왜 필요한가: #244 조사에서 서버 로그만으로는 "쿠키가 사라졌다"까지밖에 못 갔다. 무엇이
//   지웠는지, 그 순간 클라이언트가 어떤 상태였는지를 알 방법이 전혀 없었다. 다음 재발 때는
//   원인이 바로 특정되도록, 세션이 끝나는 그 시점의 클라이언트 상태를 한 줄 남긴다.
//
//   인증을 요구하지 않는다 — 세션이 끝났다는 사실 자체가 이 요청의 내용이다.
//   부작용이 없고(로그만) 비용 라우트도 아니지만, 로그 폭주는 그 자체가 사고이므로
//   IP 당 60초 1건으로 조인다. 본문은 화이트리스트 필드만, 길이도 잘라서 받는다.
const diagSeen = new Map();   // ip → 마지막 수신 ms
function diagThrottled(ip) {
  const now = Date.now();
  const last = diagSeen.get(ip) || 0;
  if (now - last < 60 * 1000) return true;
  diagSeen.set(ip, now);
  if (diagSeen.size > 500) {  // 무한 증식 방지 — 오래된 항목 정리
    for (const [k, t] of diagSeen) if (now - t > 10 * 60 * 1000) diagSeen.delete(k);
  }
  return false;
}
const trunc = (v, n) => String(v == null ? '' : v).slice(0, n);

router.post('/session-diag', (req, res) => {
  try {
    if (diagThrottled(req.ip)) return successResponse(res, null);
    const hint = req.cookies?.[SESSION_HINT] === '1';
    const hasRefresh = !!req.cookies?.refresh_token;
    authWarn(
      'session_end reason=%s code=%s last_success=%s kind=%s standalone=%s ' +
      'cookies(refresh=%s hint=%s) ua=%s ip=%s',
      // 40 — `api_401_then_refresh_unauthorized` 가 32 에서 잘려 마지막 글자가 사라지고 있었다.
      //   진단 로그에서 사유가 잘리면 grep 집계가 어긋난다.
      trunc(req.body?.reason, 40),
      trunc(req.body?.code, 32),
      trunc(req.body?.last_success_at, 32),
      trunc(req.body?.client_kind, 16),
      req.body?.standalone === true ? 'yes' : 'no',
      hasRefresh, hint,
      (req.headers['user-agent'] || '').slice(0, 80), req.ip
    );
    return successResponse(res, null);
  } catch {
    return successResponse(res, null);   // 진단이 사용자 흐름을 막으면 안 된다
  }
});

// ============================================
// POST /api/auth/logout
// ============================================
router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    let revokedCount = 0;
    if (refreshToken) {
      // 이 디바이스의 row 만 revoke — 다른 디바이스 세션은 유지 (다중 디바이스 핵심 정책)
      const tokenHash = hashRefreshToken(refreshToken);
      const [n] = await RefreshToken.update(
        { revoked_at: new Date(), revoked_reason: 'logout' },
        { where: { token_hash: tokenHash, revoked_at: null } }
      );
      revokedCount = n || 0;
    }

    // #244 관측 — **이 라우트가 쿠키를 지우는 유일한 서버 경로인데 호출 기록이 없었다.**
    //   그래서 `no_cookie` 로 세션이 끝났을 때 "브라우저가 쿠키를 버린 것" 인지
    //   "누군가 로그아웃을 호출한 것" 인지 가릴 수단이 아예 없었다. 사실을 남긴다.
    authWarn(
      'logout called had_cookie=%s revoked=%d ua=%s ip=%s',
      refreshToken ? 'yes' : 'no', revokedCount,
      (req.headers['user-agent'] || '').slice(0, 80), req.ip
    );

    // Clear cookie — path 정합성 (과거 path='/' 또는 다른 path 로 발급된 쿠키 잔존 방지)
    res.clearCookie('refresh_token', { path: '/api/auth' });
    res.clearCookie('refresh_token', { path: '/' });
    // 동반 힌트도 같이 — 안 지우면 정상 로그아웃이 "세션 증발"로 오탐 기록된다 (#244 D3).
    res.clearCookie(SESSION_HINT, { path: '/' });

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

// 계정 탈퇴 유예 중 복구 — 공개 라우트 (deleted 는 토큰을 못 얻으므로 인증 불가, Fable 🔴2).
//   이메일+비밀번호 재인증 → status='active' + membership/워크스페이스 원복. login 과 동일 rate-limit(security.js).
router.post('/deletion-recover', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return errorResponse(res, 'email_password_required', 400);
    const user = await User.findOne({ where: { email: String(email).toLowerCase().trim() } });
    // 존재/상태 노출 최소화 — 일관된 실패 메시지
    const fail = () => errorResponse(res, 'Cannot recover this account', 403, 'recover_failed');
    if (!user || user.is_ai || user.status !== 'deleted') return fail();
    const pending = user.deletion_scheduled_at && new Date(user.deletion_scheduled_at) > new Date();
    if (!pending) return fail(); // 유예 만료(익명화됨) → 복구 불가
    const isOauthOnly = user.password_hash && user.password_hash.startsWith('$2a$12$oauth_no_password_set');
    if (isOauthOnly) return errorResponse(res, 'oauth_otp_required', 400, 'oauth_otp_required');
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return fail();

    const { sequelize } = require('../config/database');
    const { BusinessMember, Business } = require('../models');
    const requestedAt = user.deletion_requested_at;
    const t = await sequelize.transaction();
    try {
      await user.update({ status: 'active', deletion_requested_at: null, deletion_scheduled_at: null }, { transaction: t });
      // 이 탈퇴로 removed 된 membership 만 원복 (🔴B — removed_reason 마커로 구분)
      await BusinessMember.update(
        { removed_at: null, removed_by: null, removed_reason: null },
        { where: { user_id: user.id, removed_reason: 'account_deletion', removed_at: requestedAt ? { [require('sequelize').Op.gte]: requestedAt } : { [require('sequelize').Op.ne]: null } }, transaction: t });
      // 동반 삭제됐던 솔로 워크스페이스 복원 (내가 owner + deleted_at >= 요청시각)
      //   + 그 워크스페이스의 Cue 계정도 active 복원 (request 가 deleted 마크했으므로 — 🟠1).
      if (requestedAt) {
        const restoredWs = await Business.findAll({
          where: { owner_id: user.id, deleted_at: { [require('sequelize').Op.gte]: requestedAt } },
          attributes: ['cue_user_id'], transaction: t,
        });
        await Business.update({ deleted_at: null },
          { where: { owner_id: user.id, deleted_at: { [require('sequelize').Op.gte]: requestedAt } }, transaction: t });
        const cueIds = restoredWs.map((b) => b.cue_user_id).filter(Boolean);
        if (cueIds.length) {
          const { User: UserModel } = require('../models');
          await UserModel.update({ status: 'active' },
            { where: { id: { [require('sequelize').Op.in]: cueIds }, is_ai: true }, transaction: t });
        }
      }
      await t.commit();
    } catch (e) { await t.rollback().catch(() => {}); throw e; }

    require('../services/auditService').logAudit(req, {
      action: 'user.deletion_recover', targetType: 'user', targetId: user.id, newValue: { recovered: true },
    });
    return successResponse(res, { recovered: true });
  } catch (err) { next(err); }
});

module.exports = router;
// N+70 — auth_oauth.js 에서 재사용 (OAuth callback 도 같은 refresh_token cookie 패턴)
module.exports.helpers = {
  createRefreshTokenRow,
  generateAccessToken,
  generateRefreshToken,
  resolveClientKind,
  TTL_MS_BY_KIND,
  // #244 — 동반 세션 힌트 쿠키. OAuth 로그인도 같은 한 벌을 내려야
  //   "세션이 있어야 정상인데 refresh_token 만 사라졌다"는 판정이 성립한다.
  setSessionHint,
  SESSION_HINT,
};
