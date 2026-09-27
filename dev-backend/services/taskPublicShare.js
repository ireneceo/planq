// services/taskPublicShare.js — 업무 공유 링크에 **무엇이 실리는가** 한 곳 (2026-09-27, 문서 공유와 같은 맥락).
//
// Irene: *"이미 공유링크를 만들 때 보안규정 푸는 거 아니야? 문서랑 같은 맥락으로 가면 될 것 같은데?"*
//        *"웹은 최신본만 보여주고 과거 것들이 있다만 남아도 될 것 같은데?"*
//
// 실리는 것 — 목록·다운로드·발급 가드가 **같은 집합**(`shippableAttachments`)을 본다. 셋이 따로 세면 갈라진다.
//   · 결과물(task.body) = 최신본만. 과거 회차는 **개수만**(`prevVersionsCount`) — 내용·첨부·메모는 싣지 않는다.
//   · 첨부 = 결과물 첨부(context 'task', 최신 제출본의 첨부로 좁힌다) + 의뢰 첨부('description_attach').
//     댓글 첨부('comment')·본문 인라인('description')은 목록에 싣지 않는다.
//   · 그중 파일은 **원본 File 이 외부 공개(L4)** 인 것만(`isPublicFile` — 문서 공유와 같은 함수).
//     업무 첨부는 파일의 사본이라 file_id 가 없다 → 원본은 `findSourceFile`(이미지 게이트와 같은 함수)로 찾고,
//     **같은 워크스페이스**가 아니거나 못 찾으면 싣지 않는다(fail-closed).
//   · 문서형 첨부(post_id)는 내용을 싣지 않는다 — 그 문서가 **스스로 공유 중**일 때만 그 공개 링크를 싣는다.
//     업무 공유가 문서 토큰을 새로 만들지 않는다(그러면 가시성 확대 통로가 된다).
//   · 댓글·제출 메모·수정요청·컨펌자·상태 이력은 싣지 않는다.
//
// 공유를 막는 기준 — 업무에는 보안등급 칸이 없다. 그래서 **실릴 파일**에서 파생한다:
//   실릴 파일 중 하나라도 `blocksExternalShare`(internal·confidential)면 발급 403. (컬럼을 새로 만들지 않았다 — Fable 판단)
const { Op } = require('sequelize');
const { TaskAttachment, TaskDeliverableVersion, Post } = require('../models');
const { shareOpenReason, isPublicFile } = require('./shareOpenable');
const { blocksExternalShare } = require('./securityLevel');
const { findSourceFile } = require('../middleware/imageViewer');
// 비밀번호 걸린 공유의 다운로드 서명은 services/share_helper `shareSubQuery`/`verifyShareSub` 한 벌(문서 공유와 같다).
const { shareSubQuery } = require('./share_helper');

async function latestVersion(task) {
  return TaskDeliverableVersion.findOne({
    where: { task_id: task.id, review_round: { [Op.ne]: null } },
    order: [['review_round', 'DESC'], ['id', 'DESC']],
    attributes: ['id', 'review_round', 'attachment_ids'],
  });
}

/** 과거 회차 수 — 최신 제출본보다 앞선 제출본. 서버 한 공식. */
async function prevVersionsCount(task) {
  const latest = await latestVersion(task);
  if (!latest) return 0;
  return TaskDeliverableVersion.count({
    where: { task_id: task.id, review_round: { [Op.ne]: null, [Op.lt]: latest.review_round } },
  });
}

/** 실릴 후보 + 각 원본(File 또는 Post). 목록·다운로드·발급 가드 공통. */
async function shippableAttachments(task) {
  const rows = await TaskAttachment.findAll({
    where: { task_id: task.id, business_id: task.business_id, context: { [Op.in]: ['task', 'description_attach'] } },
    order: [['created_at', 'ASC']],
  });
  const latest = await latestVersion(task);
  const latestIds = latest && Array.isArray(latest.attachment_ids) ? new Set(latest.attachment_ids.map(Number)) : null;
  const out = [];
  for (const a of rows) {
    if (a.context === 'task' && latestIds && !latestIds.has(Number(a.id))) continue;   // 최신 제출본의 결과물 첨부만
    if (a.post_id) {
      const post = await Post.findOne({ where: { id: a.post_id, business_id: task.business_id } });
      out.push({ att: a, post: post || null, file: null });
      continue;
    }
    const src = await findSourceFile({ externalId: a.storage_provider === 'gdrive' ? a.external_id : null, storedName: a.stored_name });
    out.push({ att: a, post: null, file: src && Number(src.business_id) === Number(task.business_id) ? src : null });
  }
  return out;
}

/** 공개 응답용 목록 — 싣는 것만, 화이트리스트로. */
async function publicAttachmentList(task, token) {
  const list = [];
  for (const { att, post, file } of await shippableAttachments(task)) {
    if (att.post_id) {
      if (post && !blocksExternalShare(post) && !shareOpenReason('post', post)) {
        list.push({ id: att.id, kind: 'post', name: post.title, url: `/public/posts/${post.share_token}` });
      }
      continue;
    }
    if (!isPublicFile(file)) continue;
    list.push({
      id: att.id, kind: 'file', name: att.original_name, size: Number(att.file_size) || 0, mime_type: att.mime_type,
      download_url: `/api/tasks/public/by-token/${token}/attachments/${att.id}/download${shareSubQuery(task, token, `att:${att.id}`)}`,
    });
  }
  return list;
}

/** 발급을 막아야 하는가 — 실릴 파일 중 외부 공유 금지 등급이 있으면. */
async function shareBlockedBy(task) {
  for (const { file } of await shippableAttachments(task)) {
    if (file && blocksExternalShare(file)) return file;
  }
  return null;
}

/** 다운로드 판정 — 목록과 **같은 집합**에서 찾고 같은 술어로 다시 본다(한쪽만 막은 것은 막은 게 아니다). */
async function downloadableAttachment(task, attId) {
  for (const { att, file } of await shippableAttachments(task)) {
    if (Number(att.id) !== Number(attId)) continue;
    if (att.post_id || !isPublicFile(file)) return null;
    return att;
  }
  return null;
}

module.exports = { shippableAttachments, publicAttachmentList, shareBlockedBy, downloadableAttachment, prevVersionsCount };
