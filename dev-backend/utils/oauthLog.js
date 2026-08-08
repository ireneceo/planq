// OAuth 콜백 실패 로깅 — 단일 착지점.
//
// 왜 필요한가: 연동 실패 신고("연결했는데 안 돼")가 오면 서버에 아무 흔적이 없었다.
// 콜백의 조기 return 들이 사용자 화면에 실패 HTML 만 띄우고 끝났기 때문에, 어느 경로에서
// 끊겼는지(사용자가 동의 화면에서 취소했는지 · state 가 만료됐는지 · 멤버십이 사라졌는지)
// 를 사후에 알 방법이 없었다. 실패 사유 코드를 남기는 것이 이 모듈의 전부다.
//
// ★ 로그에 절대 넣지 않는 것 — `code`, `access_token`, `refresh_token`, `id_token`,
//   `state` 원문. (CLAUDE.md 보안 — 민감한 데이터 로깅 금지)
//   state 는 사용자·워크스페이스를 복원하는 값이라 파싱 **결과**(userId/businessId)만 남긴다.

/**
 * 로그에 넣기 전 외부 입력을 무해화한다.
 *
 * OAuth 콜백은 **비인증 공개 라우트**라 쿼리 파라미터(`?error=`)를 아무나 채울 수 있다.
 * 원문을 그대로 넣으면 개행을 섞어 가짜 로그 줄을 만들어낼 수 있다(로그 인젝션) — 실제
 * 사고가 아니라도, 사고 조사 때 읽는 로그가 조작 가능하면 조사 자체가 무의미해진다.
 */
function safeParam(value, max = 64) {
  if (value == null) return '';
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

/** 충돌 조사에 필요한 최소 식별만 남긴다 — local-part 는 첫 글자만. */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s ? '***' : '';
  return `${s[0]}***${s.slice(at)}`;
}

// 컨텍스트 화이트리스트 — 여기 없는 키는 로그에 실리지 않는다.
// 호출부가 실수로 tokens 객체를 통째로 넘겨도 새지 않게 하는 것이 목적이다.
const ALLOWED = ['userId', 'businessId', 'provider', 'native', 'scope', 'email', 'error'];

/**
 * @param {string} tag    로그 접두 (예: 'gcal callback')
 * @param {string} reason 실패 사유 코드 (예: 'oauth_denied', 'bad_state')
 * @param {object} ctx    비민감 컨텍스트 — ALLOWED 키만 채택. email 은 자동 마스킹.
 */
function logOauthFailure(tag, reason, ctx = {}) {
  const parts = [];
  for (const key of ALLOWED) {
    if (ctx[key] === undefined || ctx[key] === null || ctx[key] === '') continue;
    const val = key === 'email' ? maskEmail(ctx[key]) : safeParam(ctx[key], key === 'scope' ? 200 : 64);
    if (val === '') continue;
    parts.push(`${key}=${val}`);
  }
  console.warn('[%s] 실패 reason=%s%s', tag, reason, parts.length ? ` ${parts.join(' ')}` : '');
}

module.exports = { logOauthFailure, safeParam, maskEmail };
