// services/gmail_oauth.js — Gmail OAuth 연동 (메일 계정용)
//
// PlanQ Login OAuth (google_oauth_login.js) 와 같은 GOOGLE_CLIENT_ID/SECRET 공유.
// 다른 redirect URI + 더 넓은 scope:
//   - https://mail.google.com/  (전체 IMAP/SMTP via XOAUTH2)
//   - openid + email + profile (계정 식별)
// state 에 businessId + userId encoded.
const { google } = require('googleapis');
const crypto = require('crypto');

const SCOPES = [
  'https://mail.google.com/',
  'openid', 'email', 'profile',
];

function getRedirectUri() {
  // 로그인 OAuth 와 동일 패턴 — GOOGLE_REDIRECT_URI origin 재사용해 운영/dev 자동 정합 (#72/#88).
  if (process.env.GMAIL_OAUTH_REDIRECT_URI) return process.env.GMAIL_OAUTH_REDIRECT_URI;
  let origin = process.env.APP_BASE_URL;
  if (!origin && process.env.GOOGLE_REDIRECT_URI) {
    try { origin = new URL(process.env.GOOGLE_REDIRECT_URI).origin; } catch (_) { /* 무시 */ }
  }
  return `${origin || 'https://dev.planq.kr'}/api/businesses/email-accounts/oauth/gmail/callback`;
}

function newClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri()
  );
}

// state HMAC (CSRF 방어 + 10분 TTL) — personalOauth.js / gcal / gdrive 와 동일 패턴.
//   서명 없는 옛 평문 base64url state 는 위조 가능(임의 businessId 에 계정 붙임)이라 폐기.
const STATE_TTL_MS = 10 * 60 * 1000;
function _hmac(payloadB64) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

function encodeState({ businessId, userId, returnUrl, scope }) {
  // scope: 'team'(회사 공용) | 'personal'(개인). 계정 소유 결정용.
  const payload = Buffer.from(JSON.stringify({
    b: businessId, u: userId, r: returnUrl || null, s: scope || 'team',
    n: crypto.randomBytes(8).toString('hex'), t: Date.now(),
  })).toString('base64url');
  return `${payload}.${_hmac(payload)}`;
}

function decodeState(state) {
  try {
    const [payloadB64, sig] = String(state || '').split('.');
    if (!payloadB64 || !sig) return null;
    if (_hmac(payloadB64) !== sig) return null;   // 위조 차단
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (Date.now() - parsed.t > STATE_TTL_MS) return null;   // 만료
    return { businessId: parsed.b, userId: parsed.u, returnUrl: parsed.r, scope: parsed.s === 'personal' ? 'personal' : 'team' };
  } catch { return null; }
}

function buildAuthUrl({ businessId, userId, returnUrl, scope }) {
  const client = newClient();
  return client.generateAuthUrl({
    access_type: 'offline',           // refresh_token 받음 (장기 IMAP fetch 위해 필수)
    scope: SCOPES,
    prompt: 'consent',                 // 항상 refresh_token 받게
    state: encodeState({ businessId, userId, returnUrl, scope }),
  });
}

async function exchangeCodeForTokens(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  // id_token 으로 email 가져오기
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope,
    email: payload.email,
    name: payload.name,
  };
}

// access_token 만료 시 refresh_token 으로 갱신
async function refreshAccessToken(refresh_token) {
  const client = newClient();
  client.setCredentials({ refresh_token });
  const { credentials } = await client.refreshAccessToken();
  return {
    access_token: credentials.access_token,
    expires_at: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
  };
}

// XOAUTH2 SASL string (IMAP/SMTP 인증) — RFC 7628
function buildXOAuth2(user, accessToken) {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`).toString('base64');
}

module.exports = { buildAuthUrl, exchangeCodeForTokens, refreshAccessToken, decodeState, buildXOAuth2, getRedirectUri };
