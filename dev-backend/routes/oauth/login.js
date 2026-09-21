// routes/oauth/login.js — 구글 로그인 본류: 시작 · 콜백 · 웹 복귀.
// 라우터를 **새로 만들지 않는다** — auth_oauth.js 가 준 하나에 그대로 등록해
// 등록 순서와 마운트 지점(server.js `/api/auth`)을 분리 전과 동일하게 유지한다.
const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const googleOauthLogin = require('../../services/google_oauth_login');
const { logOauthFailure } = require('../../utils/oauthLog');
const {
  claimNativeCodeOnce, isNativeOAuth, buildRedirectTarget, issueSessionCookie,
} = require('./core');
const { finishOauthLogin, failLogin } = require('./finish');

module.exports = function registerLoginRoutes(router) {
// 1. Google OAuth 시작
router.get('/google/initiate', async (req, res) => {
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
    // 앱이 만든 **흐름 식별자**(비밀 아님)를 state 에 실어 콜백까지 나른다.
    //   ★ 비밀(코드)은 절대 여기로 들어오지 않는다 — 첫 설계가 그렇게 했다가 ATO 가 됐다.
    const pair = typeof req.query.pair === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(req.query.pair)
      ? req.query.pair : null;
    const { url } = await googleOauthLogin.buildAuthUrl(pair);
    return res.redirect(302, url);
  } catch (e) {
    return res.redirect(302, buildRedirectTarget({ ok: false, error: e.message }));
  }
});

// 로그인 실패 착지·3분기는 oauth/finish.js 한 곳이다(애플과 공유 — 2026-09-21).
const failGoogle = (req, res, reason) => failLogin(req, res, reason, { native: isNativeOAuth(req), provider: 'google' });

// 2. Google OAuth callback — CSP 정합 (inline script X, fragment redirect)
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    const logCtx = { ua: String(req.get('user-agent') || '').slice(0, 120), native: isNativeOAuth(req) || undefined };
    if (oauthError) {
      logOauthFailure('auth/google callback', String(oauthError), logCtx);
      return failGoogle(req, res, oauthError);
    }
    if (!code || !state) {
      logOauthFailure('auth/google callback', 'invalid_request', logCtx);
      return failGoogle(req, res, 'invalid_request');
    }
    const stateEntry = await googleOauthLogin.consumeStateEntry(String(state));
    if (!stateEntry) {
      // 대개 ①서버 재시작으로 메모리 state 가 날아갔거나 ②콜백이 두 번 로드됐거나 ③5분 초과.
      logOauthFailure('auth/google callback', 'invalid_state', logCtx);
      return failGoogle(req, res, 'invalid_state');
    }
    const profile = await googleOauthLogin.exchangeCodeForProfile(String(code));
    if (!profile.email_verified) {
      logOauthFailure('auth/google callback', 'email_not_verified', logCtx);
      return failGoogle(req, res, 'email_not_verified');
    }
    return await finishOauthLogin(req, res, {
      provider: 'google',
      profile: {
        subject: profile.google_sub, email: profile.email, name: profile.name,
        picture: profile.picture, locale: profile.locale,
      },
      native: isNativeOAuth(req),
      pairId: stateEntry.challenge,   // state 가 나른 흐름 식별자
      logTag: 'auth/google callback',
    });
  } catch (e) {
    console.error('[auth_oauth/google/callback]', e);
    return failGoogle(req, res, 'oauth_failed');
  }
});

// 네이티브 앱 OAuth code 교환 (H-2) — 앱 WebView 가 딥링크로 받은 code 를 세션으로 교환.
//   이 요청은 앱 WebView 에서 오므로 issueSessionCookie 의 refresh cookie 가 WebView 에 심긴다.
//   응답 후 앱은 window.location='/inbox' 로 리로드 → AuthContext bootstrap 이 cookie 로 자동 로그인.
// POST /api/auth/google/native-exchange  { code, client_kind? }
// GET /api/auth/google/web-return?code=... — **앱이 없을 때의 탈출구**.
//
// ★ 2026-09-06 운영 신고 (Irene, 안드로이드 태블릿): "로그인한 후 앱으로 돌아가기 버튼 누르면
//   웹으로 가서 그냥 dns 에러나와. This site can't be reached."
//   네이티브 복귀 페이지의 탈출구가 `planq://` **하나뿐**이었다. 안드로이드는 아직 Play 심사
//   중이라 설치본이 없고, 스킴 핸들러가 없으면 브라우저가 `planq` 를 호스트로 해석해
//   ERR_NAME_NOT_RESOLVED 를 낸다. **로그인은 서버에서 이미 끝났는데 세션만 못 받는 상태.**
//
// 그래서 같은 일회용 code 를 GET 으로 받아 **브라우저 세션을 심고** 앱으로 들여보낸다.
// native-exchange(POST) 와 **같은 code·같은 단일사용 원장**을 쓴다 — 둘 중 하나만 성공한다.
router.get('/google/web-return', async (req, res) => {
  const fail = (reason) => {
    logOauthFailure('auth/google web-return', reason, {
      ua: String(req.get('user-agent') || '').slice(0, 120),
    });
    return res.redirect(302, buildRedirectTarget({ ok: false, error: reason }));
  };
  try {
    const code = String(req.query.code || '');
    if (!code) return fail('code_required');
    let payload;
    try {
      payload = jwt.verify(code, process.env.JWT_SECRET);
    } catch {
      return fail('invalid_or_expired_code');
    }
    if (!payload || payload.purpose !== 'native_oauth' || !payload.uid || !payload.jti) {
      return fail('invalid_code');
    }
    // 검사와 표시를 **한 문장**으로 — 두 문장이면 동시 요청이 둘 다 통과한다(2026-09-10 Fable).
    if (!(await claimNativeCodeOnce(payload.jti, (payload.exp || Math.floor(Date.now() / 1000) + 120) * 1000))) {
      return fail('code_already_used');
    }

    const user = await User.findByPk(payload.uid);
    if (!user || user.status !== 'active') return fail('account_unavailable');

    await issueSessionCookie(req, res, user);
    return res.redirect(302, buildRedirectTarget({ ok: true }));
  } catch (e) {
    console.error('[auth_oauth/web-return]', e);
    return fail('exchange_failed');
  }
});
};
