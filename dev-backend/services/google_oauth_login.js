// services/google_oauth_login.js — PlanQ 로그인 전용 Google OAuth
//
// GDrive / Calendar 와 같은 GOOGLE_CLIENT_ID/SECRET 공유.
// 로그인 전용 redirect URI: GOOGLE_LOGIN_REDIRECT_URI (env, GCP 콘솔에 등록 필요)
//   기본값: https://dev.planq.kr/api/auth/google/callback
//
// scope: openid + email + profile (Google 프로필 가져오기 최소)
// state: CSRF 보호 — random + 만료 5분
const { google } = require('googleapis');
const crypto = require('crypto');

const SCOPES = ['openid', 'email', 'profile'];

// state 캐시 (CSRF) — 5분 만료
const stateCache = new Map();
const STATE_TTL_MS = 5 * 60 * 1000;

function genState() {
  const s = crypto.randomBytes(24).toString('base64url');
  stateCache.set(s, Date.now() + STATE_TTL_MS);
  // 청소 — 만료된 state 제거
  for (const [k, exp] of stateCache.entries()) {
    if (exp < Date.now()) stateCache.delete(k);
  }
  return s;
}

function consumeState(s) {
  if (!s) return false;
  const exp = stateCache.get(s);
  if (!exp || exp < Date.now()) return false;
  stateCache.delete(s);
  return true;
}

function getRedirectUri() {
  // 우선순위: 명시 env > APP_BASE_URL > GOOGLE_REDIRECT_URI(gdrive/gcal 공유)의 origin > dev 폴백.
  // 옛 코드는 두 env 가 없으면 무조건 dev.planq.kr 로 폴백 → 운영(planq.kr)에서 로그인 콜백이
  // dev 로 가 세션이 끊겨 로그인 실패(#72). gcal/gdrive 와 동일하게 GOOGLE_REDIRECT_URI origin
  // 을 재사용해 운영/dev 자동 정합 (env 추가 불필요).
  if (process.env.GOOGLE_LOGIN_REDIRECT_URI) return process.env.GOOGLE_LOGIN_REDIRECT_URI;
  let origin = process.env.APP_BASE_URL;
  if (!origin && process.env.GOOGLE_REDIRECT_URI) {
    try { origin = new URL(process.env.GOOGLE_REDIRECT_URI).origin; } catch (_) { /* 무시 */ }
  }
  return `${origin || 'https://dev.planq.kr'}/api/auth/google/callback`;
}

function newClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
}

// 1. authorization URL 생성 — frontend 가 사용자 redirect
function buildAuthUrl() {
  const client = newClient();
  const state = genState();
  const url = client.generateAuthUrl({
    access_type: 'online',           // refresh_token 안 받음 (로그인만 — 매번 새로)
    scope: SCOPES,
    prompt: 'select_account',         // 사용자가 계정 선택 가능
    state,
  });
  return { url, state };
}

// 2. code 교환 → Google 프로필 fetch
async function exchangeCodeForProfile(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  // id_token 디코딩으로 profile 가져오기 (별도 API 호출 안 함)
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    google_sub: payload.sub,                  // Google 사용자 고유 id
    email: payload.email,
    email_verified: payload.email_verified,
    name: payload.name,
    given_name: payload.given_name,
    family_name: payload.family_name,
    picture: payload.picture,                 // 프로필 사진 URL
    locale: payload.locale,                   // 'ko' | 'en' 등
  };
}

module.exports = { buildAuthUrl, exchangeCodeForProfile, consumeState, getRedirectUri };
