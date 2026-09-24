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

// ── Stage 2a 게이트 — **개인(L1) 이미지만** (docs/IMAGE_STAGE2_DECISIONS.md, Fable 2026-09-24) ─────────
//   L1 은 올린 사람(+ platform_admin)만 본다. 목록·다운로드와 **같은 술어**(`canAccessFileByLevel`)를 쓴다 —
//   새 술어를 만들면 «목록엔 없는데 URL 로는 열리는» 식으로 갈라진다. L2/L3 는 지금은 통과(2b 자리 — 위키·공개공유가 익명이다).
//   ★ 킬스위치는 **시각**이다(`platform_settings.image_gate_l1_off_until`) — 과거면 켬, 미래면 끔, 24h 뒤 자동 복귀.
//     컬럼을 못 읽으면 **켬**(기본 꺼짐 플래그는 운영에서만 조용히 죽는다). 30초 캐시라 재시작 없이 바뀐다.
let gateCache = { at: 0, offUntil: null };
async function l1GateOn() {
  if (Date.now() - gateCache.at > 30000) {
    let offUntil = null;
    try {
      const { PlatformSetting } = require('../models');
      const row = await PlatformSetting.findOne({ attributes: ['image_gate_l1_off_until'], order: [['id', 'ASC']] });
      offUntil = row && row.image_gate_l1_off_until ? new Date(row.image_gate_l1_off_until) : null;
    } catch { offUntil = null; }
    gateCache = { at: Date.now(), offUntil };
  }
  return !(gateCache.offUntil && gateCache.offUntil.getTime() > Date.now());
}

const denyStats = { anon: 0, expired: 0, other_user: 0, since: Date.now() };
let lastSessionAlert = 0;
const sessionAlerts = [];   // 시각 목록 — health-check 가 «최근 24h 에 우리 사용자가 신원 없이 막혔나» 를 읽는다
/** 어디서 왔는가 — **경로만**, 긴 토큰 조각은 가린다(`/g/<token>` 이 로그에 남으면 그 자체가 유출이다). */
function refererPath(req) {
  try {
    const r = req && req.headers && req.headers.referer;
    if (!r) return '-';
    return new URL(r).pathname.split('/').map((seg) => (seg.length > 16 ? '*' : seg)).join('/').slice(0, 80) || '/';
  } catch { return '?'; }
}

/**
 * 이 이미지를 이 요청자에게 내보내도 되는가. **두 라우트(files/public-image · posts/editor-image)가 이것 하나를 부른다.**
 * 거부 시 호출자는 404(존재 은닉) + no-store 로 답한다. 판정 전에 **리사이즈 캐시를 먼저 보지 않는다**
 * (캐시는 파일 키라 뒤에 두면 캐시본이 익명에게 나간다).
 * @returns {Promise<boolean>}
 */
async function isImageViewable(file, req, route) {
  try {
    if (!file) return false;
    const level = file.vlevel || file.visibility || 'L3';
    if (level !== 'L1') return true;                       // 2a 범위 밖 — 불변
    const v = resolveImageViewerDetailed(req);
    const viewer = v.userId;
    if (viewer != null && file.uploader_id != null && String(file.uploader_id) === String(viewer)) return true;
    if (viewer != null) {
      // ★ 이미지 쿠키에는 userId 만 있다 — platform_role 을 **DB 에서** 읽어 넘긴다. 안 넘기면
      //   getUserScope 가 isPlatformAdmin=false 로 판정해 관리자도 막힌다(2026-09-24 카나리가 잡았다).
      const { canAccessFileByLevel, getUserScope } = require('./access_scope');
      const { User } = require('../models');
      const u = await User.findByPk(viewer, { attributes: ['platform_role'] });
      const scope = await getUserScope(viewer, file.business_id, u && u.platform_role);
      if (await canAccessFileByLevel(viewer, file, scope)) return true;   // 목록과 같은 술어
    }
    const on = await l1GateOn();
    const hasSession = req && req.cookies ? (req.cookies.has_session ? '1' : '0') : '?';
    const kind = viewer != null ? 'other_user' : (v.reason === 'expired' ? 'expired' : 'anon');
    denyStats[kind] += 1;
    const key = `deny:${route}:${file.id}:${viewer ?? 'anon'}`;
    if (!seen.has(key) && seen.size < SEEN_CAP) {
      seen.add(key);
      console.warn(`[imageGate:deny] route=${route} file=${file.id} level=L1 uploader=${file.uploader_id} viewer=${viewer ?? 'anon'} reason=${v.reason || '-'} has_session=${hasSession} referer=${refererPath(req)} flag=${on ? 'on' : 'off'}`);
    }
    // 우리 사용자가 **신원 없이** 막혔다(세션은 있는데 이미지 쿠키가 없음·만료) = 켜서 깨진 것. 24h 에 한 번 크게 남긴다.
    if (on && hasSession === '1' && viewer == null) {
      // 상한 — 쿠키가 깨진 사용자 한 명이 갤러리를 스크롤하면 시간당 수천 건이다(Fable 소견 2). 판정에는 «있다» 면 충분하다.
      if (sessionAlerts.length >= 1000) sessionAlerts.shift();
      sessionAlerts.push(Date.now());
      while (sessionAlerts.length && Date.now() - sessionAlerts[0] > 86400000) sessionAlerts.shift();
    }
    if (on && hasSession === '1' && viewer == null && Date.now() - lastSessionAlert > 86400000) {
      lastSessionAlert = Date.now();
      console.error(`[imageGate:ALERT] 세션 있는 사용자가 신원 없이 L1 이미지에서 막혔다 route=${route} file=${file.id} reason=${v.reason || '-'} referer=${refererPath(req)}`);
    }
    return !on;
  } catch (e) {
    // ★ 판정 오류는 **막는다**(fail-closed) — 이미지 한 장이 안 보이는 것이 개인 이미지가 새는 것보다 낫다.
    console.warn('[imageGate] 판정 오류 — 막는다:', e.message);
    return false;
  }
}
/**
 * 첨부 **사본**의 원본 File 행 — 채팅·업무 첨부는 같은 저장 파일(stored name)을 다른 라우트로 서빙한다.
 * 등급의 정본은 File 행 하나다(docs/IMAGE_STAGE2B_DECISIONS.md §0). 사본 라우트가 이 행을 찾아 **같은 판정**을 하지 않으면
 * `files/public-image` 에서 404 인 개인 이미지가 사본 경로로는 익명에게 열린다(운영 L1 이미지 23장, Fable 실측 2026-09-24).
 * 우선순위: 명시 file_id → Drive external_id → 로컬 파일명 **정확 일치**(LIKE 접미사만으로 인정하지 않는다).
 */
