const crypto = require('crypto');
const logger = require('../lib/logger');

// 모든 요청에 request_id 부여 — 사용자 신고 → 로그 매칭용. response 헤더에도 노출.
const requestIdMiddleware = (req, res, next) => {
  // 클라이언트가 X-Request-Id 보내면 그대로 사용 (E2E 추적), 없으면 생성
  const incoming = req.headers['x-request-id'];
  req.id = (incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming))
    ? incoming
    : crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
};

const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  const response = { success: true, data };
  if (message && message !== 'Success') response.message = message;
  return res.status(statusCode).json(response);
};

const errorResponse = (res, message = 'Internal server error', statusCode = 500, code = null) => {
  const response = { success: false, message };
  if (code) response.code = code;
  if (res.req?.id) response.request_id = res.req.id;
  return res.status(statusCode).json(response);
};

// 사이클 N+50 — pagination 표준 헬퍼 (utils/response.js 와 같은 시그니처)
// 정책: list 라우트 unbounded 응답 차단. 기본 200 / max 500. ?page= / ?offset= 둘 다 지원
function parsePagination(req, { defaultLimit = 200, maxLimit = 500 } = {}) {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;
  const rawOffset = req.query.offset;
  let offset;
  let page;
  if (rawOffset !== undefined && rawOffset !== '') {
    offset = Math.max(Number(rawOffset) || 0, 0);
    page = Math.floor(offset / limit) + 1;
  } else {
    page = Math.max(Number(req.query.page) || 1, 1);
    offset = (page - 1) * limit;
  }
  return { limit, page, offset };
}

function paginatedResponse(res, data, total, { limit, page, offset }, statusCode = 200) {
  const arrLen = Array.isArray(data) ? data.length : 0;
  return res.status(statusCode).json({
    success: true,
    data,
    pagination: {
      total: Number(total) || 0,
      limit,
      page,
      offset,
      has_more: (offset + arrLen) < (Number(total) || 0),
    },
  });
}

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || null;

  if (err.name === 'SequelizeValidationError') {
    statusCode = 400;
    message = err.errors.map(e => e.message).join(', ');
    code = 'ERR_VALIDATION';
  } else if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    message = 'Resource already exists';
    code = 'ERR_DUPLICATE';
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    statusCode = 400;
    message = 'Invalid reference to related resource';
    code = 'ERR_FK';
  }

  // structured log — 5xx 만 error level (운영 alert), 4xx 는 warn (사용자 입력 문제)
  const logPayload = {
    request_id: req.id,
    method: req.method,
    url: req.originalUrl,
    status: statusCode,
    user_id: req.user?.id,
    business_id: req.businessId,
    err_name: err.name,
    err_message: err.message,
  };
  if (statusCode >= 500) {
    logger.error({ ...logPayload, stack: err.stack }, 'unhandled error');
  } else {
    logger.warn(logPayload, 'request error');
  }

  // 운영에서 5xx 의 본문 메시지는 노출 X (정보 유출 방지). request_id 만 응답
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
  }

  const body = { success: false, message, request_id: req.id };
  if (code) body.code = code;
  return res.status(statusCode).json(body);
};

module.exports = { successResponse, errorResponse, errorHandler, requestIdMiddleware, parsePagination, paginatedResponse };
