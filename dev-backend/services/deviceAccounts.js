// services/deviceAccounts.js — 한 기기(브라우저·앱 WebView)에 로그인해 둔 **계정 묶음**의 단일 원천.
//
// 설계 정본: docs/MULTI_ACCOUNT_DESIGN.md 7절 (Fable 설계 판정 DESIGN-REVISE → 6건 반영, 2026-11-02)
//   Irene «인스타처럼 멀티로그인하고 바꿔가면서 사용하고 알림도 아이디들 다 받을 수 있을가?»
//
// 쿠키 (전부 HttpOnly · path /api/auth — /api/push 등 다른 경로에는 **안 간다**):
//   rt_<userId>   계정마다 refresh 토큰 하나. 회전·grace·수령확인 치유는 계정마다 따로 산다.
//   rt_last       지금 이 기기가 쓰는 계정 id. **바꾸는 문은 POST /api/auth/switch 와 로그인뿐**.
//   refresh_token 옛 쿠키 — 한 배포 주기 동안 rt_last 계정 것으로 **같이 쓴다**(옛 코드로 롤백해도 로그아웃 0).
//   rt_add        «계정 추가» 의도(10분, 서명). 로그인 화면이 이것을 보면 기존 계정을 지우지 않는다.
//   rt_solo       «보통 로그인» 표식. 다음 /api/auth 요청에서 다른 계정 쿠키·행을 정리한다
//                 (애플 form_post 처럼 쿠키가 안 실려 오는 콜백에서도 공용 PC 구멍을 막기 위해 뒤로 미룬다).
//
// ★ 판정 근거는 언제나 **서버가 본 쿠키**다. 화면이 보내는 계정 목록을 믿지 않는다.
//   다른 경로(/api/push)에서 묶음을 알아야 하면 `device_proof`(60초 HMAC)를 받는다 — 쿠키 경로를 넓히지 않는다.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { RefreshToken, User } = require('../models');

const MAX_ACCOUNTS = 5;
const RT_PREFIX = 'rt_';
const RT_RE = /^rt_(\d{1,12})$/;
const LAST = 'rt_last';
const ADD = 'rt_add';
const SOLO = 'rt_solo';
const LEGACY = 'refresh_token';
const COOKIE_PATH = '/api/auth';
const ADD_TTL_MS = 10 * 60 * 1000;
const PROOF_TTL_MS = 60 * 1000;
// 회전된(revoked rotated) 쿠키라도 이 안이면 refresh 가 치유한다(routes/auth.js DELIVERY_HEAL_MAX_MS 와 같은 값)
const HEAL_MAX_MS = 72 * 60 * 60 * 1000;

// 서명 열쇠 — JWT_SECRET 을 그대로 쓰지 않는다(파생 열쇠: 다른 소비처가 이 값을 bearer 로 받아들일 수 없게 — pq_img 선례).
const SIGN_KEY = crypto.createHmac('sha256', String(process.env.JWT_SECRET || '')).update('pq_device/v1').digest();
function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', SIGN_KEY).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function unsign(tok) {
  if (typeof tok !== 'string' || tok.length > 2000) return null;
  const i = tok.lastIndexOf('.');
  if (i <= 0) return null;
  const body = tok.slice(0, i);
  const mac = tok.slice(i + 1);
  const want = crypto.createHmac('sha256', SIGN_KEY).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!o || typeof o.exp !== 'number' || o.exp < Date.now()) return null;
    return o;
  } catch { return null; }
}

function secureOf(res) {
  return process.env.NODE_ENV === 'production' || res?.req?.secure === true;
}
function baseOpts(res) {
  return { httpOnly: true, secure: secureOf(res), sameSite: 'lax', path: COOKIE_PATH };
}

/** 요청에 붙은 계정 쿠키 → { uid: raw }. 옛 refresh_token 은 서명 검증 후 그 계정 몫으로(새 쿠키가 없을 때만). */
function readBundle(req) {
  const out = {};
  const c = req.cookies || {};
  for (const k of Object.keys(c)) {
    const m = RT_RE.exec(k);
    if (m && typeof c[k] === 'string' && c[k]) out[Number(m[1])] = c[k];
  }
  const legacy = c[LEGACY];
  if (typeof legacy === 'string' && legacy) {
    try {
      const d = jwt.verify(legacy, process.env.JWT_REFRESH_SECRET);
      const uid = Number(d.userId);
      if (uid && !out[uid]) out[uid] = legacy;
    } catch { /* 깨진 옛 쿠키 — 무시(refresh 가 401 로 말한다) */ }
  }
  return out;
}

