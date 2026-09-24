// services/imageCtx.js — 공개 문맥 이미지 토큰 (이미지 보안 Stage 2b 1단계, docs/IMAGE_STAGE2B_DECISIONS.md §1)
//
// 공유 링크·게스트 프로젝트 링크·서명 화면은 **익명**이 연다. 그 본문에 박힌 L2/L3 이미지를 3단계에서 막으면
// 이 세 화면이 깨진다. 그래서 공개 응답이 `image_ctx` 를 주고, 화면이 `<img src>` 에 `?ctx=` 로 붙인다.
// 서버는 «ctx 가 가리키는 문서가 지금도 열려 있고 그 본문에 이 파일이 실제로 박혀 있는가» 를 **이 한 함수**로 판정한다.
//
// ★ 이미지를 L4 로 재분류하지 않는 이유 — 공유를 끊어도 이미지 URL 은 영원히 공개가 된다(이미지가 문서보다 오래 산다).
//   ctx 는 **공유 토큰 그 자체**를 품고 매번 다시 푼다. 공유 해제·만료·비밀번호 변경이면 그 순간 죽는다.
//
// 형식: AES-256-GCM(파생 키) — 서명과 기밀을 한 번에. 게스트·서명 토큰(원문)이 안에 들어가므로 평문 서명(JWT)은 쓰지 않는다.
//   IV 는 평문의 HMAC 에서 뽑는다(SIV 방식) — 같은 문서·같은 시간창이면 **같은 ctx** 가 나와 60초 재조회마다
//   이미지 URL 이 바뀌어 다시 받는 일이 없고, 평문이 다르면 IV 도 달라 GCM 의 IV 재사용 문제가 없다.
// ★ 지금(1·2단계)은 **아무것도 막지 않는다.** 이 판정은 계측(`[imageGate:would-deny-l23]`)에만 쓰인다.
const crypto = require('crypto');
const path = require('path');

const KIND = { post: 'p', guest: 'g', sign: 's' };
const HOUR = 3600;

function key(use = 'enc') {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET missing');
  // 다른 용도의 토큰과 열쇠를 가른다 — 이 값으로 로그인 토큰을 만들 수도, 그 반대도 안 된다.
  //   암호화 키와 IV 용 HMAC 키도 서로 가른다(한 키를 두 용도에 쓰지 않는다 — Fable 권고).
  return crypto.createHash('sha256').update(`${s}:planq-imgctx-v1:${use}`).digest();
}
const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const fp = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex').slice(0, 12);

/** 발급 — 1~2시간 유효. 정시 경계로 맞춰 같은 시간창 안에서는 같은 값이 나온다. */
function issueImageCtx(kind, { token, postId = null, pwHash = null } = {}) {
  try {
    if (!KIND[kind] || !token) return null;
    const exp = (Math.floor(Date.now() / 1000 / HOUR) + 2) * HOUR;
    const payload = Buffer.from(JSON.stringify({ k: KIND[kind], t: token, i: postId, f: fp(pwHash), e: exp }));
    const k = key('enc');
    const iv = crypto.createHmac('sha256', key('iv')).update(payload).digest().subarray(0, 12);
    const c = crypto.createCipheriv('aes-256-gcm', k, iv);
    const ct = Buffer.concat([c.update(payload), c.final()]);
    return b64u(Buffer.concat([iv, c.getAuthTag(), ct]));
  } catch (e) {
    console.warn('[imageCtx] 발급 실패', e.message);
    return null;
  }
}

function openCtx(ctx) {
  try {
    if (!ctx || typeof ctx !== 'string' || ctx.length > 600) return null;
    const raw = unb64u(ctx);
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key('enc'), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const p = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
    if (!p || !p.e || p.e * 1000 < Date.now()) return null;
    return p;
  } catch { return null; }
}

/** 본문(JSON·HTML 문자열)에 이 저장 파일명이 **이미지 주소로** 박혀 있는가. 접미사 일치는 인정하지 않는다. */
function bodyHasImage(bodies, name) {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`/api/(?:posts/editor-image|files/public-image)/${esc}(?=[?"'\\s)&\\\\]|$)`);
  return bodies.some((b) => {
    if (b == null) return false;
    const s = typeof b === 'string' ? b : JSON.stringify(b);
    return re.test(s);
  });
}

