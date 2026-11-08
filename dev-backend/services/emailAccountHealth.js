/**
 * 메일 계정 건강 상태 판정 — 단일 원천.
 *
 * 왜 한 곳에 모으나:
 *   2026-07-27, 운영 `help@irenewp.com` 의 OAuth refresh token 이 7-23 부터 invalid_grant 로 죽어
 *   수신·발송이 모두 멈췄는데 **5일간 아무도 몰랐다.** 원인이 규칙이 두 벌이었던 것 —
 *     · cron(emailImapCron) 은 "인증 오류" 로 분류해 알림을 생략했고
 *     · 화면(EmailAccountSettings) 의 안내 정규식은 `invalid credentials|authenticat|login fail` 라
 *       `invalid_grant` 를 **못 잡아** 사용자에겐 의미 없는 원문만 떴다.
 *   양쪽이 서로 다른 술어를 쓰면 "cron 은 아는데 화면은 모르는" 상태가 생긴다. 술어는 하나만 둔다.
 *
 * gcal 은 같은 계열 사고를 `google_calendar.hasWriteScope` + `last_error` 로 이미 관통시켰고,
 * 이 파일은 메일 계정 쪽 대응물이다.
 */

// 사용자가 다시 인증해야 풀리는 오류들. 일시적 네트워크·타임아웃과 구분한다
// (그쪽은 재시도로 낫지만, 이쪽은 사람이 개입하기 전까지 영영 안 낫는다).
const REAUTH_PATTERNS = [
  /invalid_grant/i,              // OAuth refresh token 만료·취소 — help@ 사망 원인
  /invalid[_ ]?credentials/i,
  /authenticat/i,               // authentication failed / authenticate
  /AUTHENTICATIONFAILED/i,      // IMAP 표준 응답 코드
  /login fail/i,
  /xoauth/i,
  /unauthorized/i,
  /invalid[_ ]?token/i,
  /token.{0,20}(expired|revoked|invalid)/i,
  /app[- ]?password/i,
  /decrypt/i,                   // 저장된 자격증명 복호화 실패 — 암호화 키 회전 등
];

// 일시적 오류 — 재시도로 낫는다. 위 패턴보다 먼저 걸러 오탐을 막는다
// (예: "Too many simultaneous connections" 안에 든 단어로 인증 오류로 오분류되는 것).
const TRANSIENT_PATTERNS = [
  /too many simultaneous/i,
  /timeout|timed out/i,
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i,
  /socket|network/i,
  /temporarily unavailable|try again/i,
];

/**
 * 이 오류가 "사람이 다시 인증해야 하는" 종류인가.
 * @param {string|Error|null} err
 * @returns {boolean}
 */
function needsReauth(err) {
  const msg = String((err && err.message) || err || '');
  if (!msg) return false;
  if (TRANSIENT_PATTERNS.some((re) => re.test(msg))) return false;
  return REAUTH_PATTERNS.some((re) => re.test(msg));
}

/**
 * 재인증 방법 — 계정의 인증 방식에 따라 사용자에게 시킬 행동이 다르다.
 * OAuth 계정에 "편집에서 비밀번호를 다시 입력하세요" 라고 안내하면 사용자는 할 수 있는 게 없다
 * (실제로 help@ 화면이 그 상태였다).
 * @returns {'oauth'|'password'}
 */
function reauthKind(account) {
  return account && account.auth_type && account.auth_type !== 'password' ? 'oauth' : 'password';
}

/**
 * 계정 목록·상세 응답에 실어 보낼 건강 상태.
 * 프론트는 이 필드만 보고 배지·CTA 를 정한다(자체 정규식 금지 — 그게 이 사고의 원인이었다).
 */
function accountHealth(account) {
  const err = account && account.last_sync_error;
  const reauth = needsReauth(err);
  return {
    needs_reconnect: reauth,
    reauth_kind: reauth ? reauthKind(account) : null,
    fail_count: (account && account.fail_count) || 0,
    // 연속 실패로 재시도 간격이 늘어난 상태면 다음 시도 시각(아니면 null) — syncBackoff 한 곳
    retry_after: (account && syncBackoff(account).retryAt) || null,
  };
}

