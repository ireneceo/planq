// services/invoiceAttachments.js — 청구서 첨부(파일·문서)의 **판정 한 곳**.
//
//   Irene(2026-11-25): *"청구서에 출처문서만 연결할 수 있는데 문서든 파일이든 업로드든 첨부문서/파일들도 넣을 수 있어야 해."*
//   설계: docs/INVOICE_ATTACHMENTS_DESIGN.md (Fable 설계 판정)
//
// 이 파일을 부르는 곳: 생성(POST /api/invoices/:biz) · 복제 · 첨부 라우트(routes/invoice_attachments.js) ·
//   공개 청구서 응답 · 공개 내려받기. **같은 술어를 베끼지 않는다** — 토글 저장·공개 목록·공개 내려받기·고객 GET 이
//   모두 publicAttachmentReason 하나를 부른다(한쪽만 고치면 «목록엔 있는데 받으면 404» 가 된다).
//
// 규칙
//   - 붙일 때: 같은 워크스페이스 · 지워지지 않음 · **붙이는 사람이 읽을 수 있음**(공유·참조 규칙 ⑤).
//     없음·남의 것·못 읽음은 모두 같은 404 `attachment_target_not_found`(존재를 알리지 않는다).
//   - 밖으로(고객·공개 링크): client_visible ∧ 원본이 지금도 내보낼 수 있음 — 매 요청 다시 판정.
//     파일 = 미삭제 · 보안등급 일반 · 나만 보기(L1) 아님 / 문서 = 이미 외부 공유(L4 토큰)로 열려 있고 보안등급 일반.
//     문서 공유 토큰을 우리가 새로 만들지 않는다(문서 공유 권한·등급 검사를 우회하게 된다). 출처 문서(B-④)는 그대로 제목만.
//   - 메일에는 싣지 않는다 — 공개 페이지 링크가 매번 다시 판정한다(한번 나간 첨부는 회수가 안 된다).
const { blocksExternalShare } = require('./securityLevel');
const { shareOpenReason } = require('./shareOpenable');

const MAX_ATTACHMENTS = 20;

class AttachError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

/** 파일·문서 하나가 지금 밖으로 나갈 수 있는가 — null 이면 나간다. 그 외는 숨김 이유 키. */
function publicTargetReason(att, file, post) {
  if (att.file_id) {
    if (!file || file.deleted_at || file.purged_at) return 'deleted';
    if (blocksExternalShare(file)) return 'confidential';
    const v = file.vlevel || file.visibility;
    if (!v || v === 'L1') return 'private';
    // L2 지정 멤버 — 사람이 일부러 좁힌 값. 폴더 공유 링크(shareOpenable.folderLinkExcludeReason 'targeted')와 같은 폭으로 뺀다
    //   (Fable 완료 검증 비차단 1 — 두 공개 문의 폭이 달랐다).
    if (v === 'L2' && Array.isArray(file.target_member_ids) && file.target_member_ids.length > 0) return 'private';
    return null;
  }
  if (!post || post.deleted_at) return 'deleted';
  if (blocksExternalShare(post)) return 'confidential';
  if (shareOpenReason('post', post)) return 'post_not_shared';
  return null;
}

/** 첨부 행이 밖으로 나가는가 — client_visible 까지. */
function publicAttachmentReason(att, file, post) {
  if (!att.client_visible) return 'internal';
  return publicTargetReason(att, file, post);
}

/**
 * 요청자가 이 원본을 지금 읽을 수 있는가 — 켜기(PATCH)가 쓴다(공유·참조 규칙 ⑤). 붙이기(attachableRows)·복제(copyForDuplicate)·
 *   목록(memberList)은 같은 두 술어(canAccessFileByLevel·canReadPost)를 각자 부른다 — 다음에 손댈 때 이 함수로 모은다(Fable 2차 비차단 1).
 *   Fable 완료 검증 차단 1(2026-11-25): PATCH(켜기)만 이 검사가 빠져, 멤버가 직접 받기 403 인 파일을
 *   «고객에게 보이기» 로 켜서 무인증 공개 링크로 받았다.
 */
