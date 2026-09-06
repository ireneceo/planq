// 앱 세션 페어링 — 딥링크가 앱을 열지 못할 때 **앱이 세션을 넘겨받는** 통로.
//
// ★ 왜 (2026-09-06 운영, Irene 안드로이드 태블릿): "앱에서 로그인해도 돌아가지 않아."
//   planq:// 스킴도 https App Link 도 앱을 열지 못했다(설치된 앱의 필터/서명 문제 — 서버로는
//   못 고친다). 시스템 브라우저에서 세션이 성립해도 그 쿠키는 앱 WebView 의 것이 아니다.
//
// ★★ 첫 설계는 **계정 탈취(ATO) 취약점**이었다 (2026-09-06 Fable 게이트 FAIL):
//     앱이 verifier 를 만들고 그 해시를 initiate URL 로 보내는 PKCE 모양이었는데,
//     **비밀을 고르는 쪽이 곧 공격자**가 될 수 있었다 —
//       공격자가 자기 verifier 의 해시를 담은 링크를 피해자에게 보내고,
//       피해자가 구글 로그인을 마치면 서버가 그 해시에 **피해자 세션**을 예약하고,
//       공격자가 자기 verifier 로 그것을 가져간다.
//     교훈: **비밀이 개시 링크를 타고 들어오면 안 된다.**
//
// 그래서 지금 설계는 비밀을 **로그인을 마친 브라우저에서 생성**한다:
//
//   ① 앱(WebView) → start()            : pairId 발급. pairId 는 비밀이 아니다(누가 알아도 무해).
//   ② 앱이 시스템 브라우저를 연다        : /initiate?client=native&pair=<pairId>
//   ③ 콜백 성공 → attach(pairId, uid)   : **6자리 코드**를 만들어 그 브라우저 화면에만 보여준다
//   ④ 사용자가 앱에 코드 입력 → claim   : pairId + code 가 모두 맞아야 세션 발급
//
// 공격자가 자기 pairId 를 담은 링크를 피해자에게 보내도, ③의 코드는 **피해자 화면**에 뜬다.
// 공격자는 그 코드를 볼 수 없으므로 청구할 수 없다. 비밀의 출처가 피해자 쪽이라 구조적으로 막힌다.
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;          // 6자리 = 100만분의 1, 5회면 무차별 대입 불가
const store = new Map();         // pairId → { uid, code, exp, attempts }

function sweep(now) {
  for (const [k, v] of store.entries()) if (v.exp < now) store.delete(k);
}

/** ① 앱이 흐름을 시작한다. pairId 는 **비밀이 아니다** — 코드 없이는 아무 것도 못 한다. */
function start(now = Date.now()) {
  sweep(now);
  const pairId = crypto.randomBytes(16).toString('base64url');
  store.set(pairId, { uid: null, code: null, exp: now + TTL_MS, attempts: 0 });
  return pairId;
}

/**
 * ③ 콜백이 인증을 끝낸 뒤 세션을 예약하고 **표시할 코드**를 돌려준다.
 * 모르는 pairId(만료·위조)면 null — 그때는 화면에 코드가 없고, 사용자는 앱에 입력할 것이 없다.
 */
function attach(pairId, uid, now = Date.now()) {
  if (!pairId || !uid) return null;
  const v = store.get(String(pairId));
  if (!v || v.exp < now) { store.delete(String(pairId)); return null; }
  // 6자리 — crypto 로 균등하게 뽑는다(Math.random 금지).
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  v.uid = uid;
  v.code = code;
  v.attempts = 0;
  return code;
}

/**
 * ④ 앱이 pairId + 사용자가 입력한 코드로 청구한다.
 * 반환: { ok:true, uid } | { ok:false, reason }
 * **1회용** — 성공하면 즉시 폐기. 실패는 attempts 를 올리고 5회에서 폐기한다.
 */
function claim(pairId, code, now = Date.now()) {
  // ★ 청소는 start 뿐 아니라 여기서도 돈다 — 새 로그인이 한동안 없으면 만료된 예약이
  //   그대로 남는다(2026-09-06 Fable 지적 계열). 양쪽에서 쓸어야 활동만 있으면 자정된다.
  sweep(now);
  if (!pairId || !code) return { ok: false, reason: 'missing' };
  const key = String(pairId);
  const v = store.get(key);
  if (!v || v.exp < now) { store.delete(key); return { ok: false, reason: 'expired_or_unknown' }; }
  if (!v.uid || !v.code) return { ok: false, reason: 'not_ready' };   // 아직 로그인 전
  // ★ 모양부터 검사한다 (2026-09-06 Fable 지적 2건):
  //   ① 유니코드('１２３４５６'·이모지)는 **문자 수와 바이트 수가 달라** timingSafeEqual 이
  //      던진다 → 라우트 catch 로 500 이 나가고, attempts 는 이미 올라간 뒤라 폐기 분기를 안 탄다.
  //   ② `slice(0,6)` 접두 비교라 7자리(코드+'9')가 **통과했다** — 검증이 아니라 자르기였다.
  //   숫자 6자리가 아니면 시도 자체로 세되(무차별 대입 방지) 비교는 하지 않는다.
  v.attempts += 1;
  if (!/^\d{6}$/.test(String(code))) {
    if (v.attempts >= MAX_ATTEMPTS) store.delete(key);
    return { ok: false, reason: v.attempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'bad_code' };
  }
  const match = crypto.timingSafeEqual(Buffer.from(String(code)), Buffer.from(v.code));
  if (!match) {
    if (v.attempts >= MAX_ATTEMPTS) store.delete(key);
    return { ok: false, reason: v.attempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'bad_code' };
  }
  store.delete(key);                                                  // 1회용
  return { ok: true, uid: v.uid };
}

/** 점검용 — 건수만. 내용은 노출하지 않는다. */
function size() { return store.size; }

module.exports = { start, attach, claim, size, TTL_MS, MAX_ATTEMPTS };
