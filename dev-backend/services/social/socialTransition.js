// 인사이트 글 SNS 게시물 — 상태를 바꾸는 문은 이 파일 하나다 (docs/SNS_PUBLISH_DESIGN.md §2).
//   단계 1 의 전이: draft →(승인) approved → (반자동 채널) [게시함 표시] sent
//                   승인·예약 뒤 본문을 고치면 draft (승인한 것과 나가는 것이 같아야 한다 — Fable 지적 6)
//                   draft/approved/scheduled →(취소) canceled · canceled →(다시 살리기) draft
//   sending·sent·canceled 수정은 409. 자동 채널의 예약·발송(scheduled·sending)은 단계 2 에서 이 파일에 더한다.
//   매 전이: social_post_logs(게시물 일대기) + writeAudit(관리자 행위, Fable 지적 9) — 같은 트랜잭션.
const { sequelize } = require('../../config/database');
const { SocialPost, SocialPostLog } = require('../../models');
const { writeAudit } = require('../auditService');
const { channelOf, isSemi } = require('./channels');

class TransitionError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

const EDITABLE = new Set(['draft', 'approved', 'scheduled', 'failed']);
const CANCELABLE = new Set(['draft', 'approved', 'scheduled']);

async function lockPost(id, t) {
  const post = await SocialPost.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
  if (!post) throw new TransitionError('not_found', 404);
  return post;
}

async function record(post, { from, to, action, userId, message }, t) {
  await SocialPostLog.create({ post_id: post.id, from_status: from, to_status: to, action, user_id: userId || null, message: message || null }, { transaction: t });
  await writeAudit({
    userId, businessId: null, action: `social.${action}`, targetType: 'social_post', targetId: post.id,
    oldValue: from ? { status: from } : null, newValue: { status: to, provider: post.provider, article_id: post.article_id },
  }, { transaction: t });
}

/** 본문·첫 댓글 수정. 승인·예약된 것을 고치면 draft 로 돌아간다. */
async function editContent(id, patch, userId) {
  return sequelize.transaction(async (t) => {
    const post = await lockPost(id, t);
    if (!EDITABLE.has(post.status)) throw new TransitionError(`not_editable_${post.status}`);
    const next = {};
    if (typeof patch.body === 'string') next.body = patch.body.slice(0, Math.max(channelOf(post.provider)?.maxChars || 5000, 1) * 2);
    if (patch.first_comment !== undefined) next.first_comment = patch.first_comment == null ? null : String(patch.first_comment).slice(0, 2000);
    if (!Object.keys(next).length) return post;
    const changed = Object.keys(next).some((k) => (post[k] ?? null) !== (next[k] ?? null));
    if (!changed) return post;
    const from = post.status;
    if (from !== 'draft') Object.assign(next, { status: 'draft', approved_by: null, approved_at: null, scheduled_at: null });
    await post.update(next, { transaction: t });
    await record(post, { from, to: post.status, action: from === 'draft' ? 'edit' : 'edit_unapprove', userId }, t);
    return post;
  });
}

async function approve(id, userId) {
  return sequelize.transaction(async (t) => {
    const post = await lockPost(id, t);
    if (post.status !== 'draft') throw new TransitionError(`not_draft_${post.status}`);
    if (!String(post.body || '').trim()) throw new TransitionError('empty_body', 400);
    await post.update({ status: 'approved', approved_by: userId, approved_at: new Date() }, { transaction: t });
    await record(post, { from: 'draft', to: 'approved', action: 'approve', userId }, t);
    return post;
  });
}

/** 반자동 채널(네이버·카카오) — 사람이 직접 올린 뒤 «게시함» 을 표시한다. external_url 은 선택(우리 쪽 기록). */
async function markPosted(id, userId, externalUrl) {
  return sequelize.transaction(async (t) => {
    const post = await lockPost(id, t);
    if (!isSemi(post.provider)) throw new TransitionError('not_semi_channel', 400);
    if (post.status !== 'approved') throw new TransitionError(`not_approved_${post.status}`);
    let url = null;
    if (externalUrl) {
      try {
        const u = new URL(String(externalUrl));
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('proto');
        url = u.toString().slice(0, 500);
      } catch { throw new TransitionError('bad_url', 400); }
    }
    await post.update({ status: 'sent', sent_at: new Date(), external_url: url }, { transaction: t });
    await record(post, { from: 'approved', to: 'sent', action: 'mark_posted', userId, message: url }, t);
    return post;
  });
}

async function cancel(id, userId) {
  return sequelize.transaction(async (t) => {
    const post = await lockPost(id, t);
    if (!CANCELABLE.has(post.status)) throw new TransitionError(`not_cancelable_${post.status}`);
    const from = post.status;
    await post.update({ status: 'canceled', scheduled_at: null }, { transaction: t });
    await record(post, { from, to: 'canceled', action: 'cancel', userId }, t);
    return post;
  });
}

async function restore(id, userId) {
  return sequelize.transaction(async (t) => {
    const post = await lockPost(id, t);
    if (post.status !== 'canceled') throw new TransitionError(`not_canceled_${post.status}`);
    await post.update({ status: 'draft', approved_by: null, approved_at: null }, { transaction: t });
    await record(post, { from: 'canceled', to: 'draft', action: 'restore', userId }, t);
    return post;
  });
}

/** 소재 만들기로 생긴 게시물 — 생성도 원장에 남긴다. */
async function createDrafts(rows, userId) {
  return sequelize.transaction(async (t) => {
    const out = [];
    for (const r of rows) {
      const post = await SocialPost.create({ ...r, status: 'draft', created_by: userId }, { transaction: t });
      await record(post, { from: null, to: 'draft', action: 'create', userId }, t);
      out.push(post);
    }
    return out;
  });
}

module.exports = { editContent, approve, markPosted, cancel, restore, createDrafts, TransitionError };
