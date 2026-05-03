// PlanQ structured logger — pino 기반.
//
// 정책:
//   - 운영(production)은 JSON 한 줄 (stdout) — Loki/ELK/Datadog 수집 호환
//   - 개발은 pretty 출력 (level 색상 + 타임스탬프)
//   - 기존 console.* 와 공존 — 신규 코드는 logger 사용 권장. 단계적 마이그레이션
//
// 사용:
//   const log = require('../lib/logger');
//   log.info({ user_id, business_id }, 'task created');
//   log.warn({ err }, 'pdf build failed');
//   log.error({ err, request_id: req.id }, 'unexpected');
//
// request_id: req.log (pino-http 가 주입) 사용 시 자동 포함. 또는 req.id.

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

const logger = pino({
  level,
  base: { service: 'planq-backend', env: process.env.NODE_ENV || 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization', 'req.headers.cookie',
      'password', 'password_hash', 'token', 'secret', 'otp', 'otp_hash',
      'jwt', 'refresh_token', 'api_key',
      '*.password', '*.password_hash', '*.token', '*.secret', '*.otp', '*.api_key',
    ],
    censor: '***',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
        },
      }
    : {}),
});

module.exports = logger;
