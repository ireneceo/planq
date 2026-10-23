// services/signatureList.js — 서명 목록 세 벌(받은 · 보낸 · 워크스페이스 서명 관리)이 같이 쓰는 조각 (2026-10-23)
//
//   설계: docs/SIGNATURE_MANAGE_DESIGN.md (Fable DESIGN-CHANGE 반영)
//   - serialize      : 서명 행 → 응답(routes/signatures.js 에서 옮겼다 · 동작 무변경). token·sign_url 은 withLink 일 때만(받는 본인).
//   - docAccessMap   : 보는 사람 기준 문서 문(can_read · can_edit · edit_block) — 받은 목록에서 옮겼다.
//   - canManageRows  : 취소·재알림·회차 닫기 **한 술어** — 요청자 ∨ 문서를 고칠 수 있는 사람 ∨ (owner/admin ∧ 그 문서를 읽을 수 있음).
//   - hiddenRow      : 읽을 수 없는 문서의 행 — 빼지 않고 가린다(제목·문서 링크·IP·메모·사유 없음 · 이메일 가림 · 동작 불가).
const { Post } = require('../models');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

// 모델이 underscored + timestamps 라 인스턴스 속성은 createdAt 이다 — sr.created_at 은 비어 있었다
//   (2026-10-23 발견: 진행표·받은 목록·생성 응답의 created_at 이 늘 null 이었다)
const createdOf = (sr) => sr.created_at ?? sr.createdAt ?? null;

function serialize(sr, { withLink = false } = {}) {   // ★ token·sign_url 은 받는 사람 본인(received)만 — 진행표·생성 응답은 멤버 전원이 받는다 (0-C C-1)
  return {
    id: sr.id,
    entity_type: sr.entity_type, entity_id: sr.entity_id,
    kind: sr.kind || 'sign',   // #239 — 화면이 "서명 요청" vs "확인 요청" 을 구분하는 근거
    business_id: sr.business_id,
    requester_user_id: sr.requester_user_id,
    signer_email: sr.signer_email, signer_name: sr.signer_name,
    // 서명란 — 화면이 «몇 번 칸 · 보내는/받는 쪽» 을 그리고, 내 칸이면 [서명하기] 를 띄운다
    slot: sr.slot ?? null, party: sr.party || 'them', signer_user_id: sr.signer_user_id ?? null,
    ...(withLink ? { token: sr.token, sign_url: `${APP_URL}/sign/${sr.token}` } : {}),
    status: sr.status,
    viewed_at: sr.viewed_at,
    confirmed_at: sr.confirmed_at,
    comment: sr.comment,
    comment_at: sr.comment_at,
    otp_verified: !!sr.otp_verified_at,
    signed_at: sr.signed_at,
    signed_ip: sr.signed_ip,
    signature_image_b64: sr.signature_image_b64 ? '(present)' : null,  // 진행 표 응답에서 이미지 본문 노출 X (대신 별도 GET)
    // 채운 서명 칸 수 — 사인 + 회사 스탬프면 2. 화면이 GET …/image?i=0..n-1 로 다 그린다(첫 장만 그리면 «2개 했는데 1개»)
    signature_image_count: require('./signatureItems').signedImagesOf(sr).length,
    // 서명 항목 — 앱 안 서명 창이 «칸 몇 개를 채울지» 를 안다. 채운 이미지(item_images)는 싣지 않는다(위와 같은 이유)
    required_items: require('./signatureItems').publicRequiredItems(sr.required_items),
    rejected_at: sr.rejected_at, rejected_reason: sr.rejected_reason,
    rejected_kind: sr.rejected_kind || null,
    superseded_at: sr.superseded_at || null,
    note: sr.note,
    expires_at: sr.expires_at,
    reminder_count: sr.reminder_count,
    last_reminder_at: sr.last_reminder_at,
    created_at: createdOf(sr),
  };
}

