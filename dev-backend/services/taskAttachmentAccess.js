// services/taskAttachmentAccess.js — 업무 첨부의 **댓글 축** 판정 (2026-09-27 보안 점검).
//   routes/task_attachments.js 의 업로드·연결·목록·다운로드가 같은 두 함수를 쓴다(목록만 막으면 다운로드로 샌다).
const { TaskComment } = require('../models');

// 댓글 첨부는 **이 업무의 댓글**에만 — 다른 업무의 댓글 id 를 넣어 첨부를 끼워 넣을 수 있었다(2026-09-27 점검).
async function commentBelongs(task, commentId) {
  if (!commentId) return true;
  return !!(await TaskComment.findOne({ where: { id: commentId, task_id: task.id }, attributes: ['id'] }));
}

// 고객이 볼 수 있는 댓글 첨부인가 — 고객 화면은 «공유(shared)» 댓글만 보여 준다(utils/taskClientView 와 같은 기준).
//   댓글이 숨겨져도 그 첨부는 목록·다운로드로 받아졌다(2026-09-27 점검).
async function clientHiddenCommentIds(taskId) {
  const rows = await TaskComment.findAll({ where: { task_id: taskId }, attributes: ['id', 'visibility'] });
  return new Set(rows.filter((c) => c.visibility !== 'shared').map((c) => c.id));
}

module.exports = { commentBelongs, clientHiddenCommentIds };
