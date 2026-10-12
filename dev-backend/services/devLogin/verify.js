'use strict';
/*
 * dev-login reference verifier — copy into your project's DEV backend (kit/DEV-LOGIN.md).
 * Framework-free: verifyDevLoginCode(code) → { ok:true, as, scope, next } | { ok:false, status, error }.
 * The route that calls it must be registered ONLY when devLoginEnabled() is true.
 */
const crypto = require('crypto');

const secret = () => process.env.DEV_LOGIN_SECRET || '';   // read on use — works even if dotenv loads after require
const used = new Map();                       // nonce → expiry ms (one-time use)
const KEEP_MS = 10 * 60 * 1000;

function devLoginEnabled() {
  const S = secret();
  const on = process.env.NODE_ENV === 'development' && S.length >= 32;
  if (!on && S && process.env.NODE_ENV === 'production') console.warn('[dev-login] DEV_LOGIN_SECRET is set in production — route NOT registered. Remove it from this .env');
  return on;
}

function unb64u(s) { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

function verifyDevLoginCode(code, now = Date.now()) {
  const bad = (status, error) => ({ ok: false, status, error });
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(code || ''));
  const S = secret();
  if (!m || S.length < 32) return bad(400, 'invalid_code');
  const want = crypto.createHmac('sha256', S).update(m[1]).digest();
  const got = unb64u(m[2]);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return bad(400, 'invalid_code');
  let p; try { p = JSON.parse(unb64u(m[1]).toString('utf8')); } catch (_) { return bad(400, 'invalid_code'); }
  if (!p || typeof p.exp !== 'number' || p.exp < now || typeof p.n !== 'string') return bad(400, 'invalid_code');
  for (const [k, t] of used) if (t < now) used.delete(k);
  if (used.has(p.n)) return bad(409, 'code_used');
  used.set(p.n, now + KEEP_MS);
  const next = String(p.next || '/');
  if (!/^\/(?!\/)/.test(next) || next.length > 1024 || /[\s\\]/.test(next)) return bad(400, 'bad_next');
  return { ok: true, as: String(p.as || ''), scope: p.scope && typeof p.scope === 'object' ? p.scope : {}, next };
}

module.exports = { devLoginEnabled, verifyDevLoginCode };
