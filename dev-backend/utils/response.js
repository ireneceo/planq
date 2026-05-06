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

module.exports = { successResponse, errorResponse };
