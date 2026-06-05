/**
 * PlanQ 보안 미들웨어 모음
 * POS 동일 수준: Helmet, CORS, Rate Limiting, SSRF, CSP, SQL Injection, Security Headers, Cookie
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// ============================================
// SSRF 방어
// ============================================

const ALLOWED_EXTERNAL_DOMAINS = [];

const isInternalIP = (hostname) => {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/
  ];
  return privateRanges.some(range => range.test(hostname));
};

const validateExternalUrl = (targetUrl) => {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:') {
      return { valid: false, reason: 'Only HTTPS URLs are allowed' };
    }
    if (isInternalIP(parsed.hostname)) {
      return { valid: false, reason: 'Internal IP addresses are not allowed' };
    }
    if (ALLOWED_EXTERNAL_DOMAINS.length > 0) {
      const isAllowed = ALLOWED_EXTERNAL_DOMAINS.some(domain =>
        parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
      );
      if (!isAllowed) {
        return { valid: false, reason: 'Domain not in allowed list' };
      }
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, reason: 'Invalid URL format' };
  }
};

const ssrfProtection = (req, res, next) => {
  const urlParams = ['url', 'redirect', 'callback', 'return_url', 'next'];
  for (const param of urlParams) {
    const value = req.body?.[param] || req.query?.[param];
    if (value) {
      const validation = validateExternalUrl(value);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: `Invalid URL parameter: ${param}`
        });
      }
    }
  }
  next();
};

// ============================================
// Cookie 보안 설정
// ============================================

// 일반 cookie 옵션 헬퍼 (현재 미사용이지만 export 됨 — 추후 사용 시 안전한 default).
// sameSite='lax' — iOS PWA standalone / Safari ITP 호환성. same-origin POST 는 그대로 보냄.
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/'
};

// ============================================
// 추가 보안 헤더
// ============================================

const securityHeaders = (req, res, next) => {
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // API 응답은 캐시 금지
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
};

// ============================================
// CSP 설정 (Content Security Policy)
// ============================================

const cspMiddleware = (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  // script-src: 번들 JS 만 허용 (Vite 빌드는 인라인 스크립트 없음) → 'unsafe-inline' 제거로 XSS 방어 강화
  // style-src: styled-components 런타임이 <style> 태그를 주입하므로 'unsafe-inline' 유지 불가피
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' wss:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  next();
};

// ============================================
// SQL Injection 패턴 감지 (추가 방어층)
// ============================================

// 주의: Sequelize parameterized query 가 실제 SQL injection 방어층이다. 이 문자열 패턴 검사는
// 부가 방어일 뿐이라, 사용자가 정상 제출하는 산문/마크다운/AI 지식 콘텐츠를 오탐하지 않도록
// "고신뢰 주입 시그니처"만 좁게 잡는다.
//   ❌ 제거된 오탐원: `-- ` (마크다운 수평선 `---\n`·산문 하이픈), `select … from` 근접(영어 산문)
//   ✅ 유지: union select / or 1=1 / 따옴표 인접 tautology / 스택 DDL / exec sp_·xp_
const sqlInjectionPatterns = [
  /\bunion\s+(all\s+)?select\b/i,                          // UNION [ALL] SELECT — 산문 빈도 0
  /\bor\s+1\s*=\s*1\b/i,                                    // OR 1=1 tautology
  /(\%27|')\s*(or|and)\s+(\%27|'|\d)/i,                     // ' OR ' / ' AND 1 (따옴표 인접)
  /(\%3B|;)\s*(drop|delete|truncate|alter)\s+\w/i,          // ; DROP/DELETE/… 스택 쿼리
  /exec(\s|\+)+(s|x)p\w+/i                                  // exec sp_/xp_
];

const sqlInjectionProtection = (req, res, next) => {
  const checkValue = (value, path) => {
    if (typeof value === 'string') {
      for (const pattern of sqlInjectionPatterns) {
        if (pattern.test(value)) {
          console.warn(`[SECURITY] Potential SQL injection detected at ${path}: ${value.substring(0, 50)}`);
          return true;
        }
      }
    }
    return false;
  };

  for (const [key, value] of Object.entries(req.query)) {
    if (checkValue(value, `query.${key}`)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid characters detected in request'
      });
    }
  }

  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (checkValue(value, `body.${key}`)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid characters detected in request'
        });
      }
    }
  }

  next();
};

// ============================================
// 메인 Security 설정
// ============================================

const setupSecurity = (app) => {
  // Helmet
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // 추가 보안 헤더
  app.use(securityHeaders);

  // CSP
  app.use(cspMiddleware);

  // CORS
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    // X-Client-Kind: PWA standalone vs 데스크탑 브라우저 구분 (refresh_token TTL 결정).
    //                 누락 시 모든 디바이스가 'web' (30d) 으로 처리되어 PWA 365d 미적용.
    // X-Internal-Api-Key: Q Note (Python) → Node 내부 호출용. CORS 통과 필요.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Kind', 'X-Internal-Api-Key']
  }));

  // Rate Limiting — 전체 API
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: 100,
    message: { success: false, message: 'Too many requests, please try again later' }
  });
  app.use('/api/', apiLimiter);

  // Rate Limiting — 로그인
  // dev 환경의 테스트 계정(5종)은 화이트리스트로 skip — 퀵로그인 UX가 브루트포스 제한에 막히지 않도록.
  // 프로덕션에서는 동일 이메일에도 제한이 그대로 적용됨(test.planq.kr 도메인이 프로덕션에 존재하지 않음).
  const DEV_TEST_EMAILS = new Set([
    'admin@test.planq.kr',
    'owner@test.planq.kr',
    'member1@test.planq.kr',
    'member2@test.planq.kr',
    'client@test.planq.kr',
  ]);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 5,
    message: { success: false, message: 'Too many login attempts, please try again later' },
    skip: (req) => {
      const email = req.body?.email;
      return typeof email === 'string' && DEV_TEST_EMAILS.has(email.toLowerCase());
    },
  });
  app.use('/api/auth/login', loginLimiter);

  // Rate Limiting — 회원가입
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1시간
    max: 3,
    message: { success: false, message: 'Too many registration attempts' }
  });
  app.use('/api/auth/register', registerLimiter);

  // Rate Limiting — 비밀번호 재설정
  const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1시간
    max: 3,
    message: { success: false, message: 'Too many password reset requests' }
  });
  app.use('/api/auth/forgot-password', forgotPasswordLimiter);

  // Rate Limiting — 파일 업로드
  const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: 10,
    message: { success: false, message: 'Too many upload requests' }
  });
  app.use('/api/files', uploadLimiter);
  app.use('/api/messages/*/attachments', uploadLimiter);

  // SSRF 방어
  app.use(ssrfProtection);

  // SQL Injection 패턴 감지
  app.use(sqlInjectionProtection);
};

module.exports = {
  setupSecurity,
  ssrfProtection,
  validateExternalUrl,
  isInternalIP,
  cookieOptions,
  securityHeaders,
  cspMiddleware,
  sqlInjectionProtection
};
