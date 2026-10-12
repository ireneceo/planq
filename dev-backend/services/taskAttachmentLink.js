// services/taskAttachmentLink.js — 이미 있는 PlanQ 파일을 업무에 붙인다(메타만 복사 · 물리 파일은 원본 File 과 공유).
//   업무 화면 «기존 파일 연결»(routes/task_attachments POST /:taskId/attachments/link)과
//   AI 에이전트 upload_file(대상=업무)이 **같은 함수**를 부른다(2026-10-05 라우트에서 떼어 냄, 동작 무변경).
//   호출자 책임: 업무 접근 판정(canAccessTask) · 파일 가시성(canUserSeeFile) · 같은 워크스페이스 파일만 넘기기.
const { TaskAttachment } = require('../models');

async function linkFilesToTask(task, files, userId, { context = 'task', commentId = null } = {}) {
  const created = [];
  for (const f of files) {
    const att = await TaskAttachment.create({
      business_id: task.business_id,
      task_id: task.id,
      comment_id: commentId,
      context,
      original_name: f.file_name,
      stored_name: f.file_path.split('/').pop() || f.file_name,
      file_path: f.file_path,
      file_size: f.file_size,
      mime_type: f.mime_type,
      uploaded_by: userId,
      storage_provider: f.storage_provider,
      external_id: f.external_id,
      external_url: f.external_url,
    });
    created.push(att);
  }
  return created;
}

// 문서(post) 첨부 행을 파일과 구별하는 표식 — 화면이 이 값으로 아이콘·링크를 가른다(routes/task_attachments 와 같은 값).
const POST_MIME = 'application/vnd.planq.post';

/**
 * 문서(post)를 업무에 붙인다 — 물리 파일이 없다. NOT NULL 칸은 값으로 채운다(스키마 nullability 에 기대지 않는다).
 *   업무 화면 «문서 연결»(routes/task_attachments POST /:taskId/attachments/link)과 업무 «결과물 액션»
 *   (services/taskActionItems.fulfill)이 **같은 함수**를 부른다(2026-10-12 라우트에서 떼어 냄, 동작 무변경).
 *   같은 문서를 같은 자리에 두 번 붙이지 않는다 — 이미 있으면 건너뛰고 `created` 에 넣지 않는다.
 *   호출자 책임: 업무 접근 판정 · 문서 읽기 판정(canReadPost) · 같은 워크스페이스 문서만 넘기기.
 * @returns [{ att, post }] — 이번에 새로 만든 행만
 */
async function linkPostsToTask(task, posts, userId, { context = 'task', commentId = null, transaction } = {}) {
  const created = [];
  for (const p of posts) {
    const dup = await TaskAttachment.findOne({
      where: { task_id: task.id, post_id: p.id, context, ...(commentId ? { comment_id: commentId } : {}) },
      transaction,
    });
    if (dup) continue;
    const att = await TaskAttachment.create({
      business_id: task.business_id,
      task_id: task.id,
      comment_id: commentId,
      context,
      post_id: p.id,
      original_name: String(p.title || '(제목 없음)').slice(0, 500),
      stored_name: '',
      file_path: '',
      file_size: 0,
      mime_type: POST_MIME,
      uploaded_by: userId,
    }, { transaction });
    created.push({ att, post: p });
  }
  return created;
}

module.exports = { linkFilesToTask, linkPostsToTask, POST_MIME };
