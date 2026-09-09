/**
 * secretMask — LLM 프롬프트로 나가기 전에 **비밀값처럼 보이는 것**을 가린다 (#407, 2026-09-09)
 *
 *   Irene(#407): "채팅에서 비번과 같은 중요내용 보내면 어떻게 보안처리 해?
 *                 절대 공유되서 문제되는 일 없게 개발된 거 맞아?"
 *
 * ★ 정직하게: 이것은 **채팅을 비밀번호 보관소로 만드는 장치가 아니다.**
 *   저장은 여전히 평문이고 워크스페이스 멤버는 그 대화방을 읽는다.
 *   이 함수가 막는 것은 딱 하나 — **외부 LLM 프롬프트로 나가는 것**이다.
 *   진짜 비밀은 Q info 의 secret 항목에 둔다(값 가림·CSV 제외·검색 제외).
 *
 * ★ 설계 원칙: 넓게 잡고, **가렸다는 사실을 프롬프트에 밝힌다.**
 *   오탐(멀쩡한 문장을 가림)은 답변 품질만 깎지만 **미탐은 유출**이다.
 *   그리고 가린 것을 안 밝히면 모델이 "○○○" 를 값으로 읽고 답에 옮겨 적는다.
 *
 * ★ 한계 (덮어두지 않는다):
 *   · 이미지 안 비밀번호, 첨부파일 내용은 이 경로로 안 지나가므로 여기서 못 막는다
 *   · "우리 서버 비번은 사무실 이름 + 1234" 같은 **서술형**은 못 잡는다
 *   · base64 로 인코딩해 붙여넣으면 길이 규칙에만 걸린다
 */

const MASK = '[비밀값 가림]';

// 라벨 뒤에 오는 값 — "비밀번호: xxxx", "pw = xxxx", "OTP 123456"
const LABELED = new RegExp(
  '(비밀번호|비번|패스워드|암호|계정정보|인증번호|인증 코드|보안코드|핀번호|'
  + 'password|passwd|passphrase|secret|api[ _-]?key|token|otp|pin|credential)'
  + '\\s*[:=]?\\s*["\'\\u201c]?([^\\s"\'\\u201d\\n]{4,})',
  'gi',
);

// 알려진 키 접두사 — 값 자체가 곧 비밀
const KEY_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,              // OpenAI 계열
  /\bghp_[A-Za-z0-9]{20,}/g,               // GitHub
  /\bAKIA[0-9A-Z]{12,}/g,                  // AWS access key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,       // Slack
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,  // Authorization 헤더 통째 붙여넣기
  /\bhttps?:\/\/[^\s/]+:[^\s/@]+@[^\s]+/gi, // URL 안 자격증명
];

// 번호류 — 카드번호(13~19자리, 구분자 허용) · 주민등록번호
const NUMERIC = [
  /\b(?:\d[ -]?){13,19}\b/g,
  /\b\d{6}\s*[-–]\s*[1-4]\d{6}\b/g,
];

/**
 * @param {string} text
 * @returns {{ text: string, masked: number }} 가린 개수까지 돌려준다 —
 *   호출부가 "가렸다" 를 프롬프트에 적으려면 이 숫자가 필요하다.
 */
function maskSecrets(text) {
  if (!text || typeof text !== 'string') return { text: text || '', masked: 0 };
  let out = text;
  let n = 0;
  const bump = () => { n += 1; return MASK; };

  // ① 라벨 + 값 — 라벨은 남기고 **값만** 가린다(무슨 얘기였는지는 모델이 알아야 한다)
  out = out.replace(LABELED, (_m, label) => { n += 1; return `${label}: ${MASK}`; });
  // ② 모양만으로 비밀인 것
  for (const re of KEY_SHAPES) out = out.replace(re, bump);
  // ③ 번호류
  for (const re of NUMERIC) out = out.replace(re, bump);
  return { text: out, masked: n };
}

/** 여러 줄을 한 번에 — 가린 총 개수를 같이 준다. */
function maskAll(texts) {
  let masked = 0;
  const list = texts.map((t) => {
    const r = maskSecrets(t);
    masked += r.masked;
    return r.text;
  });
  return { list, masked };
}

/** 프롬프트에 붙일 안내 — 가린 게 있을 때만. 없으면 빈 문자열(잡음 금지). */
function maskNotice(masked) {
  if (!masked) return '';
  return `\n> ※ 위 대화에서 비밀번호·키로 보이는 값 ${masked}건을 ${MASK} 로 가렸습니다.`
    + ' 그 값을 추측하거나 되묻지 말고, 필요하면 사용자에게 안전한 곳(Q info 의 비밀 항목)에 두라고 안내하세요.';
}

module.exports = { maskSecrets, maskAll, maskNotice, MASK };
