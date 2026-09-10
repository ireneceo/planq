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
// ★ 2026-09-10 — 저장소를 **메모리 Map 에서 DB 로** 옮겼다 (Fable 게이트 지적).
//   PM2 재시작마다 진행 중이던 로그인이 통째로 사라졌다. 배포는 하루에도 여러 번 하고,
//   2026-09-10 에 배포 2회 × 10분 창이 Irene 의 아이폰 로그인 신고와 겹쳤다.
//   그리고 fork 모드라 지금은 1 프로세스지만 **cluster 로 바뀌면** start 와 claim 이 다른
//   프로세스에 떨어져 항상 실패한다 — 구조적으로 못 쓰는 상태였다.
//   ★ 코드는 **해시로만** 저장한다. 메모리와 달리 DB 는 백업에도 남는다.
const crypto = require('crypto');
const store = require('./ephemeralStore');

const KIND = 'oauth_pair';
const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;          // 6자리 = 100만분의 1, 5회면 무차별 대입 불가

/** ① 앱이 흐름을 시작한다. pairId 는 **비밀이 아니다** — 코드 없이는 아무 것도 못 한다. */
async function start() {
  const pairId = crypto.randomBytes(16).toString('base64url');
  await store.set(KIND, pairId, { uid: null, codeHash: null }, TTL_MS);
  return pairId;
}

/**
 * ③ 콜백이 인증을 끝낸 뒤 세션을 예약하고 **표시할 코드**를 돌려준다.
 * 모르는 pairId(만료·위조)면 null — 그때는 화면에 코드가 없고, 사용자는 앱에 입력할 것이 없다.
 */
async function attach(pairId, uid) {
  if (!pairId || !uid) return null;
  const row = await store.get(KIND, pairId);
  if (!row) return null;                       // 만료·위조 — get 이 만료 행을 지운다
  // 6자리 — crypto 로 균등하게 뽑는다(Math.random 금지).
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  // ★ payload 에 attempts 를 넣지 않는다 — 그것은 이제 **컬럼**이다(원자 증가).
  //   JSON 에 같은 이름을 남겨 두면 다음 사람이 그것을 진짜 카운터로 오해한다(Fable 지적).
  await row.update({ payload: { uid, codeHash: store.hashSecret(String(pairId), code) }, attempts: 0 });
  return code;                                  // 평문은 **여기서 한 번** 돌려주고 보관하지 않는다
}

/**
 * ④ 앱이 pairId + 사용자가 입력한 코드로 청구한다.
 * 반환: { ok:true, uid } | { ok:false, reason }
 * **1회용** — 성공하면 즉시 폐기. 실패는 attempts 를 올리고 5회에서 폐기한다.
 */
async function claim(pairId, code) {
  if (!pairId || !code) return { ok: false, reason: 'missing' };
  const key = String(pairId);
  const row = await store.get(KIND, key);
  if (!row) return { ok: false, reason: 'expired_or_unknown' };
  const v = row.payload || {};
  if (!v.uid || !v.codeHash) return { ok: false, reason: 'not_ready' };   // 아직 로그인 전
  // ★ 모양부터 검사한다 (2026-09-06 Fable 지적 2건):
  //   ① 유니코드('１２３４５６'·이모지)는 **문자 수와 바이트 수가 달라** timingSafeEqual 이
  //      던진다 → 라우트 catch 로 500 이 나가고, attempts 는 이미 올라간 뒤라 폐기 분기를 안 탄다.
  //   ② `slice(0,6)` 접두 비교라 7자리(코드+'9')가 **통과했다** — 검증이 아니라 자르기였다.
  //   숫자 6자리가 아니면 시도 자체로 세되(무차별 대입 방지) 비교는 하지 않는다.
  // ★ 시도는 **먼저, 원자적으로** 올린다 (2026-09-10 Fable FAIL).
  //   읽고-더하고-쓰면 동시 요청에서 증가가 유실돼 5회 상한이 통째로 무력화된다
  //   (실측: 동시 20회 오답 → attempts 4 에 머물고 그 뒤 맞는 코드가 통과했다).
  const attempts = await store.bumpAttempts(KIND, key);
  if (attempts === null) return { ok: false, reason: 'expired_or_unknown' };   // 그 사이 사라졌다
  const overLimit = attempts >= MAX_ATTEMPTS;
  const failReason = overLimit ? 'too_many_attempts' : 'bad_code';
  const dropIfOver = async () => { if (overLimit) await store.del(KIND, key); };

  if (!/^\d{6}$/.test(String(code))) { await dropIfOver(); return { ok: false, reason: failReason }; }
  // 해시끼리 타이밍 안전 비교 — 평문은 DB 에 없다.
  if (!store.safeEqual(store.hashSecret(key, String(code)), v.codeHash)) {
    await dropIfOver();
    return { ok: false, reason: failReason };
  }
  // ★ 1회용도 **삭제 건수**로 원자화한다. `del` 후 성공을 돌려주면 동시에 들어온 둘이
  //   모두 성공해 **세션이 두 개 발급된다**(실측). 1을 받은 쪽만 성공이다.
  const removed = await store.consume(KIND, key);
  if (removed !== 1) return { ok: false, reason: 'expired_or_unknown' };
  return { ok: true, uid: v.uid };
}

/** 점검용 — 건수만. 내용은 노출하지 않는다. */
async function size() {
  const { EphemeralToken } = require('../models');
  return EphemeralToken.count({ where: { kind: KIND } });
}

module.exports = { start, attach, claim, size, TTL_MS, MAX_ATTEMPTS, KIND };