/** a***@domain — 읽을 수 없는 문서의 서명자 이메일 */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return '***';
  return `${s[0]}***${s.slice(at)}`;
}

/** 지금 보는 사람이 그 워크스페이스 owner/admin(또는 플랫폼 관리자)인가 */
async function isWorkspaceManager(user, businessId) {
  if (user.platform_role === 'platform_admin') return true;
  const { getUserScope } = require('../middleware/access_scope');
  const scope = await getUserScope(user.id, businessId, user.platform_role);
  return !!(scope.isOwner || scope.isAdmin);
}

/**
 * 취소·재알림·회차 닫기 — 세 문이 이 함수 하나를 쓴다.
 *   rows: 같은 문서의 서명 행(취소·재알림은 그 한 행, 회차 닫기는 그 회차 전부). post: 그 문서(없으면 요청자만).
 *   ★ owner/admin 은 «관리 행위» 로 남의 요청도 정리한다 — 단 읽을 수 없는 문서(나만 보기 등)는 못 한다(2026-10-09 선).
 *     본문 편집(canEditPost)은 넓히지 않는다(2026-10-23 «owner/admin 예외 없음»).
 */
async function canManageRows(user, post, rows) {
  if ((rows || []).some((r) => Number(r.requester_user_id) === Number(user.id))) return true;
  if (!post) return false;
  const { canReadPost, canEditPost } = require('./postAccess');
  if (await canEditPost(user.id, post, user.platform_role)) return true;
  return (await isWorkspaceManager(user, post.business_id)) && !!(await canReadPost(user, post));
}

/** 보는 사람 기준 문서 문 — posts 배열 → Map<post_id, {can_read, can_edit?, edit_block?}> */
async function docAccessMap(user, posts) {
  const { canReadPost, canEditPost } = require('./postAccess');
  const { assertMemberOrAbove } = require('../middleware/access_scope');
  const { isPostSignatureLocked } = require('./signatureCore');
  const { roundRows, canCloseRows } = require('./signatureRound');
  const isAdminUser = user.platform_role === 'platform_admin';
  const map = new Map();
  for (const p of posts) {
    const can_read = !!(await canReadPost(user, p));
    if (!can_read) { map.set(p.id, { can_read: false }); continue; }
    const can_edit = !!(await assertMemberOrAbove(user.id, p.business_id, isAdminUser ? 'platform_admin' : null))
      && !!(await canEditPost(user.id, p, user.platform_role));
    let edit_block = can_edit ? null : 'no_permission';
    if (can_edit && await isPostSignatureLocked(p.id)) {
      edit_block = canCloseRows(await roundRows(p.id)) ? 'signature_locked' : 'signature_signed';
    }
    map.set(p.id, { can_read: true, can_edit, edit_block });
  }
  return map;
}

/** 읽을 수 없는 문서의 행 — 건수·상태·요청자·만료만 */
function hiddenRow(sr) {
  return {
    id: sr.id, entity_type: sr.entity_type, kind: sr.kind || 'sign', business_id: sr.business_id,
    requester_user_id: sr.requester_user_id,
    status: sr.status, party: sr.party || 'them', slot: sr.slot ?? null,
    signer_name: sr.signer_name || null, signer_email: maskEmail(sr.signer_email),
    created_at: createdOf(sr), expires_at: sr.expires_at, signed_at: sr.signed_at,
    superseded_at: sr.superseded_at || null, reminder_count: sr.reminder_count,
    entity_title: null, hidden: true,
    doc: { can_read: false },
    can_manage: false,
  };
}

/** 문서 id 들 → Post 행(읽기·편집 판정이 범위 칸을 쓴다) */
async function loadPosts(rows) {
  const ids = [...new Set(rows.filter((r) => r.entity_type === 'post').map((r) => r.entity_id))];
  return ids.length ? Post.findAll({ where: { id: ids } }) : [];
}

module.exports = { serialize, maskEmail, isWorkspaceManager, canManageRows, docAccessMap, hiddenRow, loadPosts };