/**
 * 연속 실패한 계정의 수신 재시도 간격 — 단일 원천 (2026-11-08 서버 확장성 점검).
 *
 * 왜: dev 시험 계정 #647·#648(imap.invalid)이 **7,811번 연속 실패**하면서도 3분마다 다시 연결을 시도했다.
 *   계정이 늘면 죽은 계정 수만큼 연결·DNS·DB 쓰기가 쌓인다. 반면 «끄기»(is_active=false)로 처리하면
 *   잠깐 장애였던 살아 있는 계정이 영영 꺼져 사람이 켤 때까지 메일이 멈춘다(help@ 5일 방치와 같은 계열).
 *   그래서 끄지 않고 **간격만 늘린다** — 저절로 낫는 길은 남긴다.
 *
 * 규칙: 연속 실패 BACKOFF_AFTER(10)번까지는 그대로(3분 폴링 · IDLE 재연결).
 *   그 뒤로는 실패마다 간격 두 배(3분 → 6분 → … ) · 상한: 한 번이라도 받은 계정 6시간, 한 번도 못 받은 계정 24시간.
 *   기준 시각은 마지막 실패 기록 시각(updated_at — 실패 때마다 fail_count 와 같이 쓰인다).
 *   풀리는 문: 성공(fail_count 0) · 설정에서 받기 자격을 다시 저장/재연결(fail_count 0).
 *   IDLE(지속 연결)은 이 상태 동안 열지 않는다 — 폴링이 시도해 성공하면 다음 IDLE 정리 때 다시 연다.
 */
const BACKOFF_AFTER = 10;
const BACKOFF_BASE_MS = 3 * 60 * 1000;
const BACKOFF_CAP_SYNCED_MS = 6 * 3600 * 1000;
const BACKOFF_CAP_NEVER_MS = 24 * 3600 * 1000;

function syncBackoff(account, now = Date.now()) {
  const fails = Number((account && account.fail_count) || 0);
  if (fails < BACKOFF_AFTER) return { backoff: false, retryAt: null };
  const cap = account.last_sync_at ? BACKOFF_CAP_SYNCED_MS : BACKOFF_CAP_NEVER_MS;
  const exp = Math.min(fails - BACKOFF_AFTER, 30);          // 2^30 이상은 어차피 상한
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** exp, cap);
  const lastFailAt = new Date(account.updated_at || account.updatedAt || 0).getTime() || 0;
  const retryAt = lastFailAt + delay;
  return { backoff: true, retryAt: new Date(retryAt), due: now >= retryAt };
}

/**
 * OAuth 계정을 앱 비밀번호 방식으로 전환할 때 붙일 patch 를 만든다.
 * **호출 전제: IMAP 실연결 검증을 이미 통과했을 것.** 검증 없이 부르면 죽은 계정을 다른 방식으로
 * 죽여놓는 셈이 된다.
 *
 * 왜 필요한가: 구글 앱 심사 전까지 원클릭 재연결 버튼이 숨겨져 있어(GMAIL_ONECLICK_ENABLED=false),
 * refresh token 이 죽은 OAuth 계정은 화면에서 되살릴 방법이 아예 없었다.
 * (2026-07-27 help@irenewp.com — 7-23 invalid_grant 이후 수신·발송 동반 사망, 5일 방치)
 *
 * @param {object} acc    현재 계정 인스턴스
 * @param {object} body   요청 body
 * @param {object} patch  지금까지 만들어진 patch (imap_* 가 이미 반영돼 있을 수 있음)
 * @returns {object}      patch 에 합칠 필드들 (전환 대상이 아니면 빈 객체)
 */
function oauthToPasswordPatch(acc, body, patch) {
  if (!acc || !acc.auth_type || acc.auth_type === 'password') return {};
  const b = body || {};
  const p = patch || {};
  const out = {
    auth_type: 'password',
    // 죽은 토큰을 남겨두면 발송 경로가 계속 XOAUTH2 를 시도한다.
    oauth_access_token_encrypted: null,
    oauth_refresh_token_encrypted: null,
    oauth_expires_at: null,
    oauth_scope: null,
  };
  // SMTP 비밀번호를 따로 안 줬으면 IMAP 것을 쓴다. 앱 비밀번호는 IMAP·SMTP 공용이고,
  //   이걸 안 채우면 "받기는 되는데 발송이 안 되는" 상태가 그대로 재현된다(Irene 이 겪은 증상).
  if (!b.smtp_password && !acc.smtp_password_encrypted) {
    out.smtp_password_encrypted = p.imap_password_encrypted || acc.imap_password_encrypted;
  }
  if (!b.smtp_username && !acc.smtp_username) out.smtp_username = p.imap_username || acc.imap_username;
  return out;
}

module.exports = {
  needsReauth, reauthKind, accountHealth, oauthToPasswordPatch, syncBackoff, BACKOFF_AFTER,
  REAUTH_PATTERNS, TRANSIENT_PATTERNS,
};