async function canReadTarget(user, file, post, scope) {
  const as = require('../middleware/access_scope');
  if (file) return !file.deleted_at && await as.canAccessFileByLevel(user.id, file, scope);
  if (post) return !post.deleted_at && await require('./postAccess').canReadPost(user, post);
  return false;
}

/** 요청자가 이 원본을 **밖으로 내보낼** 수 있는가 — «고객에게 보이기» 를 켤 때(만들 때 켜기 포함).
 *  열람 요청 승인(읽기 전용)은 빼고 본다 — 승인으로만 읽는 사람이 원본을 무인증 공개 링크로 내보내지 못하게
 *  (access_scope.canShareFile · postAccess.canSharePost, 2026-11-25 Fable 완료 검증 2차). */
async function canShareTarget(user, file, post, scope) {
  if (file) return !file.deleted_at && await require('../middleware/access_scope').canShareFile(scope, user.id, file);
  if (post) return !post.deleted_at && await require('./postAccess').canSharePost(user, post);
  return false;
}

/** 행들의 원본(File·Post)을 읽는다 — 지워진 것도 같이(내부 목록은 «삭제된 자료» 로 그린다). */
async function loadTargets(rows, businessId, { transaction } = {}) {
  const { File, Post } = require('../models');
  const fids = [...new Set(rows.map((r) => r.file_id).filter(Boolean))];
  const pids = [...new Set(rows.map((r) => r.post_id).filter(Boolean))];
  const files = new Map();
  const posts = new Map();
  if (fids.length) for (const f of await File.findAll({ where: { id: fids, business_id: businessId }, transaction })) files.set(f.id, f);
  if (pids.length) for (const p of await Post.findAll({ where: { id: pids, business_id: businessId }, paranoid: false, transaction })) posts.set(p.id, p);
  return { files, posts };
}

/**
 * 붙이려는 목록을 검증해 새 행으로 바꾼다. 이미 붙은 것은 건너뛴다(멱등).
 * @param {Array<{file_id?, post_id?, client_visible?}>} list
 * @returns {Promise<Array<object>>} bulkCreate 할 행
 */
