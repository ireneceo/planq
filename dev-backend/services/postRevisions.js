// 포스트 버전 기록 — 쓰기·정리·복원의 단일 착지점 (2026-08-25).
//
// 라우트가 직접 revision 을 만들기 시작하면 합치기 규칙과 상한이 경로마다 갈라진다.
// (같은 계열 사고: routes 가 알림을 각자 보내던 leave.js → services/leaveTransition.js 로 모은 것)
const { Op } = require('sequelize');
const { PostRevision } = require('../models');

/** 같은 사람이 이 시간 안에 이어 쓰면 마지막 버전을 갱신한다(새 행을 만들지 않는다). */
const COALESCE_WINDOW_MS = 10 * 60 * 1000;   // 10분
/** 문서당 보관 상한. 넘으면 오래된 것부터 지운다 — 넣을 때 정리하므로 cron 불필요. */
const MAX_PER_POST = 50;

/**
 * 현재 내용을 버전으로 남긴다.
 * @returns {Promise<{action:'created'|'coalesced'|'skipped', revisionNumber:number|null}>}
 */
async function recordRevision({ post, editorUserId, source = 'autosave' }) {
  if (!post || !post.id) return { action: 'skipped', revisionNumber: null };
  const contentStr = post.content_json == null ? null : String(post.content_json);
  const last = await PostRevision.findOne({
    where: { post_id: post.id, business_id: post.business_id },
    order: [['revision_number', 'DESC']],
  });

  // 내용이 그대로면 버전을 남기지 않는다 — 저장 요청이 곧 변경은 아니다.
  if (last && last.title === post.title && last.content_json === contentStr && last.category === (post.category ?? null)) {
    return { action: 'skipped', revisionNumber: last.revision_number };
  }

  const now = Date.now();
  const lastAt = last ? new Date(last.created_at || last.createdAt).getTime() : 0;
  const sameEditor = last && last.editor_user_id === editorUserId;
  const withinWindow = last && (now - lastAt) < COALESCE_WINDOW_MS;

  // 합치기 — 같은 사람이 짧은 시간 안에 이어 쓰는 것은 한 번의 편집이다.
  //   ★ 복원(restore)은 절대 합치지 않는다. "되돌린 시점" 은 그 자체로 남아야 한다.
  if (last && sameEditor && withinWindow && source !== 'restore' && last.source !== 'restore') {
    await last.update({
      title: post.title, content_json: contentStr, category: post.category ?? null,
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
    editor_user_id: editorUserId || null,
    source,
    byte_size: contentStr ? Buffer.byteLength(contentStr) : 0,
  });
  await pruneOld(post.id, post.business_id);
  return { action: 'created', revisionNumber: nextNo };
}

/** 상한 초과분 제거 — 오래된 것부터. */
async function pruneOld(postId, businessId) {
  const total = await PostRevision.count({ where: { post_id: postId, business_id: businessId } });
  if (total <= MAX_PER_POST) return 0;
  const excess = total - MAX_PER_POST;
  const victims = await PostRevision.findAll({
    where: { post_id: postId, business_id: businessId },
    order: [['revision_number', 'ASC']],
    limit: excess,
    attributes: ['id'],
  });
  if (!victims.length) return 0;
  await PostRevision.destroy({ where: { id: { [Op.in]: victims.map((v) => v.id) } } });
  return victims.length;
}

module.exports = { recordRevision, pruneOld, COALESCE_WINDOW_MS, MAX_PER_POST };
