// services/fileRefs.js — «이 바이트를 아직 누가 쓰고 있는가» 의 **단일 술어**.
//
// 왜 뽑았나 (2026-09-17, Fable 10차 비차단 #2·#3):
//   같은 질문의 공식이 **네 벌**이었다 —
//     trash(routes/files.js)   : File + TaskAttachment
//     restore(routes/file_trash.js): File + TaskAttachment + MessageAttachment
//     purge(services/filePurge.js) : File + 문서버전 + TaskAttachment + MessageAttachment
//     export(services/exportJobWorker.js): File + TaskAttachment
//   한쪽만 고치면 **반대 방향으로 벌어진다**(쿼터 과계수/과소계수, 산 첨부의 바이트 삭제).
//   memory `feedback_same_value_multiple_formulas`.
//
// 그리고 더 나쁜 것: 비교 자체가 **죽어 있었다**.
//   `File.file_path` 는 절대경로(`/opt/planq/dev-backend/uploads/...`)인데
//   첨부 테이블은 업로드·링크 경로에 따라 **상대경로**(`uploads/...`)로도 저장된다
//   (`routes/message_attachments.js:198` · `task_attachments.js:133` 의 `path.relative`).
//   그래서 `file_path` 완전일치 비교는 운영에서 **한 번도 참이 되지 않았다**
//   (Fable 실측: 링크 채팅첨부 7건 중 일치 0/7). 즉 «산 첨부 보호» 가드가 꺼져 있었고,
//   purge 가 살아 있는 첨부의 바이트를 지울 수 있었다.
//
// 계약: 경로는 **두 표기를 모두** 물어본다(`[Op.in]`). LIKE 스캔이 아니라 완전일치라
//   인덱스를 그대로 탄다. 새 표기가 생기면 `pathVariants` 한 곳만 늘린다.
const path = require('path');
const { Op } = require('sequelize');

const BACKEND_ROOT = path.join(__dirname, '..');

/** 한 경로가 DB 에 저장돼 있을 수 있는 표기 전부 (절대 / 백엔드 루트 기준 상대). */
function pathVariants(p) {
  if (!p) return [];
  const s = String(p).replace(/\\/g, '/');
  const abs = (path.isAbsolute(s) ? s : path.join(BACKEND_ROOT, s)).replace(/\\/g, '/');
  const rel = path.relative(BACKEND_ROOT, abs).replace(/\\/g, '/');
  return Array.from(new Set([s, abs, rel].filter(Boolean)));
}

/**
 * 이 파일의 바이트를 참조하는 **다른 산 행**의 수.
 *   - File 형제: 같은 경로 · 미삭제 · 자기 자신 제외
 *   - 업무 첨부 · 메시지 첨부: 같은 경로(두 표기)
 *
 * ★ 워크스페이스로 다시 거르지 않는다 — 틀리더라도 «못 보는» 쪽이 아니라 «더 보는» 쪽으로
 *   틀려야 한다(못 보면 산 바이트를 지운다). `business_id` 를 더 걸면 컬럼이 비었거나 어긋난
 *   행을 놓친다.
 *   ★ "경로가 곧 워크스페이스 축" 은 **완전하지 않다** (2026-09-17, Fable 11차 ② 실측):
 *     `uploads/editor-images/...` 는 business 세그먼트가 없다(운영 82행·dev 44행).
 *     파일명이 UUID 라 실제 충돌은 없고(정규화 경로가 두 워크스페이스에 걸친 행 dev 0·운영 0),
 *     설령 충돌해도 «더 본다» = 안 지운다 쪽이라 안전하다. 전제가 아니라 안전 방향이 근거다.
 */
async function countLiveRefs(file, transaction, opts = {}) {
  const variants = pathVariants(file && file.file_path);
  const out = { fileSiblings: 0, taskAttachments: 0, messageAttachments: 0, total: 0, variants };
  if (!variants.length) return out;

  const { File, TaskAttachment, MessageAttachment } = require('../models');
  const where = { file_path: { [Op.in]: variants } };

  // 주체(지금 지우려는 행)는 자기 자신을 참조로 세면 안 된다. 주체가 File 이면 excludeFileId,
  // 첨부면 excludeTaskAttachmentId / excludeMessageAttachmentId 로 알린다.
  const excludeFileId = opts.excludeFileId !== undefined ? opts.excludeFileId : (file && file.id);
  // ★ 형제를 세는 **질문이 둘**이다 (2026-09-17, Fable 11차 D3 — 하나로 묶었다가 지적받았다):
  //   ⒜ 쿼터: «지금 살아 있는 것» — 휴지통 행은 이미 바이트를 반환했으므로 세지 않는다.
  //   ⒝ 물리삭제(unlink): «바이트가 아직 필요한가» — 휴지통에 있어도 **복구 가능한 행**
  //      (`purged_at IS NULL`)은 그 바이트가 있어야 한다. 여기서 `deleted_at: null` 로 세면
  //      dedup 쌍둥이를 둘 다 휴지통에 넣고 한쪽만 영구삭제했을 때 **다른 쪽 복구가 410** 이 된다.
  const fileWhere = { ...where };
  if (opts.siblingScope === 'unpurged') fileWhere.purged_at = null;
  else fileWhere.deleted_at = null;
  if (excludeFileId) fileWhere.id = { [Op.ne]: excludeFileId };

  const taskWhere = { ...where };
  if (opts.excludeTaskAttachmentId) taskWhere.id = { [Op.ne]: opts.excludeTaskAttachmentId };
  const msgWhere = { ...where };
  if (opts.excludeMessageAttachmentId) msgWhere.id = { [Op.ne]: opts.excludeMessageAttachmentId };

  const [fileSiblings, taskAttachments, messageAttachments] = await Promise.all([
    File.count({ where: fileWhere, transaction }),
    TaskAttachment ? TaskAttachment.count({ where: taskWhere, transaction }) : 0,
    MessageAttachment ? MessageAttachment.count({ where: msgWhere, transaction }) : 0,
  ]);

  out.fileSiblings = fileSiblings;
  out.taskAttachments = taskAttachments;
  out.messageAttachments = messageAttachments;
  out.total = fileSiblings + taskAttachments + messageAttachments;
  return out;
}

/** 이 행이 그 바이트의 **마지막 산 참조**인가 — 쿼터를 더하고 뺄 때의 판정(⒜). */
async function isLastLiveRef(file, transaction) {
  if (!file || file.storage_provider !== 'planq' || !file.file_path) return true;
  const r = await countLiveRefs(file, transaction);
  return r.total === 0;
}

/** 이 바이트가 **아직 필요한가** — 물리 파일을 지우기 전의 판정(⒝).
 *  휴지통에 있어도 복구 가능한 행(`purged_at IS NULL`)과 첨부는 바이트를 필요로 한다. */
async function bytesStillNeeded(file, transaction, opts = {}) {
  if (!file || !file.file_path) return true;
  const r = await countLiveRefs(file, transaction, { ...opts, siblingScope: 'unpurged' });
  return r.total > 0;
}

module.exports = { pathVariants, countLiveRefs, isLastLiveRef, bytesStillNeeded, BACKEND_ROOT };
