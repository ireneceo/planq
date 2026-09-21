// services/apple_oauth_login.js — Sign in with Apple (웹 흐름) (2026-09-21)
//
// 왜: App Store 심사 4.8 — 구글 로그인을 제공하는 앱은 애플 로그인도 제공해야 한다.
//   앱은 원격 껍데기라 **웹 흐름**으로 붙인다(구글과 같은 시스템 브라우저 → 복귀 페이지 → 딥링크).
//   앱을 다시 빌드하지 않아도 되고, 웹·PWA·안드로이드에서도 같은 버튼이 된다.
//
// 흐름: /api/auth/apple/initiate → appleid.apple.com/auth/authorize (response_mode=form_post)
//       → **POST** /api/auth/apple/callback { code, state, id_token, user? }
//       → 토큰 교환(client_secret = 우리 .p8 로 서명한 ES256 JWT) → id_token 검증 → 3분기(oauth/finish.js)
//
// ★ 콜백이 **교차 사이트 POST** 다. SameSite=Lax 쿠키(oauth_native)가 실려 오지 않으므로
//   "네이티브 흐름인가" 는 state 에 실어 나른다. nonce 도 state 에 두고 id_token 과 대조한다.
// ★ 자격(Services ID·Team ID·Key ID·.p8)은 플랫폼 관리자 설정(platform_settings)에 둔다 —
//   .env 는 SSH 로만 바꿀 수 있고 채팅에 비밀을 적게 할 수 없다. .p8 은 암호화 저장.
// ★ 로그에 code·id_token·client_secret·state 원문을 남기지 않는다.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const ephemeral = require('./ephemeralStore');

const APPLE_ISS = 'https://appleid.apple.com';
const AUTH_URL = 'https://appleid.apple.com/auth/authorize';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const KEYS_URL = 'https://appleid.apple.com/auth/keys';
const STATE_KIND = 'apple_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;   // 애플 화면에서 Face ID·2단계 확인까지 — 구글(5분)보다 넉넉히

// ─── 자격 ───────────────────────────────────────────────
let cfgCache = { at: 0, cfg: null };
function invalidateAppleConfig() { cfgCache = { at: 0, cfg: null }; }

/** 넷 다 있고 개인키가 풀리면 {servicesId, teamId, keyId, privateKey}, 아니면 null. 60초 캐시. */
async function getAppleConfig() {
  if (Date.now() - cfgCache.at < 60 * 1000) return cfgCache.cfg;
  let cfg = null;
  try {
    const { PlatformSetting } = require('../models');
    const row = await PlatformSetting.findOne({
      order: [['id', 'ASC']],
      attributes: ['apple_services_id', 'apple_team_id', 'apple_key_id', 'apple_private_key_enc'],
    });
    if (row && row.apple_services_id && row.apple_team_id && row.apple_key_id && row.apple_private_key_enc) {
      const { decrypt } = require('./encryption');
      const privateKey = decrypt(row.apple_private_key_enc);
      if (privateKey) {
        cfg = {
          servicesId: row.apple_services_id, teamId: row.apple_team_id,
          keyId: row.apple_key_id, privateKey,
        };
      }
    }
  } catch (e) {
    console.warn('[apple-login] 자격 읽기 실패:', e.message);   // 키 회전·blob 손상 — 버튼을 내린다
  }
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}

/** .p8 형식 검사 — 저장 전에 **실제로 서명이 되는지** 본다(붙여넣기 실수를 저장 시점에 잡는다). */
function validatePrivateKey(pem) {
  try {
    const k = crypto.createPrivateKey(String(pem));
    if (k.asymmetricKeyType !== 'ec') return 'not_ec_key';
    jwt.sign({ t: 1 }, String(pem), { algorithm: 'ES256' });
    return null;
  } catch { return 'invalid_private_key'; }
}

function getRedirectUri() {
  // 구글 로그인과 같은 규칙 — 명시 env > APP_BASE_URL > GOOGLE_REDIRECT_URI 의 origin > dev.
  if (process.env.APPLE_LOGIN_REDIRECT_URI) return process.env.APPLE_LOGIN_REDIRECT_URI;
  let origin = process.env.APP_BASE_URL;
  if (!origin && process.env.GOOGLE_REDIRECT_URI) {
    try { origin = new URL(process.env.GOOGLE_REDIRECT_URI).origin; } catch (_) { /* 무시 */ }
  }
  return `${origin || 'https://dev.planq.kr'}/api/auth/apple/callback`;
}

