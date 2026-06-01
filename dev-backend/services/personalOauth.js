// services/personalOauth.js — 개인(owner_scope='user') Google OAuth 연동 (외부 연동 Phase 2-4)
//
// 워크스페이스 OAuth (cloud.js gdrive/gcal · email_accounts gmail) 와 같은 GOOGLE_CLIENT_ID/SECRET 공유.
// 단일 redirect URI 로 3 provider 통합 — provider 는 state 에 encode (Google Console 에 1개만 등록):
//   ${origin}/api/me/oauth/google/callback
//
// 최소 권한 원칙:
//   google_calendar → calendar.readonly  (Q Calendar overlay 표시 전용, 쓰기 X)
//   google_drive    → drive.readonly     (Q File 개인 탭 열람 전용)
//   gmail           → mail.google.com     (IMAP/SMTP XOAUTH2 — 회사 메일과 동일)
//
// 토큰은 호출측에서 services/encryption 으로 암호화하여 external_connections 에 저장.
const { google } = require('googleapis');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./encryption');

// provider → OAuth scope (openid/email/profile 로 계정 식별)
const PROVIDER_SCOPES = {
  google_calendar: ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email', 'profile'],
  google_drive: ['https://www.googleapis.com/auth/drive.readonly', 'openid', 'email', 'profile'],
  gmail: ['https://mail.google.com/', 'openid', 'email', 'profile'],
};

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

// GOOGLE_REDIRECT_URI 의 origin 만 재사용 (gcal/gdrive 패턴 정합)
function redirectUri() {
  const base = process.env.GOOGLE_REDIRECT_URI;
  if (!base) return null;
  try { return `${new URL(base).origin}/api/me/oauth/google/callback`; }
  catch { return null; }
}

function newClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
}

// ─── state HMAC (CSRF 방어 + 10분 TTL) — gcal/gdrive 와 동일 패턴 ───
const STATE_TTL_MS = 10 * 60 * 1000;
function _hmac(payloadB64) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}
function buildState({ userId, businessId, provider }) {
  const payload = Buffer.from(JSON.stringify({
    u: userId, b: businessId, p: provider,
    n: crypto.randomBytes(8).toString('hex'), t: Date.now(),
  })).toString('base64url');
  return `${payload}.${_hmac(payload)}`;
}
function parseState(state) {
  try {
    const [payloadB64, sig] = String(state || '').split('.');
    if (!payloadB64 || !sig) return null;
    if (_hmac(payloadB64) !== sig) return null;  // 위조 차단
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!p || Date.now() - p.t > STATE_TTL_MS) return null;  // 만료
    if (!PROVIDER_SCOPES[p.p]) return null;
    return { userId: p.u, businessId: p.b, provider: p.p };
  } catch { return null; }
}

function buildAuthUrl({ userId, businessId, provider }) {
  if (!PROVIDER_SCOPES[provider]) throw new Error('unsupported_provider');
  const client = newClient();
  return client.generateAuthUrl({
    access_type: 'offline',          // refresh_token 발급 (장기 갱신)
    prompt: 'consent',               // 항상 refresh_token 받게
    include_granted_scopes: true,
    scope: PROVIDER_SCOPES[provider],
    state: buildState({ userId, businessId, provider }),
  });
}

// code → 토큰 + 계정 식별 (id_token 의 email/name/sub claim)
async function exchangeCodeForTokens(code) {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  let email = null, name = null, sub = null;
  if (tokens.id_token) {
    try {
      const parts = String(tokens.id_token).split('.');
      if (parts.length === 3) {
        const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        email = p.email || null; name = p.name || null; sub = p.sub || null;
      }
    } catch (e) { console.warn('[personalOauth] id_token parse failed:', e.message); }
  }
  return { tokens, email, name, sub };
}

// external_connections row → 인증된 google OAuth2 client (만료 시 자동 refresh + 암호화 저장)
async function getAuthedClient(conn) {
  const client = newClient();
  client.setCredentials({
    access_token: conn.access_token_encrypted ? decrypt(conn.access_token_encrypted) : null,
    refresh_token: conn.refresh_token_encrypted ? decrypt(conn.refresh_token_encrypted) : null,
    expiry_date: conn.expires_at ? new Date(conn.expires_at).getTime() : null,
  });
  // googleapis 가 자동 refresh 하면 'tokens' 이벤트 → 새 토큰 암호화 저장
  client.on('tokens', async (fresh) => {
    try {
      const update = {};
      if (fresh.access_token) update.access_token_encrypted = encrypt(fresh.access_token);
      if (fresh.refresh_token) update.refresh_token_encrypted = encrypt(fresh.refresh_token);
      if (fresh.expiry_date) update.expires_at = new Date(fresh.expiry_date);
      if (Object.keys(update).length) await conn.update(update);
    } catch (e) { console.error('[personalOauth] token refresh save failed:', e.message); }
  });
  return client;
}

// 연결 해제 시 Google 측 토큰 revoke (best-effort — 실패해도 row 삭제는 진행)
async function revokeToken(conn) {
  try {
    const token = conn.refresh_token_encrypted ? decrypt(conn.refresh_token_encrypted)
      : (conn.access_token_encrypted ? decrypt(conn.access_token_encrypted) : null);
    if (!token) return;
    await newClient().revokeToken(token);
  } catch (e) { console.warn('[personalOauth] revoke failed:', e.message); }
}

module.exports = {
  PROVIDER_SCOPES,
  isConfigured,
  redirectUri,
  buildAuthUrl,
  parseState,
  exchangeCodeForTokens,
  getAuthedClient,
  revokeToken,
};