/** 지금 이 기기가 쓰는 계정. rt_last 가 묶음에 있으면 그것, 아니면 옛 쿠키 주인, 아니면 첫 계정. */
function activeUid(req, bundle = readBundle(req)) {
  const last = Number(req.cookies?.[LAST] || 0);
  if (last && bundle[last]) return last;
  const legacy = req.cookies?.[LEGACY];
  if (legacy) {
    for (const [uid, raw] of Object.entries(bundle)) if (raw === legacy) return Number(uid);
  }
  const ids = Object.keys(bundle).map(Number);
  return ids.length ? ids[0] : null;
}

/** 이 쿠키가 아직 세션을 살릴 수 있는가 — **검증만**(회전·발급 없음). */
async function inspectRaw(uid, raw) {
  let decoded;
  try { decoded = jwt.verify(raw, process.env.JWT_REFRESH_SECRET); } catch { return { valid: false, reason: 'jwt' }; }
  if (Number(decoded.userId) !== Number(uid)) return { valid: false, reason: 'uid_mismatch' };
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const row = await RefreshToken.findOne({ where: { token_hash: hash } });
  if (!row || row.user_id !== Number(uid)) return { valid: false, reason: 'no_row' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false, reason: 'expired' };
  if (row.revoked_at) {
    const ago = Date.now() - new Date(row.revoked_at).getTime();
    if (!(row.revoked_reason === 'rotated' && row.replaced_by_id && ago < HEAL_MAX_MS)) return { valid: false, reason: 'revoked' };
  }
  return { valid: true, row };
}

/** 묶음의 유효한 계정 id 목록(사람 상태까지 본다 — 정지·탈퇴·게스트·AI 는 빠진다). */
async function validUids(req, bundle = readBundle(req)) {
  const ids = [];
  for (const [uid, raw] of Object.entries(bundle)) {
    const r = await inspectRaw(Number(uid), raw);
    if (r.valid) ids.push(Number(uid));
  }
  if (!ids.length) return [];
  const users = await User.findAll({ where: { id: ids, status: 'active' }, attributes: ['id', 'is_ai', 'is_guest'] });
  const ok = new Set(users.filter(u => !u.is_ai && !u.is_guest).map(u => u.id));
  return ids.filter(id => ok.has(id));
}

/** 계정 쿠키 한 벌을 쓴다. makeActive 면 rt_last·옛 refresh_token 도(이중 쓰기). */
function writeAccountCookie(res, uid, raw, maxAge, { makeActive = true } = {}) {
  const opts = baseOpts(res);
  if (maxAge != null) opts.maxAge = maxAge;
  res.cookie(`${RT_PREFIX}${uid}`, raw, opts);
  if (makeActive) {
    res.cookie(LEGACY, raw, opts);
    setLast(res, uid, maxAge);
  }
}
function setLast(res, uid, maxAge) {
  const o = baseOpts(res);
  // rt_last 는 가장 긴 계정 수명을 따라간다 — 세션 쿠키 계정이면 세션으로.
  if (maxAge != null) o.maxAge = maxAge;
  res.cookie(LAST, String(uid), o);
}

function clearAccountCookie(res, uid) {
  res.clearCookie(`${RT_PREFIX}${uid}`, { path: COOKIE_PATH });
}
function clearAllCookies(req, res) {
  for (const k of Object.keys(req.cookies || {})) if (RT_RE.test(k)) res.clearCookie(k, { path: COOKIE_PATH });
  res.clearCookie(LAST, { path: COOKIE_PATH });
  res.clearCookie(ADD, { path: COOKIE_PATH });
  res.clearCookie(SOLO, { path: COOKIE_PATH });
}

/** 그 계정 쿠키의 refresh 행을 폐기(이 기기 것만). */
async function revokeRaw(raw, reason = 'logout') {
  if (!raw) return 0;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const [n] = await RefreshToken.update({ revoked_at: new Date(), revoked_reason: reason }, { where: { token_hash: hash, revoked_at: null } });
  return n || 0;
}

// ── 계정 추가 의도 ────────────────────────────────────────────
function setAddIntent(res, uid) {
  res.cookie(ADD, sign({ uid: Number(uid), exp: Date.now() + ADD_TTL_MS }), { ...baseOpts(res), maxAge: ADD_TTL_MS });
}
/** 유효한 «계정 추가» 의도인가 — 서명·만료 + 의도를 낸 계정이 아직 이 묶음에 살아 있는가. */
async function addIntentValid(req, bundle = readBundle(req)) {
  const o = unsign(req.cookies?.[ADD]);
  if (!o || !o.uid || !bundle[o.uid]) return false;
  const r = await inspectRaw(o.uid, bundle[o.uid]);
  return r.valid;
}

