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

module.exports = { linkFilesToTask };
