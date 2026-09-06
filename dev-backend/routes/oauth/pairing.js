// routes/oauth/pairing.js — 앱 세션 페어링 + 네이티브 code 교환.
const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const { logOauthFailure } = require('../../utils/oauthLog');
const oauthPairing = require('../../services/oauthPairing');
const { usedNativeCodes, issueSessionCookie } = require('./core');
// 세션 발급 경로라 per-user(미인증이면 IP) 제한 (CLAUDE.md 운영 안정성 1).
let perUserLimiter = null;
try { ({ perUserLimiter } = require('../../middleware/costGuard')); } catch { /* 없으면 무제한 — 라우트는 살아야 한다 */ }
const limit = (name, max) => (perUserLimiter ? perUserLimiter(name, { windowMs: 60 * 1000, max }) : (req, res, next) => next());

module.exports = function registerPairingRoutes(router) {
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
};
