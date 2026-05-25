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

// HTML callback 응답 — frontend 가 JWT 저장 + dashboard redirect
function buildLoginCallbackHtml({ ok, token, error, isNewUser }) {
  const safeToken = token ? token.replace(/[^A-Za-z0-9._-]/g, '') : '';
  const safeError = error ? String(error).replace(/[<>&"']/g, '') : '';
  const target = isNewUser ? '/onboarding' : '/inbox';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>PlanQ 로그인</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #F8FAFC; color: #0F172A; margin: 0; padding: 40px 20px;
    display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #FFFFFF; padding: 32px 28px; border-radius: 14px; max-width: 420px; width: 100%;
    box-shadow: 0 8px 32px rgba(15,23,42,0.08); text-align: center; }
  h2 { margin: 0 0 12px; font-size: 18px; font-weight: 700; }
  p { font-size: 13px; color: #64748B; line-height: 1.6; margin: 0 0 16px; }
  .spinner { width: 32px; height: 32px; border: 3px solid #E2E8F0; border-top-color: #14B8A6;
    border-radius: 50%; animation: spin 0.8s linear infinite; margin: 12px auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .err { color: #B91C1C; }
  .btn { display: inline-block; padding: 10px 18px; background: #14B8A6; color: #FFFFFF;
    border: none; border-radius: 8px; font-weight: 600; text-decoration: none; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
  ${ok ? `
    <h2>PlanQ 로그인 완료</h2>
    <div class="spinner"></div>
    <p>잠시만 기다려주세요...</p>
    <script>
      try {
        localStorage.setItem('planq_token', '${safeToken}');
        // refresh token 은 backend cookie 로 set 됨 (옵션) — 지금은 access only
        window.location.replace('${target}');
      } catch (e) {
        document.querySelector('.card').innerHTML = '<h2 class="err">저장 실패</h2><p>브라우저 저장소를 확인하세요</p><a class="btn" href="/login">로그인 페이지로</a>';
      }
    </script>
  ` : `
    <h2 class="err">로그인 실패</h2>
    <p>${safeError || '알 수 없는 오류'}</p>
    <a class="btn" href="/login">로그인 페이지로</a>
  `}
</div>
</body>
</html>`;
}

// 1. Google OAuth 시작
router.get('/google/initiate', (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).send(buildLoginCallbackHtml({ ok: false, error: 'GOOGLE_CLIENT_ID 환경변수 미설정' }));
    }
    const { url } = googleOauthLogin.buildAuthUrl();
    return res.redirect(302, url);
  } catch (e) {
    return res.status(500).send(buildLoginCallbackHtml({ ok: false, error: e.message }));
  }
});

// 2. Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      return res.status(400).send(buildLoginCallbackHtml({ ok: false, error: `Google 에서 거부됨: ${oauthError}` }));
    }
    if (!code || !state) {
      return res.status(400).send(buildLoginCallbackHtml({ ok: false, error: '잘못된 요청 (code/state 누락)' }));
    }
    if (!googleOauthLogin.consumeState(String(state))) {
      return res.status(400).send(buildLoginCallbackHtml({ ok: false, error: 'state 검증 실패 (만료 또는 위조)' }));
    }

    // 코드 교환 + 프로필 fetch
    const profile = await googleOauthLogin.exchangeCodeForProfile(String(code));
    if (!profile.email_verified) {
      return res.status(400).send(buildLoginCallbackHtml({ ok: false, error: 'Google 이메일이 인증되지 않았습니다' }));
    }

    // User lookup or auto-create
    let user = await User.findOne({ where: { email: profile.email } });
    let isNewUser = false;
    if (!user) {
      // 신규 가입 — Google 프로필 기반
      user = await User.create({
        email: profile.email,
        password_hash: '$2a$12$oauth_no_password_set',  // OAuth only — 비밀번호 직접 로그인 불가
        name: profile.name || profile.email.split('@')[0],
        avatar_url: profile.picture || null,
        language: profile.locale && profile.locale.startsWith('ko') ? 'ko' : 'en',
        email_verified_at: new Date(),                   // Google 가 검증
        platform_role: 'user',
        status: 'active',
        // 약관 동의 — Google OAuth 기본 동의 (정책에 따라 onboarding 에서 명시 동의로 재처리 가능)
        terms_accepted_at: new Date(),
        terms_version: '1.0',
        privacy_accepted_at: new Date(),
        privacy_version: '1.0',
      });
      isNewUser = true;
    } else {
      // 기존 사용자 — 마지막 로그인 + avatar/name 갱신 (없을 때만)
      const patch = { last_login_at: new Date() };
      if (!user.avatar_url && profile.picture) patch.avatar_url = profile.picture;
      if (!user.email_verified_at) patch.email_verified_at = new Date();
      await user.update(patch);
    }

    if (user.status !== 'active') {
      return res.status(403).send(buildLoginCallbackHtml({ ok: false, error: '계정이 정지되었습니다' }));
    }

    const token = generateJwt(user);
    return res.send(buildLoginCallbackHtml({ ok: true, token, isNewUser }));
  } catch (e) {
    console.error('[auth_oauth/google/callback]', e);
    return res.status(500).send(buildLoginCallbackHtml({ ok: false, error: e.message || 'OAuth 처리 실패' }));
  }
});

module.exports = router;
