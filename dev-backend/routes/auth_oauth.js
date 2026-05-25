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
const { User } = require('../models');
const googleOauthLogin = require('../services/google_oauth_login');
// 옛 /login 의 refresh_token cookie 패턴 재사용 (다중 디바이스 + sliding renewal 정합)
const { helpers } = require('./auth');
const { createRefreshTokenRow, generateAccessToken, generateRefreshToken, resolveClientKind, TTL_MS_BY_KIND } = helpers;

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

    let user = await User.findOne({ where: { email: profile.email } });
    let isNewUser = false;
    if (!user) {
      user = await User.create({
        email: profile.email,
        password_hash: '$2a$12$oauth_no_password_set',
        name: profile.name || profile.email.split('@')[0],
        avatar_url: profile.picture || null,
        language: profile.locale && profile.locale.startsWith('ko') ? 'ko' : 'en',
        email_verified_at: new Date(),
        platform_role: 'user',
        status: 'active',
        terms_accepted_at: new Date(),
        terms_version: '1.0',
        privacy_accepted_at: new Date(),
        privacy_version: '1.0',
      });
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

    // refresh_token cookie 발급 (옛 /login 패턴 정합) — AuthContext 가 mount 시 자동 refresh
    await issueSessionCookie(req, res, user);
    return res.redirect(302, buildRedirectTarget({ ok: true, isNewUser }));
  } catch (e) {
    console.error('[auth_oauth/google/callback]', e);
    return res.redirect(302, buildRedirectTarget({ ok: false, error: e.message || 'oauth_failed' }));
  }
});

module.exports = router;
