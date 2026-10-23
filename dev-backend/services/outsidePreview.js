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

// 글이 빈 채팅 메시지의 폴백 — 첨부 종류를 알면 attachmentBody 가 먼저 쓰인다.
const EMPTY_MESSAGE = {
  ko: '새 메시지가 도착했습니다',
  en: 'New message',
};

/**
 * 첨부만 보낸 채팅의 알림 본문 — «이미지가 첨부되었습니다» / «파일 3개가 첨부되었습니다».
 *   첨부는 메시지를 만든 **뒤에** 올라가서 알림 순간 서버는 첨부를 모른다 → 보내는 화면이 종류·개수를 같이 싣는다.
 *   kind 는 image|file 만, count 는 1~50 으로 자른다. 모르는 kind 면 null(호출부가 폴백을 쓴다).
 * @returns {string|null}
 */
function attachmentBody(kind, count, lang) {
  if (kind !== 'image' && kind !== 'file') return null;
  let n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > 50) n = 50;
  const en = lang === 'en';
  if (kind === 'image') {
    if (n === 1) return en ? 'An image was attached' : '이미지가 첨부되었습니다';
    return en ? `${n} images were attached` : `이미지 ${n}개가 첨부되었습니다`;
  }
  if (n === 1) return en ? 'A file was attached' : '파일이 첨부되었습니다';
  return en ? `${n} files were attached` : `파일 ${n}개가 첨부되었습니다`;
}

/**
 * @param {string} body 인앱에 남는 원문
 * @param {'internal_only'|'excerpt'|undefined} policy
 * @param {'ko'|'en'} lang
 * @returns {string} 밖으로 나갈 본문
 */
function outsideBodyFor(body, policy, lang) {
  const L = lang === 'en' ? 'en' : 'ko';
  const neutral = NEUTRAL[L];
  if (policy === 'internal_only') return neutral;
  if (policy === 'excerpt') {
    // ★ 줄바꿈을 공백으로 눕힌다 — 잠금화면은 한 줄이라 개행이 있으면 뒤가 통째로 안 보인다.
    const flat = String(body || '').replace(/\s+/g, ' ').trim();
    // 글 없는 메시지(첨부 힌트를 못 받은 옛 번들 등) — «무엇을 확인하라는지» 모르는 중립 문구 대신 무엇이 왔는지 말한다
    //   (Irene 2026-10-23: «PlanQ에서 확인하세요 … 뭘 확인하라는 건지 인지가 안되니 나쁜 멘트»).
    if (!flat) return EMPTY_MESSAGE[L];
    return flat.length > EXCERPT_LEN ? flat.slice(0, EXCERPT_LEN) + '…' : flat;
  }
  return body;
}

module.exports = { outsideBodyFor, attachmentBody, EXCERPT_LEN, NEUTRAL, EMPTY_MESSAGE };