// ─── state ──────────────────────────────────────────────
async function buildAuthUrl({ pair, native }) {
  const cfg = await getAppleConfig();
  if (!cfg) throw new Error('apple_not_configured');
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  await ephemeral.set(STATE_KIND, state, { pair: pair || null, native: !!native, nonce }, STATE_TTL_MS);
  const qs = new URLSearchParams({
    response_type: 'code',
    response_mode: 'form_post',   // scope 에 name/email 이 있으면 애플은 form_post 만 허용한다
    client_id: cfg.servicesId,
    redirect_uri: getRedirectUri(),
    scope: 'name email',
    state,
    nonce,
  });
  return `${AUTH_URL}?${qs.toString()}`;
}

/** state 를 **한 번만** 소비한다. 유효하지 않거나 이미 쓰였으면 null. */
async function consumeState(s) {
  if (!s || typeof s !== 'string' || s.length > 191) return null;
  const row = await ephemeral.get(STATE_KIND, s);
  if (!row) return null;
  const removed = await ephemeral.consume(STATE_KIND, s);
  if (removed !== 1) return null;
  const p = row.payload || {};
  return { pair: p.pair || null, native: !!p.native, nonce: p.nonce || null };
}

// ─── 토큰 ───────────────────────────────────────────────
function clientSecret(cfg) {
  return jwt.sign({}, cfg.privateKey, {
    algorithm: 'ES256',
    keyid: cfg.keyId,
    issuer: cfg.teamId,
    subject: cfg.servicesId,
    audience: APPLE_ISS,
    expiresIn: '5m',
  });
}

let jwksCache = { at: 0, keys: [] };
async function appleKeys(force) {
  if (!force && Date.now() - jwksCache.at < 60 * 60 * 1000 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`apple_keys_http_${r.status}`);
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: Array.isArray(j.keys) ? j.keys : [] };
  return jwksCache.keys;
}

/** id_token 서명·발급자·대상·nonce 를 검증하고 payload 를 돌려준다. */
async function verifyIdToken(idToken, { audience, nonce }) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) throw new Error('id_token_malformed');
  let jwk = (await appleKeys(false)).find((k) => k.kid === decoded.header.kid);
  if (!jwk) jwk = (await appleKeys(true)).find((k) => k.kid === decoded.header.kid);   // 애플 키 회전
  if (!jwk) throw new Error('id_token_unknown_kid');
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const payload = jwt.verify(idToken, pub, { algorithms: ['RS256'], issuer: APPLE_ISS, audience });
  if (!nonce || payload.nonce !== nonce) throw new Error('id_token_nonce_mismatch');
  return payload;
}

/**
 * code → 토큰 교환 → id_token 검증 → 프로필.
 * ★ 이름은 id_token 에 없다. 애플은 **첫 동의 때 한 번만** form 의 `user` 필드로 준다(호출부가 넘긴다).
 */
async function exchangeCodeForProfile(code, { nonce }) {
  const cfg = await getAppleConfig();
  if (!cfg) throw new Error('apple_not_configured');
  const body = new URLSearchParams({
    client_id: cfg.servicesId,
    client_secret: clientSecret(cfg),
    code: String(code),
    grant_type: 'authorization_code',
    redirect_uri: getRedirectUri(),
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id_token) throw new Error(`apple_token_${j.error || r.status}`);
  const p = await verifyIdToken(j.id_token, { audience: cfg.servicesId, nonce });
  const truthy = (v) => v === true || v === 'true';
  return {
    sub: p.sub,
    email: p.email ? String(p.email).toLowerCase() : null,
    email_verified: truthy(p.email_verified),
    is_private_email: truthy(p.is_private_email),
  };
}

/** form 의 `user` JSON 에서 표시 이름만 꺼낸다. 없거나 깨졌으면 null. */
function nameFromUserField(raw) {
  if (!raw) return null;
  try {
    const u = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const first = String((u && u.name && u.name.firstName) || '').trim();
    const last = String((u && u.name && u.name.lastName) || '').trim();
    // 한글 이름은 «성이름» 붙여서, 그 밖은 «이름 성»
    const hangul = /[가-힣]/.test(first + last);
    const s = (hangul ? `${last}${first}` : `${first} ${last}`).trim().slice(0, 100);
    return s || null;
  } catch { return null; }
}

module.exports = {
  getAppleConfig, invalidateAppleConfig, validatePrivateKey, getRedirectUri,
  buildAuthUrl, consumeState, exchangeCodeForProfile, nameFromUserField,
  _test: { clientSecret, verifyIdToken, appleKeys, setJwks: (keys) => { jwksCache = { at: Date.now(), keys }; } },
};
