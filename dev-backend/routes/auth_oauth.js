// routes/auth_oauth.js — PlanQ OAuth 로그인 (Google / Microsoft)
//
// 흐름:
// 1. frontend: "Google 로 계속" 클릭 → /api/auth/google/initiate redirect
// 2. backend: Google OAuth URL 생성 → 302 redirect to accounts.google.com
// 3. 사용자: Google 로그인 + PlanQ 권한 동의
// 4. Google: /api/auth/google/callback?code=...&state=... redirect
// 5. backend: code 교환 → 프로필 fetch → User lookup or auto-create → JWT 발급
// 6. backend: frontend `/oauth/callback?token=...` redirect → frontend 가 JWT 저장 + dashboard
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessMember, OauthConnection, sequelize } = require('../models');
const googleOauthLogin = require('../services/google_oauth_login');
// 옛 /login 의 refresh_token cookie 패턴 재사용 (다중 디바이스 + sliding renewal 정합)
const { helpers } = require('./auth');
const { createRefreshTokenRow, generateAccessToken, generateRefreshToken, resolveClientKind, TTL_MS_BY_KIND } = helpers;

// connect-confirm token 임시 저장 (5분 만료, in-memory)
const confirmStash = new Map();
// 네이티브 OAuth 일회용 code 사용 이력 (jti → exp). 재사용(replay) 차단. 2분 후 정리.
const usedNativeCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of confirmStash.entries()) {
    if (v.exp < now) confirmStash.delete(k);
  }
  for (const [k, exp] of usedNativeCodes.entries()) {
    if (exp < now) usedNativeCodes.delete(k);
  }
}, 30000);

// 네이티브 앱 OAuth: 시스템 브라우저 세션에 로그인해도 세션 쿠키가 앱 WebView 로 전달되지 않음.
//   → callback 에서 일회용 code(2분, jti 단일사용) 발급 → 딥링크로 앱 복귀 → 앱이 WebView 컨텍스트에서
//     /native-exchange 호출 → 그 응답이 refresh cookie 를 앱 WebView 에 심음. (H-2)
function isNativeOAuth(req) {
  return req.cookies && req.cookies.oauth_native === '1';
}
function issueNativeOAuthCode(user) {
  const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return jwt.sign({ uid: user.id, purpose: 'native_oauth', jti }, process.env.JWT_SECRET, { expiresIn: '2m' });
}

// slug 생성 (옛 /register 패턴)
function generateSlug(name) {
  const base = String(name || 'workspace').toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

// OAuth 신규 가입 — 자동 Business + Cue + BusinessMember 생성 (옛 /register 정합)
async function setupNewWorkspace(user, wantsKo, transaction) {
  const lang = wantsKo ? 'ko' : 'en';
  const userName = user.name || user.email.split('@')[0];
  const brandName = wantsKo ? `${userName} 의 워크스페이스` : `${userName}'s Workspace`;
  const TRIAL_DAYS = 14;
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const business = await Business.create({
    name: brandName,
    brand_name: brandName,
    slug: generateSlug(userName),
    owner_id: user.id,
    default_language: lang,
    cue_mode: 'smart',
    cue_paused: false,
    plan: 'starter',
    subscription_status: 'trialing',
    trial_ends_at: trialEndsAt,
  }, { transaction });

  await BusinessMember.create({
    business_id: business.id,
    user_id: user.id,
    role: 'owner',
    joined_at: new Date(),
  }, { transaction });

  // Cue AI 시스템 계정
  const cueRandomHash = await bcrypt.hash(Math.random().toString(36) + Date.now(), 12);
  const cueUser = await User.create({
    email: `cue+${business.id}@system.planq.kr`,
    password_hash: cueRandomHash,
    name: 'Cue',
    avatar_url: '/static/cue.svg',
    is_ai: true,
    platform_role: 'user',
    status: 'active',
    language: lang,
  }, { transaction });

  await business.update({ cue_user_id: cueUser.id }, { transaction });
  await BusinessMember.create({
    business_id: business.id,
    user_id: cueUser.id,
    role: 'ai',
    joined_at: new Date(),
  }, { transaction });

  // active_business_id 설정 — 로그인 후 자동 진입
  await user.update({ active_business_id: business.id }, { transaction });

  return business;
}

// 성공/실패 redirect target (CSP 정합 — inline script X)
function buildRedirectTarget({ ok, error, isNewUser }) {
  if (!ok) {
    const safeErr = encodeURIComponent(error || 'unknown_error');
    return `/login?oauth_error=${safeErr}`;
  }
  // 신규 사용자 → onboarding, 기존 → inbox
  // AuthContext mount 시 tryRefresh() 가 자동 호출되어 refresh_token cookie 로 access token 받음
  return isNewUser ? '/onboarding' : '/inbox';
}

// refresh_token cookie 발급 — 옛 login 라우트와 동일
async function issueSessionCookie(req, res, user) {
  const clientKind = resolveClientKind(req);
  const refreshToken = generateRefreshToken(user, clientKind);
  await createRefreshTokenRow(user, refreshToken, req, null, { clientKind });
  await user.update({ last_login_at: new Date() });
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: TTL_MS_BY_KIND[clientKind],
  };
  res.cookie('refresh_token', refreshToken, cookieOpts);
}

