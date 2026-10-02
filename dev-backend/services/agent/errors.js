// AI 에이전트 도구 — 오류 봉투 (#439, 설계 §6.1).
//
//   도구 결과로 돌려준다(프로토콜 오류로 던지지 않는다) — 모델이 읽고 사용자에게 묻거나 다시 시도해야 하기 때문.
//   code 는 provider 와 무관하다. 행동 계층의 code(task_not_found·menu_forbidden:* …)를 여기 한 곳에서 번역한다.
const CODES = ['NOT_FOUND', 'MULTIPLE_MATCHES', 'PERMISSION_DENIED', 'VALIDATION_ERROR', 'AUTH_REQUIRED',
  'CONFIRMATION_REQUIRED', 'CONFLICT', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'INTERNAL'];

class AgentError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code);
    this.code = CODES.includes(code) ? code : 'INTERNAL';
    this.extra = extra;
  }
}

const err = (code, message, extra) => new AgentError(code, message, extra);

/** 행동 계층 실패 { ok:false, code, http } → 봉투 code */
function fromActionFailure(r) {
  const c = String(r?.code || '');
  if (/not_found|invalid_task|invalid_project|invalid_client/.test(c)) return err('NOT_FOUND', c);
  if (/^forbidden|menu_forbidden|cannot_assign|only_|forbidden_fields|not_allowed|members_only/.test(c) || r?.http === 403) {
    return err('PERMISSION_DENIED', c);
  }
  if (/closed|on_hold|not_ready|no_reviewers|conflict/.test(c)) return err('CONFLICT', c);
  if (/quota|usage_limit/.test(c)) return err('QUOTA_EXCEEDED', c);
  if (/required|invalid|too_long|date/.test(c) || r?.http === 400) return err('VALIDATION_ERROR', c);
  return err('INTERNAL', c);
}

function envelope(e, requestId) {
  if (e instanceof AgentError) {
    return { ok: false, error: { code: e.code, message: e.message, ...e.extra } };
  }
  return { ok: false, error: { code: 'INTERNAL', message: 'internal error', request_id: requestId || null } };
}

module.exports = { AgentError, err, fromActionFailure, envelope, CODES };
