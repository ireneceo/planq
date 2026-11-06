// 공용 메일 도메인(gmail·naver …) — 한 벌. 메일 도메인 규칙(routes/mail_aliases)과 워크스페이스 참여 도메인
//   (services/joinPolicy)이 같이 쓴다(복사 금지 — 2026-11-06 docs/SIGNUP_START_JOIN_DESIGN.md §6-2).
//   이 도메인은 «회사» 를 뜻하지 않는다 — 규칙·참여를 열면 그 제공자를 쓰는 모든 사람에게 열린다.
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me', 'nate.com',
]);

module.exports = { PUBLIC_MAIL_DOMAINS };