async function attachableRows({ list, businessId, invoiceId, user, existing = [], transaction }) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return [];
  const { File, Post } = require('../models');
  const as = require('../middleware/access_scope');
  const { canReadPost } = require('./postAccess');
  for (const a of items) {
    const fid = Number(a && a.file_id) || null;
    const pid = Number(a && a.post_id) || null;
    if (!!fid === !!pid) throw new AttachError('attachment_target_invalid');
  }
  const seen = new Set(existing.map((r) => (r.file_id ? `f${r.file_id}` : `p${r.post_id}`)));
  const fresh = [];
  for (const a of items) {
    const key = a.file_id ? `f${Number(a.file_id)}` : `p${Number(a.post_id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(a);
  }
  if (existing.length + fresh.length > MAX_ATTACHMENTS) throw new AttachError('too_many_attachments');
  if (!fresh.length) return [];

  const scope = await as.getUserScope(user.id, businessId, user.platform_role);
  const rows = [];
  let order = existing.reduce((m, r) => Math.max(m, (r.sort_order || 0) + 1), 0);
  for (const a of fresh) {
    const fid = Number(a.file_id) || null;
    const pid = Number(a.post_id) || null;
    let file = null;
    let post = null;
    if (fid) {
      file = await File.findOne({ where: { id: fid, business_id: businessId, deleted_at: null }, transaction });
      if (!file || !(await as.canAccessFileByLevel(user.id, file, scope))) throw new AttachError('attachment_target_not_found', 404);
    } else {
      post = await Post.findOne({ where: { id: pid, business_id: businessId }, transaction });
      if (!post || !(await canReadPost(user, post))) throw new AttachError('attachment_target_not_found', 404);
    }
    const visible = a.client_visible === true;
    if (visible) {
      if (!(await canShareTarget(user, file, post, scope))) throw new AttachError('attachment_target_not_found', 404);
      const why = publicTargetReason({ file_id: fid, post_id: pid }, file, post);
      if (why) throw new AttachError(`attachment_not_shareable:${why}`);
    }
    rows.push({ business_id: businessId, invoice_id: invoiceId, file_id: fid, post_id: pid,
      client_visible: visible, sort_order: order, created_by: user.id });
    order += 1;
  }
  return rows;
}

/**
 * 발행 창(아직 청구서 id 없음)이 고른 자료의 이름·켤 수 있는가를 읽는다 — 붙이기와 **같은 검증**(attachableRows)을 거친다.
 * 아무것도 저장하지 않는다. 못 읽는 것은 attachableRows 처럼 404 로 거절한다.
 */
async function previewTargets({ list, businessId, user }) {
  const rows = await attachableRows({ list: (Array.isArray(list) ? list : []).map((a) => ({ file_id: a.file_id, post_id: a.post_id })), businessId, invoiceId: 0, user });
  const { files, posts } = await loadTargets(rows, businessId);
  return rows.map((r) => {
    const file = r.file_id ? files.get(r.file_id) : null;
    const post = r.post_id ? posts.get(r.post_id) : null;
    const base = { kind: r.file_id ? 'file' : 'post', file_id: r.file_id, post_id: r.post_id, shareable_reason: publicTargetReason(r, file, post) };
    return file ? { ...base, name: file.file_name, size: Number(file.file_size) || 0, mime_type: file.mime_type || null }
      : { ...base, name: post.title, category: post.category || null };
  });
}

/** 생성 라우트 — 같은 트랜잭션에서 넣는다(실패하면 생성 전체가 취소된다). */
async function setOnCreate({ invoice, list, user, transaction }) {
  const { InvoiceAttachment } = require('../models');
  const rows = await attachableRows({ list, businessId: invoice.business_id, invoiceId: invoice.id, user, transaction });
  if (rows.length) await InvoiceAttachment.bulkCreate(rows, { transaction });
  return rows.length;
}

/** 복제 — 포인터 행만 복사(복사 계약 «첨부 연결은 따라간다»). 지워진 원본·복사하는 사람이 못 읽는 원본은 건너뛴다. */
async function copyForDuplicate({ srcInvoiceId, copy, user, transaction }) {
  const { InvoiceAttachment } = require('../models');
  const as = require('../middleware/access_scope');
  const { canReadPost } = require('./postAccess');
  const src = await InvoiceAttachment.findAll({ where: { invoice_id: srcInvoiceId, business_id: copy.business_id }, order: [['sort_order', 'ASC'], ['id', 'ASC']], transaction });
  if (!src.length) return 0;
  const { files, posts } = await loadTargets(src, copy.business_id, { transaction });
  const scope = await as.getUserScope(user.id, copy.business_id, user.platform_role);
  const rows = [];
  for (const r of src) {
    if (r.file_id) {
      const f = files.get(r.file_id);
      if (!f || f.deleted_at || !(await as.canAccessFileByLevel(user.id, f, scope))) continue;
    } else {
      const p = posts.get(r.post_id);
      if (!p || p.deleted_at || !(await canReadPost(user, p))) continue;
    }
    // «고객에게 보이기» 는 복제하는 사람이 밖으로 내보낼 수 있을 때만 이어받는다(열람 요청 승인 = 읽기 전용)
    const visible = !!r.client_visible && await canShareTarget(user, files.get(r.file_id) || null, posts.get(r.post_id) || null, scope);
    rows.push({ business_id: copy.business_id, invoice_id: copy.id, file_id: r.file_id, post_id: r.post_id,
      client_visible: visible, sort_order: r.sort_order, created_by: user.id });
  }
  if (rows.length) await InvoiceAttachment.bulkCreate(rows, { transaction });
  return rows.length;
}

/**
 * 멤버(우리 쪽)가 보는 목록 — 보는 사람 기준. 못 읽는 자료는 제목 없이 locked.
 * 줄마다 public_state: 'shown' 또는 숨김 이유 키(internal·deleted·private·confidential·post_not_shared).
 */
async function memberList(invoice, user) {
  const { InvoiceAttachment } = require('../models');
  const as = require('../middleware/access_scope');
  const { canReadPost } = require('./postAccess');
  const rows = await InvoiceAttachment.findAll({ where: { invoice_id: invoice.id, business_id: invoice.business_id }, order: [['sort_order', 'ASC'], ['id', 'ASC']], limit: MAX_ATTACHMENTS });
  const { files, posts } = await loadTargets(rows, invoice.business_id);
  const scope = await as.getUserScope(user.id, invoice.business_id, user.platform_role);
  const out = [];
  for (const r of rows) {
    const file = r.file_id ? files.get(r.file_id) || null : null;
    const post = r.post_id ? posts.get(r.post_id) || null : null;
    const why = publicAttachmentReason(r, file, post);
    const base = { id: r.id, kind: r.file_id ? 'file' : 'post', file_id: r.file_id, post_id: r.post_id,
      client_visible: !!r.client_visible, public_state: why || 'shown',
      // 켤 수 있는가(토글 비활성 + 이유) — client_visible 을 뺀 원본 판정
      shareable_reason: publicTargetReason(r, file, post) };
    const gone = r.file_id ? (!file || file.deleted_at) : (!post || post.deleted_at);
    // 지워졌거나 못 읽는 줄은 원본 id 를 싣지 않는다(화이트리스트 — Fable 비차단 3)
    const hidden = { ...base, file_id: null, post_id: null, shareable_reason: null };
    if (gone) { out.push({ ...hidden, deleted: true, name: null }); continue; }
    const readable = r.file_id ? await as.canAccessFileByLevel(user.id, file, scope) : await canReadPost(user, post);
    if (!readable) { out.push({ ...hidden, locked: true, name: null }); continue; }
    if (file) out.push({ ...base, name: file.file_name, size: Number(file.file_size) || 0, mime_type: file.mime_type || null });
    else out.push({ ...base, name: post.title, category: post.category || null });
  }
  return out;
}

/** 밖으로 나가는 목록(공개 페이지·고객) — 통과한 것만, 화이트리스트 칸만. 내부용은 개수도 내보내지 않는다. */
async function publicList(invoice, token) {
  const { InvoiceAttachment } = require('../models');
  const rows = await InvoiceAttachment.findAll({ where: { invoice_id: invoice.id, business_id: invoice.business_id, client_visible: true }, order: [['sort_order', 'ASC'], ['id', 'ASC']], limit: MAX_ATTACHMENTS });
  if (!rows.length) return [];
  const { files, posts } = await loadTargets(rows, invoice.business_id);
  const out = [];
  for (const r of rows) {
    const file = r.file_id ? files.get(r.file_id) || null : null;
    const post = r.post_id ? posts.get(r.post_id) || null : null;
    if (publicAttachmentReason(r, file, post)) continue;
    if (file) {
      out.push({ id: r.id, kind: 'file', name: file.file_name, size: Number(file.file_size) || 0, mime_type: file.mime_type || null,
        download_url: token ? `/api/invoices/public/${token}/attachments/${r.id}/download` : null });
    } else {
      out.push({ id: r.id, kind: 'post', name: post.title, url: `/public/posts/${post.share_token}` });
    }
  }
  return out;
}

module.exports = {
  MAX_ATTACHMENTS, AttachError, publicTargetReason, publicAttachmentReason, loadTargets,
  canReadTarget, canShareTarget, attachableRows, previewTargets, setOnCreate, copyForDuplicate, memberList, publicList,
};