/** ctx 가 가리키는 문서 — 지금도 그 문맥으로 열리는가 + 본문 후보들 + 워크스페이스. 못 열면 null. */
async function resolveDoc(p) {
  const { Post, SignatureRequest } = require('../models');
  if (p.k === KIND.post) {
    const post = await Post.findOne({ where: { share_token: p.t } });
    if (!post) return null;
    // 열림 판정은 공개 문서 라우트와 **같은 함수**(services/shareOpenable).
    if (require('./shareOpenable').shareOpenReason('post', post)) return null;
    if (fp(post.share_password_hash) !== p.f) return null;   // 비밀번호를 걸거나 바꾸면 옛 ctx 는 죽는다
    // 공개 화면은 서명본(고정본)도 그린다 — 그 본문도 문맥 안이다.
    const reqs = await SignatureRequest.findAll({
      where: { entity_type: 'post', entity_id: post.id }, attributes: ['content_snapshot'],
    });
    return { businessId: post.business_id, bodies: [post.content_json, ...reqs.map((r) => r.content_snapshot)] };
  }
  if (p.k === KIND.guest) {
    // 게스트 링크의 생사·프로젝트 범위·문서 술어는 게스트 라우트와 **같은 함수**다.
    const g = await require('./guest_link').resolveGuestToken(p.t, { touch: false });
    if (!g) return null;
    const { guestProjectOf, findGuestPost } = require('./guestPost');
    const project = await guestProjectOf(g.link);
    if (!project) return null;
    const post = await findGuestPost(g.link, project.id, p.i, ['id', 'business_id', 'security_level', 'content_json']);
    if (!post) return null;
    return { businessId: post.business_id, bodies: [post.content_json] };
  }
  if (p.k === KIND.sign) {
    const { loadByToken, loadEntity } = require('./signatureCore');
    const sr = await loadByToken(p.t);
    if (!sr) return null;
    // 공개 서명 조회(`GET /api/sign/:token`)가 410 으로 닫는 상태와 같다.
    if (sr.status === 'canceled' || sr.status === 'expired') return null;
    if (sr.expires_at && sr.expires_at < new Date() && sr.status !== 'signed' && sr.status !== 'rejected') return null;
    if (sr.entity_type !== 'post') return null;
    const entity = await loadEntity(sr.entity_type, sr.entity_id);
    if (!entity) return null;
    return { businessId: entity.business_id, bodies: [sr.content_snapshot || entity.content_json] };
  }
  return null;
}

// 한 화면이 같은 ctx 로 이미지 수십 장을 부른다 — 문서 조회는 60초 캐시(판정 결과가 아니라 문서를).
const docCache = new Map();
const DOC_TTL = 60000;
const DOC_CAP = 2000;

/**
 * 이 ctx 문맥에서 이 파일을 보여도 되는가.
 * ★ **파일의 워크스페이스 = 문서의 워크스페이스** 일 때만 — 남의 워크스페이스 이미지 주소를 자기 문서에 붙여
 *   공유해도 그 이미지는 열리지 않는다.
 * @returns {Promise<boolean>} 절대 throw 하지 않는다. 모르면 false.
 */
async function imageCtxAllows(ctx, file) {
  try {
    if (!ctx || !file || !file.file_path) return false;
    const p = openCtx(ctx);
    if (!p) return false;
    const ck = `${p.k}:${p.t}:${p.i || ''}:${p.f || ''}`;
    let hit = docCache.get(ck);
    if (!hit || Date.now() - hit.at > DOC_TTL) {
      hit = { at: Date.now(), doc: await resolveDoc(p) };
      if (docCache.size >= DOC_CAP) docCache.delete(docCache.keys().next().value);
      docCache.set(ck, hit);
    }
    const doc = hit.doc;
    if (!doc || Number(doc.businessId) !== Number(file.business_id)) return false;
    return bodyHasImage(doc.bodies, path.basename(file.file_path));
  } catch (e) {
    console.warn('[imageCtx] 판정 오류 — 거부로 센다', e.message);
    return false;
  }
}

module.exports = { issueImageCtx, imageCtxAllows, bodyHasImage, _openCtx: openCtx, _docCache: docCache };
