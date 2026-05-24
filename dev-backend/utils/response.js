// utils/response.js — 표준 응답 헬퍼
//
// CLAUDE.md API 응답 형식 표준 (success/data/message) + 호출자 편의를 위한
// errorResponse 의 첫 인자(code) 와 extra 객체를 자유롭게 받는다.
//
// 사용:
//   successResponse(res, data)
//   successResponse(res, data, 'Created', 201)
//   errorResponse(res, 'forbidden', 403)
//   errorResponse(res, 'invalid_week', 400, { message: 'Cannot finalize future week' })
//   paginatedResponse(res, rows, total, { limit, page, offset })
//   const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });

function successResponse(res, data = null, message, status = 200) {
  const body = { success: true, data };
  if (message) body.message = message;
  return res.status(status).json(body);
}

function errorResponse(res, codeOrMessage, status = 400, extra = {}) {
  const body = {
    success: false,
    code: codeOrMessage,
    message: extra.message || codeOrMessage,
    ...extra,
  };
  return res.status(status).json(body);
}

// 사이클 N+50 — pagination 표준 헬퍼
// SaaS readiness: list 라우트 unbounded 응답 차단.
// 정책:
//   - 기본 limit 보수적 (default 200, max 500). 라우트별 조정 가능
//   - page 1-base / offset 둘 다 지원 (offset 우선)
//   - 응답: `data` 배열 그대로 + `pagination: { page, limit, offset, total }` 추가
//   - frontend 가 ?page= 를 안 보내도 첫 페이지 (가장 최신 N개) 응답 → 점진 opt-in
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

function paginatedResponse(res, data, total, { limit, page, offset }, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    pagination: {
      total: Number(total) || 0,
      limit,
      page,
      offset,
      has_more: (offset + (Array.isArray(data) ? data.length : 0)) < (Number(total) || 0),
    },
  });
}

module.exports = { successResponse, errorResponse, parsePagination, paginatedResponse };
