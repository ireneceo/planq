// 울타리 **밖**(메일·푸시)으로 내보낼 본문을 만든다.
//
// ★ 2026-09-20 — 규칙을 `routes/notifications.js` 안에 두면 검사할 수가 없다(라우트를 부르면
//   실제 발송이 일어난다). 순수 함수로 빼서 그 자리에서 참/거짓을 가린다.
//
// 정책 셋:
//   · default        — 본문 그대로
//   · internal_only  — 중립 문구 (본문은 우리 울타리 안에만) — 근태·게스트·보류 사유
//   · excerpt        — **앞 40자만** — 채팅 (Irene 2026-09-20: "보통 3번 아니야?")
//
// #407 은 «비밀번호 한 줄이 Apple/Google 푸시 서버와 잠금화면에 평문으로 남는다» 는 이유로
// 채팅 본문을 통째로 가렸다. 그 걱정은 **긴 내용·붙여넣은 값**에 대한 것이고, «누가 무슨 얘기인지»
// 까지 가리면 알림이 쓸모를 잃는다(모바일에서 «새 메시지를 확인하세요» 만 떴다). 40자가 그 가운데다.

/** 잠금화면 한 줄에 들어가는 정도. */
const EXCERPT_LEN = 40;

const NEUTRAL = {
  ko: 'PlanQ 에서 내용을 확인하세요.',
  en: 'Open PlanQ to read it.',
};

/**
 * @param {string} body 인앱에 남는 원문
 * @param {'internal_only'|'excerpt'|undefined} policy
 * @param {'ko'|'en'} lang
 * @returns {string} 밖으로 나갈 본문
 */
function outsideBodyFor(body, policy, lang) {
  const neutral = NEUTRAL[lang === 'en' ? 'en' : 'ko'];
  if (policy === 'internal_only') return neutral;
  if (policy === 'excerpt') {
    // ★ 줄바꿈을 공백으로 눕힌다 — 잠금화면은 한 줄이라 개행이 있으면 뒤가 통째로 안 보인다.
    const flat = String(body || '').replace(/\s+/g, ' ').trim();
    if (!flat) return neutral;                       // 첨부만 있는 메시지 등
    return flat.length > EXCERPT_LEN ? flat.slice(0, EXCERPT_LEN) + '…' : flat;
  }
  return body;
}

module.exports = { outsideBodyFor, EXCERPT_LEN, NEUTRAL };
