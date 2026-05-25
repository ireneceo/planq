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
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const googleOauthLogin = require('../services/google_oauth_login');

const APP_BASE = process.env.APP_BASE_URL || 'https://dev.planq.kr';

function generateJwt(user, clientKind = 'web') {
  const ttl = clientKind === 'pwa' ? '365d' : '15m';
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ttl }
  );
}

// CSP 정합 — inline script 금지. token 은 URL fragment 로 전달 (referrer 노출 X, server-side log 안 보임).
// frontend /oauth/callback route 가 hash 파싱 + localStorage 저장 + redirect.
function buildRedirectTarget({ ok, token, error, isNewUser }) {
  if (!ok) {
    const safeErr = encodeURIComponent(error || 'unknown_error');
    return `/login?oauth_error=${safeErr}`;
  }
  const safeToken = token || '';
  const next = isNewUser ? 'onboarding' : 'inbox';
  return `/oauth/callback#token=${encodeURIComponent(safeToken)}&next=${next}`;
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

    const token = generateJwt(user);
    return res.redirect(302, buildRedirectTarget({ ok: true, token, isNewUser }));
  } catch (e) {
    console.error('[auth_oauth/google/callback]', e);
    return res.redirect(302, buildRedirectTarget({ ok: false, error: e.message || 'oauth_failed' }));
  }
});

module.exports = router;
