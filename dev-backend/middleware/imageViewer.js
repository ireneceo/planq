// middleware/imageViewer.js — 무인증 이미지 라우트에서 **보는 사람이 누구인지** 알아낸다.
//
// 보안 Stage 1 (게이트는 Stage 2). 지금은 **아무도 막지 않는다** — 신원만 붙이고,
//   "게이트가 켜졌다면 막혔을" 요청을 세어 로그로 남긴다. 켜기 전에 그 수가 0에 수렴하는지
//   봐야 하기 때문이다. 측정 없이 켜면 어느 화면이 깨지는지 모른 채 배포하게 된다.
//
// 배경 — `<img src>` 는 Authorization 헤더를 실을 수 없다. 그래서 이미지 서빙 라우트 4곳은
//   신원을 알 방법이 없었고 "URL 을 아는 사람 = 볼 수 있는 사람"(capability URL)으로 굴러갔다.
//   그 모델이 L1(개인 파일) 어휘와 어긋난다 — 링크만 알면 남의 개인 이미지가 열린다.
//   브라우저가 서브리소스에 자동으로 실어 보내는 채널은 쿠키뿐이라 이미지 전용 쿠키를 쓴다
//   (services/authTokens.js — refresh 쿠키는 장기 비밀이라 재사용하지 않는다).
//
// ★ 이 쿠키를 읽는 곳은 **이 파일 하나뿐**이어야 한다. 라우트가 각자 jwt.verify 를 하면
//   kind 검사를 빠뜨린 곳이 생기고, 그 순간 이미지 토큰이 일반 인증 토큰처럼 쓰인다.
const jwt = require('jsonwebtoken');
const { IMAGE_COOKIE, IMAGE_TOKEN_SECRET } = require('../services/authTokens');

/**
 * 이미지 쿠키에서 보는 사람의 userId 를 얻는다. 없거나 못 믿으면 null (= 익명).
 * ★ 절대 throw 하지 않는다 — 이미지 서빙이 신원 때문에 500 이 되면 안 된다.
 */
function resolveImageViewer(req) {
  return resolveImageViewerDetailed(req).userId;
}

/**
 * 신원 + **왜 익명인지**. Stage 2 를 켤지 판정하려면 사유가 필요하다 —
 *   `none`(비로그인·쿠키 없음) 과 `expired`(로그인했는데 이미지 쿠키만 만료) 는 뜻이 완전히 다르다.
 *   전자는 막아도 되는 것이고, 후자는 **게이트를 켜는 순간 깨질 우리 사용자**다.
 */
function resolveImageViewerDetailed(req) {
  try {
    const raw = req.cookies && req.cookies[IMAGE_COOKIE];
    if (!raw) return { userId: null, reason: 'none' };
    // ★ JWT_SECRET 이 아니라 **파생 비밀**로 검증한다 — 그래야 이 토큰이 일반 인증에서
    //   통하지 않는다(반대로 일반 access token 도 여기서 통하지 않는다). 양방향이 열쇠로 갈린다.
    const p = jwt.verify(raw, IMAGE_TOKEN_SECRET);
    if (!p || p.kind !== 'img' || !p.userId) return { userId: null, reason: 'invalid' };
    return { userId: Number(p.userId), reason: null };
  } catch (e) {
    return { userId: null, reason: e && e.name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
}

// ── Stage 1 계측 ──────────────────────────────────────────────────────────────
//   "게이트가 켜졌다면 막혔을" 건수를 센다. 이미지 요청은 한 화면에 수백 건이라
//   건마다 로그를 쓰면 디스크를 태운다 — **파일 단위로 한 번만**, 그리고 총량은 캡을 둔다.
const seen = new Set();
const SEEN_CAP = 5000;
let suppressed = 0;

/**
 * @param {object} file   File 행 (vlevel/visibility/uploader_id/security_level)
 * @param {number|null} viewer  resolveImageViewer 결과
 * @param {string} route  어느 라우트인지 (로그 식별용)
 */
function auditWouldDeny(file, viewerInfo, route, req) {
  try {
    if (!file) return;
    const v = (viewerInfo && typeof viewerInfo === 'object') ? viewerInfo : { userId: viewerInfo, reason: null };
    const viewer = v.userId;
    const level = file.vlevel || file.visibility || 'L3';
    // Stage 2 에서 막을 대상 = 개인(L1) 인데 본인이 아닌 경우. (L2/L3 확장은 Stage 2b.)
    //   ★ uploader_id 가 비어 있으면 "본인" 으로 오판하지 않는다 — 모르면 세는 쪽이다.
    if (level !== 'L1') return;
    if (file.uploader_id != null && viewer != null && String(file.uploader_id) === String(viewer)) return;
    // ★ 같은 (route, file, viewer) 는 한 번만. viewer 를 키에 넣어야
    //   "익명은 이미 셌으니 로그인한 타인은 안 센다" 는 사고가 안 난다.
    const key = `${route}:${file.id}:${viewer ?? 'anon'}`;
    if (seen.has(key)) return;
    if (seen.size >= SEEN_CAP) { suppressed += 1; return; }
    seen.add(key);
    // ★ 사유·세션·출처를 같이 남긴다. 이게 없으면 "0 에 수렴했는가" 를 판정할 수 없다:
    //   · has_session=1 인데 viewer=anon → **우리 앱에 로그인한 사람이 신원 없이 요청** = 켜면 깨진다
    //   · sec_fetch_site!=same-origin → 외부에서 링크로 들어온 요청 = 막는 것이 목적
    const hasSession = req && req.cookies ? (req.cookies.has_session ? '1' : '0') : '?';
    const site = (req && req.headers && req.headers['sec-fetch-site']) || '?';
    console.warn(`[imageGate:would-deny] route=${route} file=${file.id} level=${level} uploader=${file.uploader_id} viewer=${viewer ?? 'anon'} reason=${v.reason || '-'} has_session=${hasSession} site=${site}`);
  } catch { /* 계측이 서빙을 방해하면 안 된다 */ }
}

// ★ 계측 대상은 **File 행을 근거로 서빙하는 두 라우트**뿐이다:
//     · /api/files/public-image      (File)
//     · /api/posts/editor-image      (File)
//   나머지 둘은 판정 축이 다르다 — TaskAttachment·MessageAttachment 에는 **등급 컬럼이
//   아예 없고**(실측 0건), 접근 판정은 "그 업무·그 대화에 속하는가" 다.
//   같은 술어를 붙이면 전부 'L3' 기본값으로 떨어져 **아무것도 안 걸리는 숫자**가 나온다.
//   Stage 2 에서 그 둘은 canAccessTask / canAccessConversation 으로 따로 다룬다.
function auditStats() {
  return { distinct: seen.size, suppressed };
}

module.exports = { resolveImageViewer, resolveImageViewerDetailed, auditWouldDeny, auditStats };
