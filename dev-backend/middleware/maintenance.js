// 점검 모드 미들웨어 (2026-05-05)
// platform_settings.maintenance_mode=true 면 platform_admin 외 모든 요청 503.
// /api/health, /api/auth/login (admin 로그인 가능하게), /api/admin/* (admin UI) 는 통과.
//
// 캐시 — 5분 또는 admin UI 가 PUT 후 invalidate.

let _cache = { mode: false, message: null, fetchedAt: 0 };
const CACHE_MS = 60 * 1000; // 1분

async function getMaintenance() {
  if (_cache.fetchedAt + CACHE_MS > Date.now()) return _cache;
  try {
    const { PlatformSetting } = require('../models');
    const ps = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
    _cache = {
      mode: !!ps?.maintenance_mode,
      message: ps?.maintenance_message || null,
      fetchedAt: Date.now(),
    };
  } catch { /* fallback false */ }
  return _cache;
}

function invalidateMaintenanceCache() {
  _cache = { mode: false, message: null, fetchedAt: 0 };
}

const ALLOW_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/admin',  // admin 라우트는 모두 통과 (platform_admin 검증은 라우트가 함)
];

async function maintenanceMiddleware(req, res, next) {
  // 정적 자산 통과
  if (!req.path.startsWith('/api/')) return next();
  // ALLOW_PATHS prefix 매칭
  for (const p of ALLOW_PATHS) {
    if (req.path === p || req.path.startsWith(p + '/')) return next();
  }
  const m = await getMaintenance();
  if (!m.mode) return next();
  // platform_admin 토큰이면 통과 — JWT 빠르게 디코드
  try {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
      const { User } = require('../models');
      const user = await User.findByPk(decoded.userId || decoded.id, { attributes: ['platform_role'] });
      if (user?.platform_role === 'platform_admin') return next();
    }
  } catch { /* fall through */ }
  // 점검 중 응답
  return res.status(503).json({
    success: false,
    message: 'maintenance_mode',
    maintenance_message: m.message || '시스템 점검 중입니다. 잠시 후 다시 시도해주세요.',
  });
}

module.exports = { maintenanceMiddleware, invalidateMaintenanceCache };
