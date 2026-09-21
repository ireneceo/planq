// routes/oauth/apple.js — Sign in with Apple: 시작 · 콜백 (2026-09-21).
//   3분기·실패 착지·네이티브 복귀는 oauth/finish.js 를 구글과 **같이** 쓴다.
//   애플만 다른 것: ①콜백이 교차 사이트 POST(form_post) ②네이티브 여부·nonce 를 state 가 나른다
//   ③이름은 첫 동의 때 form `user` 로 한 번만 온다.
const appleOauthLogin = require('../../services/apple_oauth_login');
const { logOauthFailure } = require('../../utils/oauthLog');
const { buildRedirectTarget } = require('./core');
const { finishOauthLogin, failLogin } = require('./finish');

const PAIR_RE = /^[A-Za-z0-9_-]{16,64}$/;

module.exports = function registerAppleRoutes(router) {
// 로그인 화면이 버튼을 그릴지 — 자격이 다 들어 있을 때만 [Apple 로 계속] 을 보인다.
//   공개 라우트지만 참/거짓만 돌려준다(어떤 값이 들었는지는 알리지 않는다).
router.get('/oauth-providers', async (req, res) => {
  const apple = !!(await appleOauthLogin.getAppleConfig());
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, data: { google: true, apple } });
});

router.get('/apple/initiate', async (req, res) => {
  try {
    const pair = typeof req.query.pair === 'string' && PAIR_RE.test(req.query.pair) ? req.query.pair : null;
    const url = await appleOauthLogin.buildAuthUrl({ pair, native: req.query.client === 'native' });
    return res.redirect(302, url);
  } catch (e) {
    logOauthFailure('auth/apple initiate', e.message, { ua: String(req.get('user-agent') || '').slice(0, 120) });
    const err = e.message === 'apple_not_configured' ? 'apple_not_configured' : 'oauth_failed';
    return res.redirect(302, `${buildRedirectTarget({ ok: false, error: err })}&oauth_provider=apple`);
  }
});

// appleid.apple.com 이 form_post 로 부른다 — CORS 는 이 경로만 건너뛴다(middleware/security.js).
router.post('/apple/callback', async (req, res) => {
  const b = req.body || {};
  const logTag = 'auth/apple callback';
  const logCtx = { ua: String(req.get('user-agent') || '').slice(0, 120) };
  // state 를 먼저 소비한다 — 취소(error)로 돌아와도 "앱에서 시작했는가" 는 state 만 안다.
  const st = await appleOauthLogin.consumeState(typeof b.state === 'string' ? b.state : '').catch(() => null);
  const native = !!(st && st.native);
  const fail = (reason) => {
    logOauthFailure(logTag, reason, { ...logCtx, native: native || undefined });
    return failLogin(req, res, reason, { native, provider: 'apple' });
  };
  try {
    if (b.error) return fail(String(b.error));
    if (!st) return fail('invalid_state');
    if (!b.code) return fail('invalid_request');
    const profile = await appleOauthLogin.exchangeCodeForProfile(String(b.code), { nonce: st.nonce });
    // 애플은 받은 주소를 모두 확인된 것으로 준다. 그래도 거짓이면 붙이지 않는다(구글과 같은 규칙).
    if (profile.email && !profile.email_verified) return fail('email_not_verified');
    return await finishOauthLogin(req, res, {
      provider: 'apple',
      profile: {
        subject: profile.sub,
        email: profile.email,
        name: appleOauthLogin.nameFromUserField(b.user),
        picture: null,
        locale: null,
      },
      native,
      pairId: st.pair,
      logTag,
    });
  } catch (e) {
    console.error('[auth_oauth/apple/callback]', e.message);
    return fail('oauth_failed');
  }
});
};