async function findSourceFile({ fileId = null, externalId = null, storedName = null } = {}) {
  const { File } = require('../models');
  const { Op } = require('sequelize');
  if (fileId) {
    const f = await File.findByPk(fileId);
    if (f) return f;
  }
  // ★ 같은 바이트(SHA-256 dedup)나 같은 Drive 파일에 File 행이 **여럿**이고 등급이 다를 수 있다(운영 2건).
  //   아무 행이나 집으면 L1 대신 L3 행을 집어 통과한다 — **가장 좁은 등급을 먼저** 본다(fail-closed, Fable 2b 0단계 소견).
  const { sequelize } = require('../config/database');
  const narrowest = [[sequelize.literal("FIELD(COALESCE(`File`.`vlevel`, `File`.`visibility`, 'L4'), 'L1', 'L2', 'L3', 'L4')"), 'ASC']];
  if (externalId) {
    const f = await File.findOne({ where: { external_id: externalId, storage_provider: 'gdrive' }, order: narrowest });
    if (f) return f;
  }
  if (storedName) {
    const rows = await File.findAll({ where: { file_path: { [Op.like]: `%${storedName}` }, storage_provider: 'planq' }, order: narrowest, limit: 20 });
    const f = rows.find((r) => require('path').basename(r.file_path) === storedName);
    if (f) return f;
  }
  return null;
}

/**
 * 첨부 **사본** 라우트의 게이트 한 줄 — 원본 File 을 찾아 같은 판정을 하고, 거부면 404(존재 은닉)+no-store 로 **응답까지** 한다.
 * @returns {Promise<boolean>} true = 응답했다(호출자는 return)
 */
async function denyPrivateCopy(req, res, source, route) {
  const src = await findSourceFile(source);
  if (!src || (await isImageViewable(src, req, route))) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ success: false, message: 'not_found' });
  return true;
}

/** 이 사람이 이 파일을 **목록에서 볼 수 있는가** — 첨부로 끌어올 때(link-existing) 검사한다.
 *  못 보는 파일을 붙이면 그 순간 채팅·업무 사본으로 퍼진다(남의 L1 을 붙일 수 있었다). */
async function canUserSeeFile(userId, platformRole, file) {
  const { canAccessFileByLevel, getUserScope } = require('./access_scope');
  const scope = await getUserScope(userId, file.business_id, platformRole);
  return canAccessFileByLevel(userId, file, scope);
}

/** 관측 — `GET /api/internal/health/imagegate` 가 읽고 `health-check --category=imagegate` 가 판정한다.
 *  ★ 만들어 놓고 읽는 곳이 없던 카운터였다(Fable 게이트 후속, 2026-09-24) — 안 붙은 가드는 없는 가드. */
async function imageGateStats() {
  while (sessionAlerts.length && Date.now() - sessionAlerts[0] > 86400000) sessionAlerts.shift();
  const on = await l1GateOn();
  return {
    gate_on: on,
    off_until: gateCache.offUntil ? gateCache.offUntil.toISOString() : null,
    deny: { anon: denyStats.anon, expired: denyStats.expired, other_user: denyStats.other_user },
    session_alerts_24h: sessionAlerts.length,
    since: new Date(denyStats.since).toISOString(),
  };
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

module.exports = {
  isImageViewable, imageGateStats, l1GateOn, findSourceFile, canUserSeeFile, denyPrivateCopy, resolveImageViewer, resolveImageViewerDetailed, auditWouldDeny, auditStats };