// 1. Google OAuth 시작
router.get('/google/initiate', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'GOOGLE_CLIENT_ID 미설정' }));
    }
    // 네이티브 앱에서 시작 시 표시 — callback 이 code-exchange 딥링크로 분기 (H-2). 시스템 브라우저
    //   세션에 단기 쿠키(같은 브라우저 내 initiate→callback 유지). httpOnly, path=/api/auth.
    if (req.query.client === 'native') {
      res.cookie('oauth_native', '1', {
        httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', path: '/api/auth', maxAge: 10 * 60 * 1000,
      });
    }
    const { url } = googleOauthLogin.buildAuthUrl();
    return res.redirect(302, url);
  } catch (e) {
    return res.redirect(302, buildRedirectTarget({ ok: false, error: e.message }));
  }
});

// 2. Google OAuth callback — CSP 정합 (inline script X, fragment redirect)
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      return res.redirect(302, buildRedirectTarget({ ok: false, error: oauthError }));
    }
    if (!code || !state) {
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'invalid_request' }));
    }
    if (!googleOauthLogin.consumeState(String(state))) {
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'invalid_state' }));
    }

    const profile = await googleOauthLogin.exchangeCodeForProfile(String(code));
    if (!profile.email_verified) {
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'email_not_verified' }));
    }

    const { Op } = require('sequelize');
    // N+70 Task 62 — 3분기 OAuth 흐름 (표준 OAuth Connection 패턴)
    let user = null;
    let isNewUser = false;
    let needsConnectionConfirm = false;
    let prospectUser = null;  // email 매칭 user — 연결 확인 후 attach

    // [분기 1] oauth_connections subject 매칭 → 그 사용자 즉시 로그인
    const existingConn = await OauthConnection.findOne({
      where: { provider: 'google', subject: profile.google_sub },
      include: [{ model: User, attributes: ['id', 'email', 'status'] }],
    });
    if (existingConn && existingConn.User) {
      user = await User.findByPk(existingConn.User.id);
      await existingConn.update({ last_used_at: new Date() });
    } else {
      // [분기 2] email 매칭 (primary or verified secondary) — 연결 확인 페이지로
      prospectUser = await User.findOne({
        where: {
          [Op.or]: [
            { email: profile.email },
            { secondary_email: profile.email, secondary_email_verified_at: { [Op.ne]: null } },
          ],
        },
      });
      if (prospectUser) {
        // 연결 확인 페이지로 redirect — 사용자 명시 동의 필요
        // confirm token 5분 in-memory (간단)
        const confirmToken = require('crypto').randomBytes(24).toString('base64url');
        confirmStash.set(confirmToken, {
          user_id: prospectUser.id,
          provider: 'google',
          subject: profile.google_sub,
          email: profile.email,
          display_name: profile.name,
          picture: profile.picture,
          exp: Date.now() + 5 * 60 * 1000,
        });
        return res.redirect(302, `/oauth/connect-confirm?token=${confirmToken}&email=${encodeURIComponent(profile.email)}&existing_email=${encodeURIComponent(prospectUser.email)}&name=${encodeURIComponent(profile.name || '')}`);
      }
      // [분기 3] 둘 다 없음 → 신규 가입 (기존 로직 그대로)
    }
    // 아래는 분기 1 (existing user) 또는 분기 3 (신규) 흐름 계속
    if (!user) {
      // N+70 hotfix — browser Accept-Language 우선 (Google profile.locale 보다 정확)
      const browserLang = String(req.headers['accept-language'] || '').toLowerCase();
      const wantsKo = browserLang.startsWith('ko') || (profile.locale && profile.locale.startsWith('ko'));
      // Transaction — User + Business + Cue 함께
      const t = await sequelize.transaction();
      try {
        user = await User.create({
          email: profile.email,
          password_hash: '$2a$12$oauth_no_password_set',
          name: profile.name || profile.email.split('@')[0],
          avatar_url: profile.picture || null,
          language: wantsKo ? 'ko' : 'en',
          email_verified_at: new Date(),
          platform_role: 'user',
          status: 'active',
          terms_accepted_at: new Date(),
          terms_version: '1.0',
          privacy_accepted_at: new Date(),
          privacy_version: '1.0',
        }, { transaction: t });
        // 자동 Business + Cue (옛 /register 정합) — 좌측 메뉴 채워짐 + 14일 trial
        await setupNewWorkspace(user, wantsKo, t);
        // OAuth Connection 자동 생성 (subject 박제 — 다음 로그인은 즉시 분기 1)
        await OauthConnection.create({
          user_id: user.id,
          provider: 'google',
          subject: profile.google_sub,
          email: profile.email,
          display_name: profile.name || null,
          picture: profile.picture || null,
          connected_at: new Date(),
          last_used_at: new Date(),
        }, { transaction: t });
        await t.commit();
      } catch (e) {
        await t.rollback();
        throw e;
      }
      isNewUser = true;
    } else {
      const patch = { last_login_at: new Date() };
      if (!user.avatar_url && profile.picture) patch.avatar_url = profile.picture;
      if (!user.email_verified_at) patch.email_verified_at = new Date();
      await user.update(patch);
    }

    if (user.status !== 'active') {
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'account_suspended' }));
    }

    // 네이티브 앱: 시스템 브라우저에 쿠키를 심지 말고, 일회용 code 를 딥링크로 앱에 전달 (H-2).
    if (isNativeOAuth(req)) {
      res.clearCookie('oauth_native', { path: '/api/auth' });
      const code = issueNativeOAuthCode(user);
      return res.redirect(302, `/oauth/native-return?code=${encodeURIComponent(code)}&new=${isNewUser ? '1' : '0'}`);
    }

    // refresh_token cookie 발급 (옛 /login 패턴 정합) — AuthContext 가 mount 시 자동 refresh
    await issueSessionCookie(req, res, user);
    return res.redirect(302, buildRedirectTarget({ ok: true, isNewUser }));
  } catch (e) {
    console.error('[auth_oauth/google/callback]', e);
    return res.redirect(302, buildRedirectTarget({ ok: false, error: e.message || 'oauth_failed' }));
  }
});

