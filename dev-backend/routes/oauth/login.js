// routes/oauth/login.js — 구글 로그인 본류: 시작 · 콜백 · 웹 복귀.
// 라우터를 **새로 만들지 않는다** — auth_oauth.js 가 준 하나에 그대로 등록해
// 등록 순서와 마운트 지점(server.js `/api/auth`)을 분리 전과 동일하게 유지한다.
const jwt = require('jsonwebtoken');
const { User, OauthConnection, sequelize } = require('../../models');
const googleOauthLogin = require('../../services/google_oauth_login');
const { sendNativeReturn } = require('../../utils/nativeReturn');
const { logOauthFailure } = require('../../utils/oauthLog');
const oauthPairing = require('../../services/oauthPairing');
const {
  confirmStash, usedNativeCodes, isNativeOAuth, issueNativeOAuthCode,
  setupNewWorkspace, buildRedirectTarget, issueSessionCookie,
} = require('./core');

module.exports = function registerLoginRoutes(router) {
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
    // 앱이 만든 **흐름 식별자**(비밀 아님)를 state 에 실어 콜백까지 나른다.
    //   ★ 비밀(코드)은 절대 여기로 들어오지 않는다 — 첫 설계가 그렇게 했다가 ATO 가 됐다.
    const pair = typeof req.query.pair === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(req.query.pair)
      ? req.query.pair : null;
    const { url } = googleOauthLogin.buildAuthUrl(pair);
    return res.redirect(302, url);
  } catch (e) {
    return res.redirect(302, buildRedirectTarget({ ok: false, error: e.message }));
  }
});

// 2. Google OAuth callback — CSP 정합 (inline script X, fragment redirect)
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;
    const logCtx = { ua: String(req.get('user-agent') || '').slice(0, 120), native: isNativeOAuth(req) || undefined };
    if (oauthError) {
      logOauthFailure('auth/google callback', String(oauthError), logCtx);
      return res.redirect(302, buildRedirectTarget({ ok: false, error: oauthError }));
    }
    if (!code || !state) {
      logOauthFailure('auth/google callback', 'invalid_request', logCtx);
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'invalid_request' }));
    }
    const stateEntry = googleOauthLogin.consumeStateEntry(String(state));
    if (!stateEntry) {
      // 대개 ①서버 재시작으로 메모리 state 가 날아갔거나 ②콜백이 두 번 로드됐거나 ③5분 초과.
      logOauthFailure('auth/google callback', 'invalid_state', logCtx);
      return res.redirect(302, buildRedirectTarget({ ok: false, error: 'invalid_state' }));
    }
    const pairId = stateEntry.challenge;   // state 가 나른 흐름 식별자

    const profile = await googleOauthLogin.exchangeCodeForProfile(String(code));
    if (!profile.email_verified) {
      logOauthFailure('auth/google callback', 'email_not_verified', logCtx);
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
          // #259 — 시스템 계정(Cue·게스트 그림자)에는 절대 붙이지 않는다.
          //   그림자 주소는 guest+cN@guest.planq.kr 라 구글 계정과 겹칠 일이 없지만,
          //   매칭 술어에 명시해 둔다 — 나중에 주소 규칙이 바뀌어도 여기가 막는다.
          is_ai: false,
          is_guest: false,
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
        // ★ 2026-09-04 — 네이티브 분기가 없어서 이 경로가 **앱에서 막혀 있었다.**
        //   기존 회원이 구글로 로그인하면(= 아직 연결 안 된 계정) 여기로 오는데, 웹 경로로
        //   302 하면 그 확인 화면이 **시스템 브라우저 안에** 뜬다. 거기서 확인을 눌러도
        //   세션 쿠키는 그 브라우저에 심기고 앱 WebView 는 아무것도 못 받는다
        //   (Irene: "구글로 연결하는 과정이 전에 있었고 이미 했었어. 그런데 지금 전후 엉망이야").
        //   → 앱으로 먼저 돌아간 뒤, 앱 WebView 안에서 확인 화면을 연다. 그래야 쿠키가 앱에 심긴다.
        if (isNativeOAuth(req)) {
          res.clearCookie('oauth_native', { path: '/api/auth' });
          // ★ 이 분기는 **아직 로그인이 아니다** — "이 계정에 구글을 연결할까요?" 확인이 남았다.
          //   코드 페어링을 붙일 수 없고(세션이 없다), 그래서 딥링크가 실패하면 갈 곳이 있어야 한다.
          //   2026-09-06 Fable F-2: webFallbackUrl 을 없앤 뒤 이 호출부만 남아 **옵션이 조용히
          //   버려지고** 링크가 planq:// 하나뿐인 막다른 길이 됐다(제목도 "로그인이 끝났습니다").
          return sendNativeReturn(res, { confirm: confirmToken }, {
            title: '계정 연결 확인이 필요합니다',
            altUrl: `/oauth/connect-confirm?token=${encodeURIComponent(confirmToken)}`,
            altLabel: '연결 확인하기',
          });
        }
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
      // 302 가 아니라 HTML 착지 — SFSafariViewController 는 커스텀 스킴 **리다이렉트를 무시**한다.
      logOauthFailure('auth/google callback', 'native_return(정상)', {
        ...logCtx, note: 'oauth_native 쿠키로 네이티브 복귀 페이지를 냄',
      });
      // 앱을 여는 길 둘(스킴 → App Link) + 웹으로 끝내는 길 하나. 어느 쪽도 막다른 길이 아니다.
      const origin = `${req.protocol}://${req.get('host')}`;
      // ★ 앱에 입력할 6자리 — **이 브라우저 화면에서만** 생겨난다. 공격자가 남의 로그인을
      //   자기 흐름에 붙여도 코드는 피해자 화면에 뜨므로 가져갈 수 없다.
      const pairCode = oauthPairing.attach(pairId, user.id);
      return sendNativeReturn(res, { code, new: isNewUser ? '1' : '0' }, {
        title: '로그인이 끝났습니다',
        // 코드가 있으면 App Link 를 주지 않는다 — 자동 이동이 코드를 화면에서 지운다(F-1).
        //   코드가 없는 흐름(앱이 pair 를 못 연 경우)에서만 App Link 사다리를 쓴다.
        appLinkUrl: pairCode ? undefined : `${origin}/oauth/native-return?code=${encodeURIComponent(code)}`,
        pairCode,
      });
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
    if (usedNativeCodes.has(payload.jti)) return fail('code_already_used');
    usedNativeCodes.set(payload.jti, (payload.exp || Math.floor(Date.now() / 1000) + 120) * 1000);

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
