// 시연 영상 작업자 인증 — /api/video-worker 라우터의 첫 미들웨어 한 벌 (docs/DEMO_VIDEO_DESIGN.md §20.4 · Fable 비차단 9).
//   Bearer 토큰(64 hex)의 sha256 = .env VIDEO_WORKER_TOKEN_SHA256 ∧ req.ip ∈ VIDEO_WORKER_ALLOW_IPS.
//   실패는 401 하나(이유를 흘리지 않음) + 경고 로그(req.ip 만 — 토큰은 남기지 않음).
const crypto = require('crypto');

function configured() {
  return /^[0-9a-f]{64}$/i.test(process.env.VIDEO_WORKER_TOKEN_SHA256 || '');
}

function allowIps() {
  return String(process.env.VIDEO_WORKER_ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// ::ffff:1.2.3.4 → 1.2.3.4
const normIp = (ip) => String(ip || '').replace(/^::ffff:/, '');

function workerAuth(req, res, next) {
  const deny = (why) => {
    console.warn(`[video-worker] 401 ${why} ip=${normIp(req.ip)}`);
    return res.status(401).json({ success: false, message: 'unauthorized' });
  };
  if (!configured()) return deny('not_configured');
  if (!allowIps().includes(normIp(req.ip))) return deny('ip');
  const m = /^Bearer ([0-9a-f]{64})$/i.exec(req.get('authorization') || '');
  if (!m) return deny('format');
  const got = crypto.createHash('sha256').update(m[1].toLowerCase()).digest();
  const want = Buffer.from(process.env.VIDEO_WORKER_TOKEN_SHA256.toLowerCase(), 'hex');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return deny('token');
  return next();
}

module.exports = { workerAuth, configured, normIp };
