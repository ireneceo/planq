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
const { cookieSecure } = require('../services/authTokens');
const googleOauthLogin = require('../services/google_oauth_login');
// ★ 2026-09-04: 이 줄이 없어서 아래 호출이 ReferenceError 였다 —
//   네이티브 구글 로그인이 catch 로 떨어져 **매번 웹 로그인 화면으로** 돌아갔다.
const { sendNativeReturn } = require('../utils/nativeReturn');
// ★ 2026-09-06 — 운영 pm2 로그에 OAuth 흔적이 **0줄**이었다. 실패해도 원인을 볼 수 없었다.
//   external_connections.js 는 이미 이 헬퍼를 쓰고 있었는데 로그인 경로만 빠져 있었다.
const { logOauthFailure } = require('../utils/oauthLog');
// 앱 세션 페어링 — 딥링크가 앱을 못 열 때의 통로. 설계·안전성은 services/oauthPairing.js 머리말.
const oauthPairing = require('../services/oauthPairing');
// 세션 발급 경로라 per-user(미인증이면 IP) 제한 (CLAUDE.md 운영 안정성 1).
let perUserLimiter = null;
try { ({ perUserLimiter } = require('../middleware/costGuard')); } catch { /* 없으면 무제한 — 라우트는 살아야 한다 */ }
const limit = (name, max) => (perUserLimiter ? perUserLimiter(name, { windowMs: 60 * 1000, max }) : (req, res, next) => next());
// 옛 /login 의 refresh_token cookie 패턴 재사용 (다중 디바이스 + sliding renewal 정합)
const { helpers } = require('./auth');
const { createRefreshTokenRow, generateAccessToken, generateRefreshToken, resolveClientKind, TTL_MS_BY_KIND, setSessionHint } = helpers;

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
// ★ 이 판단이 **왜** 참이 됐는지 로그에 남긴다 (2026-09-06).
//   운영 안드로이드 태블릿에서 네이티브 복귀 페이지가 떴는데(= 이 함수가 true),
//   운영 refresh_tokens 의 안드로이드 접속은 전부 일반 Chrome(client_kind='web') 이었다.
//   쿠키는 `?client=native` 로만 심기고 10분 살아 있는데, **Custom Tab 은 Chrome 과 쿠키를
//   공유**하므로 앱에서 한 번 시작한 흔적이 같은 브라우저의 다음 로그인에 남을 수 있다.
//   추측을 확정하려면 UA 와 함께 기록이 있어야 한다.
function isNativeOAuth(req) {
  return !!(req.cookies && req.cookies.oauth_native === '1');
}
// ★ 수명 2분 → 10분 (2026-09-06 운영). 2분은 **기계가 즉시 교환할 때만** 맞는 값이다.
//   앱이 안 열려 복귀 페이지에 남으면 사람이 화면을 읽고 버튼을 누르는 데 그보다 오래 걸린다.
//   Irene 실사례: "이걸 누르면 로그인 링크 만료래" → 로그 `web-return 실패 invalid_or_expired_code`.
//   일회용(usedNativeCodes)이라 수명이 길어도 재사용은 못 한다 — 위험은 늘지 않는다.
function issueNativeOAuthCode(user) {
  const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return jwt.sign({ uid: user.id, purpose: 'native_oauth', jti }, process.env.JWT_SECRET, { expiresIn: '10m' });
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
function buildRedirectTarget({ ok, error }) {
  if (!ok) {
    const safeErr = encodeURIComponent(error || 'unknown_error');
    return `/login?oauth_error=${safeErr}`;
  }
  // 신규·기존 모두 /inbox. **온보딩 페이지는 아직 없다** — 옛 코드의 `/onboarding` 은
  //   라우트 대장에 없어 catch-all 이 잡았고, `/` 는 로그인 여부와 무관하게 마케팅 홈이라
  //   (pages/Landing/RootRoute.tsx) **구글로 막 가입한 사용자가 앱이 아니라 랜딩에 떨어졌다.**
  //   온보딩을 만들 때 라우트 등록과 이 분기를 같이 되살릴 것.
  // AuthContext mount 시 tryRefresh() 가 자동 호출되어 refresh_token cookie 로 access token 받음
  return '/inbox';
}

// refresh_token cookie 발급 — 옛 login 라우트와 동일
async function issueSessionCookie(req, res, user) {
  const clientKind = resolveClientKind(req);
  const refreshToken = generateRefreshToken(user, clientKind);
  await createRefreshTokenRow(user, refreshToken, req, null, { clientKind });
  await user.update({ last_login_at: new Date() });
  const secure = cookieSecure(res);   // 실제 연결이 HTTPS 인가 (services/authTokens)
  const cookieOpts = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: TTL_MS_BY_KIND[clientKind],
  };
  res.cookie('refresh_token', refreshToken, cookieOpts);
  // 보안 Stage 1 — 이 경로가 빠지면 **구글 로그인 사용자 전원**이 (Stage 2 후) 이미지를 잃는다.
  helpers.setImageCookie(res, user);
  // #244 — 동반 세션 힌트도 같은 수명으로 (OAuth 로그인 누락 시 그 사용자만 진단 사각지대가 된다).
  setSessionHint(res, { maxAge: cookieOpts.maxAge, secure });
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

// ─── 앱 세션 페어링 ────────────────────────────────────────────────
// 딥링크(planq:// · App Link)가 앱을 열지 못하는 기기에서의 정본 경로.
// 설계·안전성 논거는 services/oauthPairing.js 머리말에 있다 — 특히 **왜 비밀이 개시 링크로
// 들어오면 안 되는지**(첫 설계의 ATO). 여기서는 얇게 통과시키기만 한다.

// ① 앱(WebView)이 흐름을 연다. 응답의 pair_id 는 **비밀이 아니다**.
router.post('/google/pair/start', limit('google-pair-start', 20), (req, res) => {
  try {
    return res.json({ success: true, data: { pair_id: oauthPairing.start() } });
  } catch (e) {
    console.error('[auth_oauth/pair-start]', e);
    return res.status(500).json({ success: false, message: 'pair_start_failed' });
  }
});

// ④ 앱이 pair_id + **사용자가 브라우저 화면에서 읽어 입력한 6자리**로 세션을 받아간다.
router.post('/google/claim', limit('google-claim', 10), async (req, res) => {
  try {
    const { pair_id: pairId, code, client_kind } = req.body || {};
    const r = oauthPairing.claim(pairId, code);
    if (!r.ok) {
      logOauthFailure('auth/google claim', r.reason, {
        ua: String(req.get('user-agent') || '').slice(0, 120),
      });
      // 사유는 그대로 돌려준다 — 화면이 "코드가 틀렸다" 와 "만료됐다" 를 다르게 말해야 한다.
      const status = r.reason === 'not_ready' ? 409 : (r.reason === 'bad_code' ? 401 : 404);
      return res.status(status).json({ success: false, message: r.reason });
    }
    const user = await User.findByPk(r.uid);
    if (!user || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'account_unavailable' });
    }
    if (client_kind) req.body.client_kind = client_kind;
    await issueSessionCookie(req, res, user);
    return res.json({ success: true, data: { claimed: true } });
  } catch (e) {
    console.error('[auth_oauth/claim]', e);
    return res.status(500).json({ success: false, message: 'claim_failed' });
  }
});

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
