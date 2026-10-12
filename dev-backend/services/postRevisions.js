// 포스트 버전 기록 — 쓰기·정리·복원의 단일 착지점 (2026-08-25).
//
// 라우트가 직접 revision 을 만들기 시작하면 합치기 규칙과 상한이 경로마다 갈라진다.
// (같은 계열 사고: routes 가 알림을 각자 보내던 leave.js → services/leaveTransition.js 로 모은 것)
const { Op } = require('sequelize');
const { PostRevision, PostAttachment } = require('../models');

/** 같은 사람이 이 시간 안에 이어 쓰면 마지막 버전을 갱신한다(새 행을 만들지 않는다). */
const COALESCE_WINDOW_MS = 10 * 60 * 1000;   // 10분
/** 문서당 보관 상한. 넘으면 오래된 것부터 지운다 — 넣을 때 정리하므로 cron 불필요. */
const MAX_PER_POST = 50;

/**
 * 현재 내용을 버전으로 남긴다.
 * @returns {Promise<{action:'created'|'coalesced'|'skipped', revisionNumber:number|null}>}
 */
async function recordRevision({ post, editorUserId, source = 'autosave', noCoalesce = false }) {
  if (!post || !post.id) return { action: 'skipped', revisionNumber: null };
  const contentStr = post.content_json == null ? null : String(post.content_json);
  // 첨부 목록 스냅샷 — 본문 안 이미지는 content_json 에 이미 있지만 하단 첨부는 별도 테이블이다.
  let attachIds = [];
  try {
    const atts = await PostAttachment.findAll({ where: { post_id: post.id }, attributes: ['file_id'] });
    attachIds = atts.map((a) => a.file_id).sort((a, b) => a - b);
  } catch { attachIds = []; }
  const attachKey = JSON.stringify(attachIds);
  const last = await PostRevision.findOne({
    where: { post_id: post.id, business_id: post.business_id },
    order: [['revision_number', 'DESC']],
  });

  // 내용이 그대로면 버전을 남기지 않는다 — 저장 요청이 곧 변경은 아니다.
  if (last && last.title === post.title && last.content_json === contentStr && last.category === (post.category ?? null)
      && JSON.stringify(last.attachment_file_ids || []) === attachKey) {
    return { action: 'skipped', revisionNumber: last.revision_number };
  }

  const now = Date.now();
  const lastAt = last ? new Date(last.created_at || last.createdAt).getTime() : 0;
  const sameEditor = last && last.editor_user_id === editorUserId;
  const withinWindow = last && (now - lastAt) < COALESCE_WINDOW_MS;

  // 합치기 — 같은 사람이 짧은 시간 안에 이어 쓰는 것은 한 번의 편집이다.
  //   ★ 복원(restore)은 절대 합치지 않는다. "되돌린 시점" 은 그 자체로 남아야 한다.
  //   ★ noCoalesce — AI 수정 반영본(services/actions/post_actions.applyAiEdit). 합치면 «AI 전» 버전이
  //     반영본으로 덮여 되돌릴 곳이 사라진다.
  //   ★ 1번(처음 버전)에는 합치지 않는다 — 첫 편집이 처음 내용을 덮으면 «원래대로» 가 사라진다.
  if (last && sameEditor && withinWindow && !noCoalesce && source !== 'restore' && last.source !== 'restore'
      && last.revision_number !== 1) {
    await last.update({
      title: post.title, content_json: contentStr, category: post.category ?? null,
      attachment_file_ids: attachIds,
      source, byte_size: contentStr ? Buffer.byteLength(contentStr) : 0,
    });
    return { action: 'coalesced', revisionNumber: last.revision_number };
  }

  const nextNo = (last ? last.revision_number : 0) + 1;
  await PostRevision.create({
    post_id: post.id,
    business_id: post.business_id,
    revision_number: nextNo,
    title: post.title,
    content_json: contentStr,
    category: post.category ?? null,
    attachment_file_ids: attachIds,
    editor_user_id: editorUserId || null,
    source,
    byte_size: contentStr ? Buffer.byteLength(contentStr) : 0,
  });
  await pruneOld(post.id, post.business_id);
  return { action: 'created', revisionNumber: nextNo };
}

/**
 * 처음 버전 — 문서에 기록이 하나도 없으면 **고치기 직전** 내용을 1번으로 남긴다(2026-10-12).
 *
 * 왜: 기록은 저장 «뒤» 내용을 남긴다. 그래서 첫 편집이 곧 1번이 되고 만든 때의 내용(또는 이 기능이
 *   생기기 전부터 있던 문서의 원래 내용)은 어디에도 없었다 — dev 실측 문서 138건 중 기록 있는 것 13건.
 *   첫 수정을 되돌릴 곳이 없으면 «되돌리기» 가 정작 처음 실수에는 안 된다.
 * 반드시 post.update **전에** 부른다. 시각·사람은 그 내용이 마지막으로 저장된 때·사람이다.
 */
async function ensureBaselineRevision(post) {
  if (!post || !post.id) return false;
  const exists = await PostRevision.count({ where: { post_id: post.id, business_id: post.business_id } });
  if (exists) return false;
  const contentStr = post.content_json == null ? null : String(post.content_json);
  let attachIds = [];
  try {
    const atts = await PostAttachment.findAll({ where: { post_id: post.id }, attributes: ['file_id'] });
    attachIds = atts.map((a) => a.file_id).sort((a, b) => a - b);
  } catch { attachIds = []; }
  const at = post.updated_at || post.updatedAt || post.created_at || post.createdAt || new Date();
  await PostRevision.create({
    post_id: post.id,
    business_id: post.business_id,
    revision_number: 1,
    title: post.title,
    content_json: contentStr,
    category: post.category ?? null,
    attachment_file_ids: attachIds,
    editor_user_id: post.editor_id || post.author_id || null,
    source: 'manual',
    byte_size: contentStr ? Buffer.byteLength(contentStr) : 0,
    createdAt: at,
    updatedAt: at,
  }, { silent: true });
  return true;
}

/** 상한 초과분 제거 — 오래된 것부터. */
async function pruneOld(postId, businessId) {
  const total = await PostRevision.count({ where: { post_id: postId, business_id: businessId } });
  if (total <= MAX_PER_POST) return 0;
  const excess = total - MAX_PER_POST;
  // ★ 1번(처음 버전)은 남긴다 — 오래된 것부터 지우면 가장 먼저 사라지는 것이 «원래 내용» 이다.
  const victims = await PostRevision.findAll({
    order: [['revision_number', 'ASC']],
    where: { post_id: postId, business_id: businessId, revision_number: { [Op.gt]: 1 } },
    limit: excess,
    attributes: ['id'],
  });
  if (!victims.length) return 0;
  await PostRevision.destroy({ where: { id: { [Op.in]: victims.map((v) => v.id) } } });
  return victims.length;
}

module.exports = { recordRevision, ensureBaselineRevision, pruneOld, COALESCE_WINDOW_MS, MAX_PER_POST };