/**
 * 로그인(비밀번호·가입·OAuth·dev-login)이 세션을 세운 **뒤** 부른다.
 *   «계정 추가» 의도가 보이면 기존 계정을 그대로 둔다(최대 수는 의도를 낼 때 POST /api/auth/accounts/add-intent 가 막는다).
 *   안 보이면 «보통 로그인» — 이 기기의 다른 계정 쿠키·refresh 행을 폐기한다. 쿠키가 안 보이는 콜백(애플 form_post)을 위해 rt_solo 를 남겨 다음 요청에서 마저 정리한다.
 * @returns {{mode:'add'|'solo', removed:number[]}}
 */
async function afterLogin(req, res, newUid, maxAge) {
  const bundle = readBundle(req);
  if (await addIntentValid(req, bundle)) {
    res.clearCookie(ADD, { path: COOKIE_PATH });
    try {
      require('./auditService').logAudit(req, {
        action: 'auth.account_add', targetType: 'User', targetId: newUid, userId: newUid, businessId: null,
        newValue: { device_accounts: Object.keys(bundle).map(Number).concat(bundle[newUid] ? [] : [Number(newUid)]) },
      });
    } catch { /* 감사 실패가 로그인을 막지 않는다 */ }
    return { mode: 'add', removed: [] };
  }
  const removed = [];
  for (const [uid, raw] of Object.entries(bundle)) {
    if (Number(uid) === Number(newUid)) continue;
    await revokeRaw(raw, 'logout');
    clearAccountCookie(res, uid);
    removed.push(Number(uid));
  }
  const o = baseOpts(res);
  if (maxAge != null) o.maxAge = Math.min(maxAge, 24 * 60 * 60 * 1000);
  res.cookie(SOLO, String(newUid), o);
  return { mode: 'solo', removed };
}

/**
 * /api/auth 요청마다(refresh·device-accounts·switch) 먼저 부른다 — 미뤄 둔 «보통 로그인» 정리.
 *   rt_solo=<uid> 가 있고 «계정 추가» 의도가 없으면 그 uid 외의 계정을 폐기·삭제한다.
 *   의도가 있으면(애플로 계정 추가 — 콜백에서 의도가 안 보였던 경우) 아무것도 지우지 않는다.
 * @returns {object} 정리 뒤 묶음
 */
async function housekeep(req, res) {
  let bundle = readBundle(req);
  const solo = Number(req.cookies?.[SOLO] || 0);
  if (!solo) return bundle;
  res.clearCookie(SOLO, { path: COOKIE_PATH });
  if (await addIntentValid(req, bundle)) {
    res.clearCookie(ADD, { path: COOKIE_PATH });
    return bundle;
  }
  const next = {};
  for (const [uid, raw] of Object.entries(bundle)) {
    if (Number(uid) === solo) { next[uid] = raw; continue; }
    await revokeRaw(raw, 'logout');
    clearAccountCookie(res, uid);
  }
  // 이 요청 안의 뒤 단계(refresh)가 지운 계정을 다시 고르지 않게 req.cookies 도 맞춘다
  for (const k of Object.keys(req.cookies || {})) {
    const m = RT_RE.exec(k);
    if (m && Number(m[1]) !== solo) delete req.cookies[k];
  }
  if (Number(req.cookies?.[LAST] || 0) !== solo && next[solo]) req.cookies[LAST] = String(solo);
  bundle = next;
  return bundle;
}

// ── 다른 경로용 묶음 증명 ──────────────────────────────────────
function issueProof(uids) {
  return sign({ uids: (uids || []).map(Number).slice(0, MAX_ACCOUNTS), exp: Date.now() + PROOF_TTL_MS });
}
/** device_proof → 유효한 계정 id 집합(틀리거나 만료면 빈 집합). */
function proofUids(tok) {
  const o = unsign(tok);
  if (!o || !Array.isArray(o.uids)) return new Set();
  return new Set(o.uids.map(Number).filter(Boolean));
}

module.exports = {
  MAX_ACCOUNTS, COOKIE_PATH, LEGACY, LAST,
  readBundle, activeUid, inspectRaw, validUids,
  writeAccountCookie, setLast, clearAccountCookie, clearAllCookies, revokeRaw,
  setAddIntent, addIntentValid, afterLogin, housekeep,
  issueProof, proofUids,
  // 시험용
  _sign: sign, _unsign: unsign,
};

