// utils/userFields.js — 사용자 응답에서 **절대 나가면 안 되는 컬럼** 한 벌.
//
// ★ 여기 하나만 쓴다. 목록을 곳곳에 손으로 적어 두면 반드시 갈라진다 — 실제로 갈라져 있었다
//   (2026-09-02 보안감사): `routes/auth.js` 는 **존재하지 않는 옛 컬럼명**(`reset_token`)을 가리켜
//   실제 컬럼인 `password_reset_token`·`email_verify_token`·`*_otp_hash` 가 로그인 응답에 그대로
//   실렸고, `routes/users.js`·`routes/admin.js` 는 또 서로 다른 목록을 쓰고 있었다.
//   (본인 것만 나가므로 타인 탈취는 아니지만, XSS 가 나면 그 자리에서 계정 인수 재료가 된다.)
//
// 컬럼을 새로 만들면 **여기에 먼저 올린다.** 이름에 token/otp/hash/secret 이 들어가면 후보다.
const USER_SENSITIVE_FIELDS = [
  'password_hash',
  'refresh_token',
  // 비밀번호 재설정 (옛 이름과 현재 이름 둘 다 컬럼이 살아 있다)
  'reset_token', 'reset_token_expires',
  'password_reset_token', 'password_reset_expires',
  // 이메일 인증 · 변경 · 보조 이메일 OTP
  'email_verify_token', 'email_verify_expires',
  'email_change_otp_hash', 'email_change_otp_expires_at', 'email_change_otp_attempts',
  'secondary_email_otp_hash', 'secondary_email_otp_expires_at', 'secondary_email_otp_attempts',
];

module.exports = { USER_SENSITIVE_FIELDS };
