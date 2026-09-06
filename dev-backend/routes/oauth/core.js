// routes/oauth/core.js — OAuth 라우트들이 **함께 쓰는** 상태와 헬퍼.
//
// ★ 왜 별도 모듈인가 (2026-09-06 분리): 아래 두 Map 은 **경계를 가로지른다**.
//     confirmStash    : /google/callback(쓰기) ↔ /google/connect-confirm(읽기·삭제)
//     usedNativeCodes : /google/web-return    ↔ /google/native-exchange
//   각 라우트 파일이 자기 Map 을 만들면 **두 벌이 되어 흐름이 조용히 깨진다**
//   (연결 확인 토큰이 "만료됨" 으로 뜨고, 일회용 code 가 두 번 먹힌다 = replay 차단 붕괴).
//   그래서 소유자를 하나로 못 박는다. 여기 말고 어디에서도 이 Map 을 만들지 않는다.
//   sweep 타이머도 여기 하나뿐이다 — 모듈이 캐시되므로 몇 번 require 해도 한 번만 돈다.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Business, BusinessMember } = require('../../models');
const { cookieSecure } = require('../../services/authTokens');
// 옛 /login 의 refresh_token cookie 패턴 재사용 (다중 디바이스 + sliding renewal 정합)
const { helpers } = require('../auth');
const { createRefreshTokenRow, generateRefreshToken, resolveClientKind, TTL_MS_BY_KIND, setSessionHint } = helpers;

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

module.exports = {
  confirmStash, usedNativeCodes,
  isNativeOAuth, issueNativeOAuthCode, generateSlug, setupNewWorkspace,
  buildRedirectTarget, issueSessionCookie,
};
