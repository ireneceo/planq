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

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7일 (Refresh Token)
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

// 주의: 단일 문자 `#`/`'` 는 hex 컬러·피드백 문구 등 정상 사용 빈도가 높아 차단에서 제외한다.
// Parameterized query(Sequelize) 기준에서 SQL injection 의 실제 위험 패턴만 잡는다.
const sqlInjectionPatterns = [
  /(\%27)|(\-\-\s)/i,                                       // '-- ' (주석 직전 공백 동반) 또는 URL 인코딩 '
  /(\%3D)|(=)[^\s]*((\%27)|(\'))\s*(or|and)\s+/i,           // = 'xxx' OR 형태
  /\b(union|select|insert|update|delete|drop|exec)\b[\s\S]{0,10}\b(from|into|table|select)\b/i,
  /\bor\s+1\s*=\s*1\b/i,
  /exec(\s|\+)+(s|x)p\w+/i
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
    allowedHeaders: ['Content-Type', 'Authorization']
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
