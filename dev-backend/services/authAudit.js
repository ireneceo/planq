// services/authAudit.js — 로그인·로그아웃 **감사 기록의 문 하나** (docs/AUDIT_GAPS_DECISIONS.md §A)
//
// 왜: 로그인 성공·실패·로그아웃이 감사 원장에 **한 줄도 없었다**(2026-09-24 실측). «실패가 몇 번인가» 를
//   아무도 몰랐다. 호출부가 다섯 곳(/login · /register · OAuth · /logout · /refresh 재사용)이라 각자 쓰면
//   이름·모양이 갈라진다 — 그래서 여기 하나로 모은다.
// ★ `logAudit`(fire-and-forget) 이다 — **로그인 가용성이 이긴다.** 확정 원장은 이미 refresh_tokens 이고,
//   감사 행은 사람이 읽는 시간축이다. writeAudit 이면 스탬프 실패 하나가 전원 로그인 장애가 된다.
// ★ business_id 는 NULL — 계정 사건이다(사용자는 워크스페이스가 여럿). 보관은 플랫폼 티어.
// ★ 이메일·토큰·해시를 싣지 않는다. user_id 가 곧 신원이다.
// ★ **없는 이메일 실패는 행을 만들지 않는다** — 공격자가 고른 문자열로 무인증 INSERT 가 되고 계정 열거 흔적이 남는다.
//   authWarn 한 줄만(호출부).
const { logAudit } = require('./auditService');

const ua = (req) => String((req && req.headers && req.headers['user-agent']) || '').slice(0, 80);

function signInOk(req, user, { method = 'password', clientKind = null, remember = null } = {}) {
  if (!user) return;
  logAudit(req, {
    action: 'auth.login', targetType: 'User', targetId: user.id, userId: user.id, businessId: null,
    newValue: { method, client_kind: clientKind, remember, ua: ua(req) },
  });
}

/** reason: 'bad_password' | 'suspended' | 'deleted' | 'deleted_pending' | 'blocked_account' */
function signInFail(req, user, reason, { clientKind = null } = {}) {
  if (!user) return;   // 없는 계정은 여기 오지 않는다 — 와도 쓰지 않는다
  logAudit(req, {
    action: 'auth.login_failed', targetType: 'User', targetId: user.id, userId: user.id, businessId: null,
    newValue: { reason, client_kind: clientKind },
  });
}

function signOut(req, userId) {
  if (!userId) return;
  logAudit(req, { action: 'auth.logout', targetType: 'User', targetId: userId, userId, businessId: null });
}

function refreshReuse(req, userId, { revokedReason = null } = {}) {
  if (!userId) return;
  logAudit(req, {
    action: 'auth.refresh_reuse', targetType: 'User', targetId: userId, userId, businessId: null,
    newValue: { revoked_reason: revokedReason },
  });
}

module.exports = { signInOk, signInFail, signOut, refreshReuse };
