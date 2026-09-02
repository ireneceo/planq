/**
 * PlanQ 보안 미들웨어 모음
 * POS 동일 수준: Helmet, CORS, Rate Limiting, SSRF, CSP, SQL Injection, Security Headers, Cookie
 */

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');

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
  // ★ SAMEORIGIN — DENY 로 두면 앱이 **자기 화면**을 못 띄운다:
  //   ① 핀 PiP 가 현재 경로를 iframe 으로 연다 (utils/pinHost.ts:538)
  //   ② 공개 파일 공유 페이지가 `/api/files/public/by-token/:token/download?inline=1` 을
  //      iframe 으로 띄워 PDF 를 미리 본다 (PublicFilePage.tsx:108) — DENY 면 고객 화면에서 빈칸
  //   타 origin 클릭재킹 방어는 SAMEORIGIN + CSP frame-ancestors 'self' 로 그대로 유지된다.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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

  // ★ 이 값은 nginx snippet(/etc/nginx/snippets/planq-security-headers.conf)과 **같은 값**이다.
  //   화면(HTML)은 nginx 가 직접 서빙하므로 실제로 적용되는 것은 그쪽이고, 여기는 backend 가
  //   HTML 을 직접 내는 경로(share bot OG SSR·공개 페이지 proxy)에 붙는다. 두 벌이 갈라지면
  //   같은 화면이 경로에 따라 다른 정책을 받는다 — 바꿀 때는 scripts/apply-nginx-security-headers.sh 도 같이.
  //   ★ frame-src 를 'none' 으로 두지 말 것 — PDF 미리보기가 blob: iframe(utils/download.ts),
  //     메일 본문이 srcDoc iframe 이라 둘 다 죽는다(2026-09-02 실측).
  //   ★ frame-ancestors 도 'none' 금지 — 핀 PiP 가 앱 자신을 iframe 으로 띄운다(pinHost.ts:538).
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "connect-src 'self' blob: https: wss:",
    "frame-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
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
  //   인증 사용자는 user 별 버킷(사무실 공용 IP NAT 충돌 방지 — 옛 IP 키는 한 팀이 한 버킷을
  //   공유해 정상 사용 중에도 막히던 회귀), 미인증은 IP 별. 캡은 인증 SPA(대시보드·실시간·폴링·
  //   멀티탭)가 정상 사용 중 막히지 않도록 600/분 으로 상향(옛 100/분 은 정상 트래픽도 차단).
  // 이미지 서빙 경로 — API 버킷에서 빼고 별도 버킷으로 센다(아래 imageLimiter).
  //   ★ apiLimiter 의 skip 이 이걸 참조하므로 **위에 둔다** — 아래에 두면 TDZ 다(프로젝트 전례).
  // ★ 2026-09-01 — 이미지 서빙 경로는 **이미지 버킷**으로 보낸다.
  //   editor-image(Q docs 본문)와 채팅 이미지가 여태 일반 API 버킷(분당 한도)을 태우고 있었다.
  //   이미지 많은 문서·채팅방을 열면 그 한 번으로 한도를 소진해 429 가 나고,
  //   토큰 갱신까지 429 가 되면 로그아웃으로 이어진다(옛 회귀와 같은 계열).
  const IMAGE_PATHS = [
    '/api/files/public-image',
    '/api/tasks/public/attach',
    '/api/posts/editor-image',
    '/api/message-attachments/public',
  ];
  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        try {
          const p = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
          // #244 — access token payload 는 `{ userId, email }` 이다. 여태 `p.id` 를 봤기 때문에
          //   **항상 undefined → 언제나 IP 폴백**이었다. 즉 "user 별 버킷" 설계가 침묵 상태로 죽어
          //   사무실 공용 IP 한 팀이 600/분 버킷을 통째로 공유하고 있었다 (NAT 충돌 회귀 미해소).
          //   generateAccessToken(routes/auth.js) 의 payload 와 대조해 확정.
          if (p && p.userId) return `u${p.userId}`;
        } catch { /* 만료/위조 → IP fallback */ }
      }
      return ipKeyGenerator(req.ip);
    },
    // ★ 이미지 서빙은 이 버킷에서 뺀다. app.use 로 앞에 다른 limiter 를 걸어도 **연쇄 실행**이라
    //   여기서 또 세면 예산은 그대로 탄다 — 반드시 skip 으로 빼야 실제로 분리된다.
    // ★ GET 만 뺀다. 경로만 보고 빼면 **같은 경로의 POST(업로드)까지 면제**된다 —
    //   `POST /api/posts/editor-image` 는 파일을 쓰는 라우트인데 한도가 600 → 3000 으로
    //   풀려 버렸다(Fable 실측). 읽기는 <img> 가 만드는 정적 트래픽이라 빼는 것이 맞지만,
    //   쓰기는 일반 API 예산 안에 있어야 한다.
    skip: (req) => req.method === 'GET' && IMAGE_PATHS.some((ip) => (req.originalUrl || '').startsWith(ip)),
    message: { success: false, message: 'Too many requests, please try again later' }
  });
  // ── 이미지 서빙은 **별도 버킷** ────────────────────────────────────────────
  //   왜: 썸네일은 "API 호출" 이 아니라 <img> 태그가 만드는 정적 읽기다. 그런데 같은 버킷을 쓰면
  //   목록 한 화면이 그것만으로 예산을 태운다 — 운영 실측: /files 한 번 열면 API 요청 1,099건
  //   이고 그중 ~1,000건이 이 경로다. 한도가 600/분이니 **파일 화면을 한 번 여는 것만으로
  //   그 사용자가 잠기고**, 그 상태로 새로고침하면 /api/auth/refresh 가 429 를 받아
  //   로그인 화면으로 튕긴다(검증 중 세 번 재현).
  //   프론트는 뷰포트에 들어온 썸네일만 받도록 고쳤지만(loading="lazy"), 스크롤이 길면 여전히
  //   수백 장이다. **면제가 아니라 분리**다 — 남용 방지는 그대로 두고 버킷만 나눈다.
  //   미인증 공개 경로라 키는 IP 폴백이 된다(사무실 공용 IP 공유) → 캡을 넉넉히 잡는다.
  const imageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        try {
          const p = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
          if (p && p.userId) return `img-u${p.userId}`;
        } catch { /* fallback */ }
      }
      return 'img-' + ipKeyGenerator(req.ip);
    },
    message: { success: false, message: 'Too many image requests, please try again later' },
  });
  for (const p of IMAGE_PATHS) app.use(p, imageLimiter);

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
    max: 8,
    standardHeaders: true,
    legacyHeaders: false,
    // 성공한 로그인은 카운트 제외 — 정상 로그인/다기기 재로그인으로 잠기지 않게. 실패(브루트포스)만 집계.
    skipSuccessfulRequests: true,
    message: { success: false, message: 'Too many login attempts, please try again later' },
    skip: (req) => {
      const email = req.body?.email;
      return typeof email === 'string' && DEV_TEST_EMAILS.has(email.toLowerCase());
    },
  });
  app.use('/api/auth/login', loginLimiter);
  // 탈퇴 복구도 비밀번호 브루트포스 대상 — login 과 동일 limiter 적용 (Fable 🟠2).
  app.use('/api/auth/deletion-recover', loginLimiter);

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

  // 파일 업로드 rate-limit 은 routes/files.js POST /:businessId 라우트 내부 per-user 로 이관 (#228).
  //   여기 있던 app.use('/api/files', 10/분·IP) 는 **서브트리 전체**에 걸려서 업로드가 아닌
  //   조회·다운로드·미리보기까지 막고 있었다 (실측: 인증 다운로드 11번째에 429). IP 버킷이라
  //   사무실 NAT 을 한 통에 담았다. 인증 SPA 는 user 버킷 + 여유 캡이 표준이다.
  // message/task 첨부 업로드 rate-limit 은 각 라우트 파일 내부에서 per-user 로 적용한다.
  //   (옛 '/api/messages/*/attachments' 경로 패턴은 실제 마운트('/api/message-attachments')와 불일치해
  //    어떤 요청과도 매칭 안 되는 죽은 코드였음 — 비용폭탄 H3/H4에서 라우트 내부 limiter 로 대체.)

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
