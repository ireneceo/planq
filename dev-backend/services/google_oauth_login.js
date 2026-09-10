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

// state (CSRF) — 5분 만료. 값은 { pair } — pair 는 앱 페어링 **흐름 식별자**다.
//   ★ pair 는 비밀이 아니다(누가 알아도 무해). 비밀인 6자리 코드는 콜백이 만들어
//     **그 브라우저 화면에만** 보여준다 — services/oauthPairing.js 머리말 참조.
//
// ★ 2026-09-10 — 메모리 `Map` 에서 `ephemeral_tokens`(kind='oauth_state') 로 옮겼다.
//   배포(PM2 reload)마다 Map 이 비어, 그 순간 Google 동의 화면에 있던 사용자는 돌아와서
//   전부 `invalid_state` 를 받았다 — 4개 환경(웹·PWA·iOS·Android) 공통, 사용자에게는
//   "가끔 로그인이 안 된다". state 는 CSRF 방어이므로 **1회용 원자성**을 지킨다:
//   payload 는 먼저 읽되, 소비 권리는 `consume`(삭제 건수 === 1)이 가른다 — 콜백이 두 번
//   로드돼도 한쪽만 통과한다.
const ephemeral = require('./ephemeralStore');
const STATE_KIND = 'oauth_state';
const STATE_TTL_MS = 5 * 60 * 1000;

async function genState(pair) {
  const s = crypto.randomBytes(24).toString('base64url');
  await ephemeral.set(STATE_KIND, s, { pair: pair || null }, STATE_TTL_MS);
  return s;
}

/** state 를 **한 번만** 소비하고 함께 실려온 pair 를 돌려준다. 유효하지 않거나 이미 쓰였으면 null. */
async function consumeStateEntry(s) {
  if (!s || typeof s !== 'string' || s.length > 191) return null;
  const row = await ephemeral.get(STATE_KIND, s);        // 만료면 null(행도 지운다)
  if (!row) return null;
  const pair = (row.payload && row.payload.pair) || null;
  const removed = await ephemeral.consume(STATE_KIND, s);  // 동시 콜백 — 1 을 받은 쪽만 유효
  if (removed !== 1) return null;
  return { exp: new Date(row.expires_at).getTime(), challenge: pair };   // 호출부 이름 호환
}

// 참/거짓만 쓰던 옛 호출부 호환.
async function consumeState(s) { return !!(await consumeStateEntry(s)); }

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
async function buildAuthUrl(pair) {
  const client = newClient();
  const state = await genState(pair);
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

module.exports = { buildAuthUrl, exchangeCodeForProfile, consumeState, consumeStateEntry, getRedirectUri };