// 네이티브 앱 OAuth code 교환 (H-2) — 앱 WebView 가 딥링크로 받은 code 를 세션으로 교환.
//   이 요청은 앱 WebView 에서 오므로 issueSessionCookie 의 refresh cookie 가 WebView 에 심긴다.
//   응답 후 앱은 window.location='/inbox' 로 리로드 → AuthContext bootstrap 이 cookie 로 자동 로그인.
// POST /api/auth/google/native-exchange  { code, client_kind? }
router.post('/google/native-exchange', async (req, res) => {
  try {
    const { code, client_kind } = req.body || {};
    if (!code) return res.status(400).json({ success: false, message: 'code_required' });
    let payload;
    try {
      payload = jwt.verify(String(code), process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'invalid_or_expired_code' });
    }
    if (!payload || payload.purpose !== 'native_oauth' || !payload.uid || !payload.jti) {
      return res.status(401).json({ success: false, message: 'invalid_code' });
    }
    // 단일 사용 — replay 차단.
    if (usedNativeCodes.has(payload.jti)) {
      return res.status(401).json({ success: false, message: 'code_already_used' });
    }
    usedNativeCodes.set(payload.jti, (payload.exp || Math.floor(Date.now() / 1000) + 120) * 1000);

    const user = await User.findByPk(payload.uid);
    if (!user || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'account_unavailable' });
    }
    // client_kind 를 body 로 전달받아 issueSessionCookie(resolveClientKind) 가 ios/android 365일 세션 발급.
    if (client_kind) req.body.client_kind = client_kind;
    await issueSessionCookie(req, res, user);
    return res.json({ success: true, data: { new_user: false } });
  } catch (e) {
    console.error('[auth_oauth/native-exchange]', e);
    return res.status(500).json({ success: false, message: 'exchange_failed' });
  }
});

// ─── N+70 Task 62 — Connect Confirm 흐름 + Settings API ─────────
// 사용자가 옛 계정에 Google OAuth 를 attach 하는 흐름.
// 1. callback 분기 2 에서 redirect 시 token 발급
// 2. frontend /oauth/connect-confirm page 가 token 으로 정보 fetch
// 3. 사용자가 "예 연결" 클릭 → POST /api/auth/google/connect-confirm

