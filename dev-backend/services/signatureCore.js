const crypto = require('crypto');
// signatureCore — 서명/확인이 **함께 쓰는 판정·발송 조각**의 단일 원천.
//
// 왜 갈라졌나: #239(문서 외부 확인)로 라우트가 늘면서 routes/signatures.js 가 803줄이 되어
// god-file 래칫에 걸렸다. 절단면은 "서명 전용 로직"과 "서명·확인 공용 조각"의 경계다.
// 공용 조각을 여기 두면 routes/signatures.js(서명)와 routes/signature_confirm.js(확인)가
// **같은 판정을 두 벌로 갖지 않는다** — 이 저장소가 반복해서 당한 실패 계열이다.
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { SignatureRequest, PostAttachment, File, Post, Document, Project } = require('../models');
const { errorResponse } = require('../middleware/errorHandler');

async function loadByToken(token) {
  if (!token || typeof token !== 'string' || token.length !== 64) return null;
  return await SignatureRequest.findOne({ where: { token } });
}

// 운영 #239 — 확인(confirm) 공개 액션용 limiter. 서명 OTP 와 같은 키(token+IP)·같은 창.
const confirmLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.params.token || ''}:${ipKeyGenerator(req.ip)}`,
  message: { success: false, message: 'rate_limit_confirm' },
});

// 킬스위치 — 사고 시 코드 배포 없이 끌 수 있어야 한다(공개 무인증 표면).
const docConfirmEnabled = () => String(process.env.FEATURE_DOC_CONFIRM || 'on').toLowerCase() !== 'off';

// kind 가드 — **양방향**이다.
//   서명 라우트(/otp,/verify,/sign,/reject)에 confirm row 가 들어오면 안 되고,
//   확인 라우트(/confirm,/comment)에 sign row 가 들어와도 안 된다.
//   옛 행은 DEFAULT 'sign' 이므로 기존 플로우는 무변화.
function assertKind(sr, expected, res) {
  const k = sr.kind || 'sign';
  if (k !== expected) { errorResponse(res, 'wrong_kind', 400); return false; }
  return true;
}

// 만료 판정 **단일 원천**.
// `status='expired'` 문자열은 GET(열람) 시점에 마킹된다 — 즉 **GET 을 거치지 않으면 영영 안 붙는다.**
// 그래서 status 만 보는 라우트는 만료 토큰에 바로 POST 하면 통과한다(Fable 실측: 만료된 확인 토큰이
// 200 confirmed 로 처리됨). 공개 무인증 표면에서 만료는 유일한 회수 수단이라 이게 뚫리면 회수가 무력해진다.
// → **문자열과 날짜를 항상 함께** 본다. 만료 검사가 필요한 곳은 전부 이 함수를 쓴다(공식 2벌 금지).
function isExpiredNow(sr) {
  if (!sr) return false;
  if (sr.status === 'expired') return true;
  return !!(sr.expires_at && new Date(sr.expires_at) < new Date());
}

// 워크스페이스 멤버에 진행 알림.
// ★ 두 번째 인자는 **일어난 사건**이지 `sr.kind`(sign|confirm)가 아니다. 이름이 겹쳐 혼동한 전례가 있어
//   `event` 로 부른다. #239 로 confirmed/commented 가 추가됐는데 문구가 2분기(signed/rejected)뿐이라
//   **확인했는데 "서명 거절됨" 이 발송되던** 오보를 Fable 이 실측으로 잡았다.
//   사건을 늘리면 이 표도 같이 늘린다 — 표에 없는 사건은 아래에서 발송 자체를 중단한다(거짓 문구 금지).
const SIGNATURE_EVENT_COPY = {
  signed: { title: '서명 완료', suffix: ' 님이 서명을 완료했습니다.' },
  rejected: { title: '서명 거절됨', suffix: ' 님이 서명을 거절했습니다.' },
  confirmed: { title: '문서 확인 완료', suffix: ' 님이 문서를 확인했습니다.' },
  commented: { title: '문서 의견 등록', suffix: ' 님이 문서에 의견을 남겼습니다.' },
};
async function notifyWorkspaceMembersOnSignature(sr, event, signerName) {
  const copy = SIGNATURE_EVENT_COPY[event];
  // 모르는 사건에 아무 문구나 붙이지 않는다. 틀린 알림은 알림 없음보다 나쁘다.
  if (!copy) { console.warn('[notify signature] 미정의 event:', event); return; }
  const { Business, BusinessMember, Post } = require('../models');
  // ★ routes/ 에서 옮겨온 코드다. 상대경로가 그대로면 services/ 기준으로 어긋난다.
  //   호출부가 fire-and-forget(.catch)라 이 실패는 200 뒤에 조용히 묻힌다 — 실제로 그렇게 묻혔다.
  const { notifyMany } = require('../routes/notifications');
  const biz = await Business.findByPk(sr.business_id, { attributes: ['name', 'brand_name'] });
  const wsName = biz?.brand_name || biz?.name || null;
  let entityTitle = '';
  if (sr.entity_type === 'post') {
    const p = await Post.findByPk(sr.entity_id, { attributes: ['title'] });
    entityTitle = p?.title || '';
  }
  const members = await BusinessMember.findAll({
    where: { business_id: sr.business_id, removed_at: null, role: { [require('sequelize').Op.in]: ['owner', 'admin', 'member'] } },
    attributes: ['user_id'],
  });
  const userIds = members.map((m) => m.user_id);
  // 요청자 본인은 제외 (이미 자신의 액션)
  const excludeUserId = sr.requester_user_id;
  const title = copy.title;
  const body = `${signerName || sr.signer_email}${copy.suffix}${entityTitle ? `\n문서: ${entityTitle}` : ''}`;
  const link = sr.entity_type === 'post'
    ? `${process.env.APP_URL || 'https://dev.planq.kr'}/posts/${sr.entity_id}`
    : `${process.env.APP_URL || 'https://dev.planq.kr'}/docs/${sr.entity_id}`;
  await notifyMany({
    userIds, businessId: sr.business_id, eventKind: 'signature',
    title, body, link, ctaLabel: '확인하기',
    workspaceName: wsName, excludeUserId,
  });
}


// ── 서명 잠금 · 대상 동결 (2026-08-27 추가) ──────────────────────────
// 정책(Fable 설계 게이트): **서명 요청이 살아 있는 동안 본문·제목·별첨을 잠근다.**
//   - 술어: kind='sign' 이면서 status 가 pending/sent/viewed/signed 중 하나.
//     완료(signed)만 막으면 부족하다 — 서명자는 **동결분**을 보고 서명하는데 그 사이 원본이 바뀌면
//     워크스페이스 사본과 서명본이 갈라진 상태가 일상이 된다. fail-closed 로 간다.
//   - 진행 중 문서를 고쳐야 하면 요청을 취소(DELETE /signatures/:id)하면 잠금이 풀린다.
//   - 확인 요청(kind='confirm')은 잠그지 않는다. 서명이 아니다.
//   - 여태 routes/posts.js 에는 SignatureRequest 참조가 **한 건도 없었다** — 자동저장이 서명된
//     계약서를 조용히 덮어쓸 수 있었다(운영 첫 실사용 직전 발견).

/** 이 post 가 서명으로 잠겼는가 (완료된 서명이 1건이라도 있는가) */
async function isPostSignatureLocked(postId, opts = {}) {
  const { Op } = require('sequelize');
  const n = await SignatureRequest.count({
    where: {
      entity_type: 'post', entity_id: Number(postId), kind: 'sign',
      status: { [Op.in]: ['pending', 'sent', 'viewed', 'signed'] },
    },
    ...(opts.transaction ? { transaction: opts.transaction } : {}),
  });
  return n > 0;
}

/**
 * 라우트 가드 — 잠겨 있으면 409 를 응답하고 true 를 돌려준다(호출부는 즉시 return).
 * 409 를 쓰는 이유: 권한 문제(403)가 아니라 **문서 상태**의 문제다.
 */
async function blockIfSigned(res, postId, opts = {}) {
  if (!(await isPostSignatureLocked(postId, opts))) return false;
  res.status(409).json({
    success: false,
    code: 'post_locked_by_signature',
    message: '서명 요청이 진행 중이거나 완료된 문서라 내용을 수정할 수 없습니다. 수정하려면 서명 요청을 취소하거나, 새 버전 문서로 다시 서명을 받아 주세요.',
  });
  return true;
}

function parseMaybeJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

async function buildEntitySnapshot(entityType, entity, t) {
  const raw = entityType === 'post'
    ? (typeof entity.content_json === 'string' ? entity.content_json : JSON.stringify(entity.content_json ?? null))
    : JSON.stringify(entity.content ?? entity.content_json ?? null);
  const title = String(entity.title || '');
  // ★ 해시 공식은 여기 한 곳에서만 계산한다. 같은 값의 공식이 두 벌이 되면 이미 갈라진 것이고,
  //   해시는 한 번 바꾸면 **기존 행과 영영 비교 불가**가 된다. 제목까지 포함한다 — 계약서 제목
  //   ("…ver.01")은 서명 대상의 일부다.
  const content_hash = crypto.createHash('sha256').update(`${title}\n${String(raw || '')}`).digest('hex');
  let attachments_snapshot = [];
  if (entityType === 'post') {
    const rows = await PostAttachment.findAll({
      where: { post_id: entity.id },
      include: [{ model: File, as: 'file' }],
      order: [['sort_order', 'ASC']],
      ...(t ? { transaction: t } : {}),
    });
    attachments_snapshot = rows.map((a) => ({
      file_id: a.file_id,
      name: a.file?.file_name || null,
      size: a.file?.file_size || null,
      mime: a.file?.mime_type || null,
      content_hash: a.file?.content_hash || null,
    }));
  }
  return { title_snapshot: title, content_snapshot: raw, content_hash, attachments_snapshot, snapshot_at: new Date() };
}


// ─── 공개 서명 경로 공유 헬퍼 (routes/signatures.js 에서 이관 — god-file 분리) ───
async function loadEntity(entity_type, entity_id) {
  // 서명 페이지에 프로젝트 컨텍스트 노출 — post 의 연결된 프로젝트(있으면) 같이 fetch
  if (entity_type === 'post') {
    return await Post.findByPk(entity_id, {
      include: [{ model: Project, attributes: ['id', 'name'], required: false }],
    });
  }
  if (entity_type === 'document') return await Document.findByPk(entity_id);
  return null;
}

async function maybeUpdateEntityStatus(/* entity_type, entity_id, business_id, t */) {
  // no-op (의도)
}

module.exports = {
  isPostSignatureLocked, blockIfSigned, parseMaybeJson, buildEntitySnapshot, loadEntity, maybeUpdateEntityStatus,
  loadByToken, confirmLimiter, docConfirmEnabled, assertKind,
  isExpiredNow, SIGNATURE_EVENT_COPY, notifyWorkspaceMembersOnSignature,
};