// GET /api/auth/google/connect-confirm/info?token=...
router.get('/google/connect-confirm/info', (req, res) => {
  const token = String(req.query.token || '');
  const stash = confirmStash.get(token);
  if (!stash || stash.exp < Date.now()) {
    return res.status(400).json({ success: false, message: 'invalid_or_expired_token' });
  }
  // user lookup
  User.findByPk(stash.user_id, { attributes: ['id', 'email', 'name', 'avatar_url'] }).then(u => {
    if (!u) return res.status(404).json({ success: false, message: 'user_not_found' });
    res.json({
      success: true,
      data: {
        existing_user: { id: u.id, email: u.email, name: u.name, avatar_url: u.avatar_url },
        google: {
          email: stash.email,
          display_name: stash.display_name,
          picture: stash.picture,
        },
      },
    });
  }).catch(e => res.status(500).json({ success: false, message: e.message }));
});

// POST /api/auth/google/connect-confirm  body: { token, action: 'connect' | 'cancel' }
router.post('/google/connect-confirm', async (req, res) => {
  try {
    const { token, action } = req.body || {};
    const stash = confirmStash.get(String(token));
    if (!stash || stash.exp < Date.now()) {
      return res.status(400).json({ success: false, message: 'invalid_or_expired_token' });
    }
    confirmStash.delete(token);
    if (action !== 'connect') {
      return res.json({ success: true, data: { action: 'cancelled' } });
    }
    const user = await User.findByPk(stash.user_id);
    if (!user || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'user_inactive' });
    }
    // OauthConnection 생성 (이미 다른 sub 가 user_id+google 에 있으면 교체)
    const existing = await OauthConnection.findOne({ where: { user_id: user.id, provider: 'google' } });
    if (existing) {
      await existing.update({
        subject: stash.subject,
        email: stash.email,
        display_name: stash.display_name,
        picture: stash.picture,
        last_used_at: new Date(),
      });
    } else {
      await OauthConnection.create({
        user_id: user.id,
        provider: 'google',
        subject: stash.subject,
        email: stash.email,
        display_name: stash.display_name,
        picture: stash.picture,
        connected_at: new Date(),
        last_used_at: new Date(),
      });
    }
    // 즉시 로그인 (refresh_token cookie set)
    await issueSessionCookie(req, res, user);
    res.json({ success: true, data: { action: 'connected', user_id: user.id, next: '/inbox' } });
  } catch (e) {
    console.error('[connect-confirm POST]', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Settings 메뉴 API — 내 연결 list / 추가 / 해제 ─────────
const { authenticateToken } = require('../middleware/auth');

// GET /api/auth/oauth-connections — 본인 연결 list
router.get('/oauth-connections', authenticateToken, async (req, res) => {
  try {
    const rows = await OauthConnection.findAll({
      where: { user_id: req.user.id },
      attributes: ['id', 'provider', 'email', 'display_name', 'picture', 'connected_at', 'last_used_at'],
      order: [['connected_at', 'DESC']],
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST /api/auth/oauth-connections/google/initiate — 로그인된 사용자가 Settings 에서 Google 연결 시작
router.post('/oauth-connections/google/initiate', authenticateToken, (req, res) => {
  // state 에 user_id 추가 — callback 에서 분기 2 거치지 않고 직접 연결
  // 단순화 — 기존 initiate 그대로 사용. callback 시 email 매칭으로 attach.
  // 향후: state encode user_id 로 명시 attach
  const { url } = googleOauthLogin.buildAuthUrl();
  res.json({ success: true, data: { auth_url: url } });
});

// DELETE /api/auth/oauth-connections/:id — 본인 연결 해제
router.delete('/oauth-connections/:id', authenticateToken, async (req, res) => {
  try {
    const conn = await OauthConnection.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!conn) return res.status(404).json({ success: false, message: 'not_found' });
    // 비밀번호 없는 OAuth-only 사용자는 마지막 연결 해제 차단 (lockout 방지)
    const user = await User.findByPk(req.user.id);
    const isOauthOnly = user.password_hash && user.password_hash.startsWith('$2a$12$oauth_no_password_set');
    const remainingCount = await OauthConnection.count({ where: { user_id: req.user.id } });
    if (isOauthOnly && remainingCount <= 1) {
      return res.status(400).json({ success: false, message: 'cannot_remove_last_oauth_method_set_password_first' });
    }
    await conn.destroy();
    res.json({ success: true, data: { disconnected: true } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
