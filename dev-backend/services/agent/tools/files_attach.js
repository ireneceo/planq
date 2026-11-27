// AI 에이전트 도구 — 이미 PlanQ 에 있는 파일을 업무·문서에 붙이기 (2026-11-19, Fable 설계 DESIGN-READY)
//
//   Irene «클로드랑 챗지피티가 업무 추가나 문서 등 추가할 때 파일 업로드 같이 되는지 확인해. 제대로 안되었어.»
//   — 메일 첨부·list_files·upload_file 로 올린 파일을 업무/문서에 붙일 길이 없었고(메일 초안만 file_ids),
//     create_task/create_document 는 파일을 몰랐다. 클로드는 파일 바이트를 넘길 수 없다(base64 입력은 두지 않는다 — 11-18 Fable).
//
//   도구: attach_files_to_task(tasks:write+projects:read) · attach_files_to_document(docs:write+projects:read) — 둘 다 MEDIUM(확인 2단계).
//         create_task / create_document 의 file_ids(있으면 MEDIUM) — 만들기 **전에** 파일을 전부 판정(하나라도 안 되면 0건 생성).
//   ★ 실행은 화면과 같은 함수 — 업무 taskAttachmentLink.linkExistingFilesToTask(화면 /attachments/link 도) · 문서 post_actions.attachFiles.
//     AI 길은 strict(못 찾은 id 하나라도 있으면 거절) + dedupe(이미 붙은 것은 건너뛰고 already_attached).
//   ★ 왜 MEDIUM: 고른 기존 파일을 다른 청중에게 넓힌다 — 본인 «나만 보기» 파일도 통과하고, 업무 첨부는 메타 사본이라
//     원본 등급을 잃는다(내려받기는 canAccessTask 만 본다). 미리보기가 파일의 지금 범위와 볼 고객을 말한다.
//   ★ 고객이 볼 수 있는 업무에는 보안등급(internal·confidential) 파일을 붙이지 않는다 — 사본이 등급을 잃어 고객이 받는다.
//   ★ 공개 링크로 공유 중인 문서에는 붙이지 않는다(document_shared_publicly) — 링크를 가진 누구나 첨부를 받는다.
const { Op } = require('sequelize');
const cfg = require('../../agent_oauth/config');
const { err } = require('../errors');
const { assertMenu } = require('../menu');

const MAX_FILES = 10;
const taskUrl = (id) => `${cfg.APP_URL}/tasks?task=${id}`;
const docUrl = (id) => `${cfg.APP_URL}/docs?post=${id}`;
/** 사람이 PlanQ 에서 파일을 올리는 곳 — 열면 첨부 고르기가 바로 열린다(attach=1 은 화면이 한 번 쓰고 지운다). */
const uploadUrl = (kind, id) => (kind === 'task' ? `${taskUrl(id)}&attach=1` : `${docUrl(id)}&attach=1`);

const FILES_HINT = 'Files the user attached in this ChatGPT conversation: call upload_file with attach_to {kind, id}. Files already in PlanQ (list_files, mail attachments): attach_files_to_task / attach_files_to_document with their file_id. If you cannot pass the file (e.g. in Claude, or a file you generated), give the user upload_url to add it in PlanQ. upload_url opens the editor, so give it only for adding a file and label it as such; to show the user the task/document, always link url (view mode), never upload_url. Never say a file is attached unless it is listed in attached_files.';

function vlevelOf(f) {
  const v = f.vlevel || ({ personal: 'L1', private: 'L1', project: 'L2', workspace: 'L3', public: 'L4' }[f.visibility]) || 'L3';
  return ({ L1: 'only_me', L2: 'project', L3: 'workspace', L4: 'workspace_and_public_link' })[v] || 'workspace';
}
const fileRow = (f) => ({ file_id: Number(f.id), name: f.file_name, visibility_now: vlevelOf(f), security_level: f.security_level || 'general' });

/** projects:read(=list_files) 없이 id 를 찍어 붙이면 쓰기로 읽기를 우회한다 — create_* 의 file_ids 는 핸들러에서 같은 판정(메일 초안의 mail:read 와 같은 원칙). */
function assertFilesReadScope(p) {
  if (!(p.scopes || []).includes('projects:read')) throw err('PERMISSION_DENIED', 'scope', { missing_scopes: ['projects:read'], hint: 'Attaching existing PlanQ files needs read access to files. The user reconnects PlanQ with read access.' });
}

/** 파일 전부 판정 — 같은 워크스페이스·안 지움·볼 수 있음. 하나라도 아니면 통째 거절(무엇이 문제인지 id 로). */
async function loadFilesStrict(p, fileIds) {
  const ids = [...new Set((fileIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > MAX_FILES) throw err('VALIDATION_ERROR', 'too_many_files', { max: MAX_FILES });
  const { File } = require('../../../models');
  const { canUserSeeFile } = require('../../../middleware/imageViewer');
  const files = await File.findAll({ where: { id: ids, business_id: p.businessId, deleted_at: null } });
  const seen = [];
  for (const f of files) if (await canUserSeeFile(p.userId, p.platformRole, f)) seen.push(f);
  const ok = new Set(seen.map((f) => Number(f.id)));
  const missing = ids.filter((x) => !ok.has(x));
  if (missing.length) throw err('NOT_FOUND', 'file_not_found', { file_ids: missing, hint: 'Use file_id values from list_files (or a mail attachment) that the user can see in this workspace. Nothing was attached.' });
  return ids.map((x) => seen.find((f) => Number(f.id) === x));
}

/** 이 업무를 볼 수 있는 고객 — 프로젝트 고객 · 대화방 고객 참여자 · 이름 박힌 고객. 같은 술어(canAccessTask)로 잰다. */
async function clientViewersOfTask(task) {
  const { ProjectClient, ConversationParticipant, Client } = require('../../../models');
  const { getUserScope, canAccessTask } = require('../../../middleware/access_scope');
  const cand = new Set([task.assignee_id, task.created_by, task.request_by_user_id].filter(Boolean).map(Number));
  if (task.project_id) {
    (await ProjectClient.findAll({ where: { project_id: task.project_id, contact_user_id: { [Op.ne]: null } }, attributes: ['contact_user_id'] }))
      .forEach((r) => cand.add(Number(r.contact_user_id)));
  }
  if (task.conversation_id) {
    (await ConversationParticipant.findAll({ where: { conversation_id: task.conversation_id, role: 'client' }, attributes: ['user_id'] }))
      .forEach((r) => cand.add(Number(r.user_id)));
  }
  const out = [];
  for (const uid of cand) {
    const scope = await getUserScope(uid, task.business_id);
    if (!scope.isClient || scope.isMember || scope.isOwner || scope.isAdmin) continue;
    if (task.id && !(await canAccessTask(uid, task, scope))) continue;
    const c = await Client.findOne({ where: { business_id: task.business_id, user_id: uid }, attributes: ['display_name', 'company_name'] });
    out.push({ user_id: uid, name: c ? c.display_name : null, company: c ? c.company_name || null : null });
  }
  return out;
}

/** 고객이 볼 업무에 보안등급 파일 거절 — 업무 첨부 사본은 등급을 잃는다. */
function assertClientSafe(files, clients) {
  if (!clients.length) return;
  const bad = files.filter((f) => (f.security_level || 'general') !== 'general');
  if (bad.length) throw err('PERMISSION_DENIED', 'file_security_level_blocks_client', { file_ids: bad.map((f) => Number(f.id)), hint: 'Clients can see this task, and these files are marked internal/confidential. Nothing was attached. The user can attach them in PlanQ after changing the file\'s security level, or attach them to an internal task.' });
}

async function loadTaskForAttach(p, taskId) {
  const { Task } = require('../../../models');
  const { getUserScope, canAccessTask } = require('../../../middleware/access_scope');
  const task = await Task.findOne({ where: { id: taskId, business_id: p.businessId } });   // ★ business_id 묶음 — 빼면 남의 워크스페이스 업무가 통과한다
  if (!task || !(await canAccessTask(p.userId, task, await getUserScope(p.userId, p.businessId, p.platformRole)))) throw err('NOT_FOUND', 'task_not_found');
  return task;
}

/** 문서 — 읽을 수 있고 편집할 수 있고(서명 잠김 아님) 공개 링크로 공유 중이 아니어야. upload_file·create_text_file 의 attach_to document 도 이 판정. */
function isPostSharedPublicly(post) {
  return !!post.share_token && (!post.share_expires_at || new Date(post.share_expires_at).getTime() > Date.now());
}
const sharedDocErr = (post) => err('PERMISSION_DENIED', 'document_shared_publicly', { document_id: post.id, hint: 'This document is shared by public link, so anything attached would be downloadable by anyone with the link. Nothing was attached. Ask the user to attach it in PlanQ directly (or stop sharing first).' });

async function loadDocForAttach(p, postId, actor) {
  const { Post } = require('../../../models');
  const { canReadPost } = require('../../postAccess');
  const post = await Post.findOne({ where: { id: postId, business_id: p.businessId } });
  if (!post || !(await canReadPost({ id: p.userId, platform_role: p.platformRole }, post))) throw err('NOT_FOUND', 'document_not_found');
  const chk = await require('../../actions/post_actions').checkEditable(actor, { businessId: p.businessId, postId });
  if (!chk.ok) throw require('./docs_write').failOf(chk);
  if (isPostSharedPublicly(chk.data.post)) throw sharedDocErr(chk.data.post);
  return chk.data.post;
}
const userActor = (p) => ({ kind: 'user', userId: p.userId, platformRole: p.platformRole });
const docAudience = (post) => (post.vlevel === 'L1' ? 'only_me' : (post.project_id ? 'project_members' : 'workspace_members'));

/** 붙인 결과 → 응답 칸. */
const attachedRows = (files, skippedIds) => ({
  attached_files: files.filter((f) => !skippedIds.has(Number(f.id))).map((f) => ({ file_id: Number(f.id), name: f.file_name })),
  ...(skippedIds.size ? { already_attached: files.filter((f) => skippedIds.has(Number(f.id))).map((f) => ({ file_id: Number(f.id), name: f.file_name })) } : {}),
});

// ── 업무에 붙이기 (실행 한 벌 — attach_files_to_task · create_task.file_ids) ──
async function linkToTask(p, task, files) {
  const r = await require('../../taskAttachmentLink').linkExistingFilesToTask(task, files.map((f) => f.id), {
    userId: p.userId, platformRole: p.platformRole, strict: true, dedupe: true, via: `agent:${p.provider}`,
  });
  if (!r.ok) throw err('NOT_FOUND', r.code, { file_ids: r.missing || [] });
  if (r.created.length) {
    try { require('../../taskTransition').broadcastTask(task, 'task:updated', p.userId); } catch { /* 신호 실패는 붙이기를 되돌리지 않는다 */ }
  }
  return attachedRows(files, new Set(r.skipped.map((f) => Number(f.id))));
}

async function linkToDoc(p, actor, postId, files) {
  const r = await require('../../actions/post_actions').attachFiles(actor, { businessId: p.businessId, postId, fileIds: files.map((f) => f.id), strict: true, dedupe: true });
  if (!r.ok) throw require('./docs_write').failOf(r);
  return attachedRows(files, new Set((r.data.skipped || []).map(Number)));
}

// ── attach_files_to_task (MEDIUM) ─────────────────────────
async function previewAttachToTask(p, a) {
  await assertMenu(p, 'qtask', 'write');
  const task = await loadTaskForAttach(p, a.task_id);
  const files = await loadFilesStrict(p, a.file_ids);
  const clients = await clientViewersOfTask(task);
  assertClientSafe(files, clients);
  return {
    attach_to: { kind: 'task', task_id: task.id, title: task.title, url: taskUrl(task.id) },
    files: files.map(fileRow),
    clients_who_will_see_files: clients,
    note: clients.length
      ? 'These clients can see this task, so they will be able to download the attached files. Show the file names and this client list to the user before confirming.'
      : 'Everyone who can see this task will be able to download the files (a copy of each file is linked to the task, whatever the file\'s own visibility). Show the file names to the user before confirming.',
  };
}
async function attachToTask(p, a) {
  await assertMenu(p, 'qtask', 'write');
  const task = await loadTaskForAttach(p, a.task_id);
  const files = await loadFilesStrict(p, a.file_ids);
  assertClientSafe(files, await clientViewersOfTask(task));
  return { task: { task_id: task.id, title: task.title, url: taskUrl(task.id) }, ...(await linkToTask(p, task, files)) };
}

// ── attach_files_to_document (MEDIUM) ─────────────────────
async function previewAttachToDocument(p, a) {
  await assertMenu(p, 'qdocs', 'write');
  const post = await loadDocForAttach(p, a.document_id, userActor(p));
  const files = await loadFilesStrict(p, a.file_ids);
  return {
    attach_to: { kind: 'document', post_id: post.id, title: post.title, url: docUrl(post.id) },
    files: files.map(fileRow),
    document_visible_to: docAudience(post),
    note: 'Everyone who can read this document will see the attached files. Show the file names to the user before confirming.',
  };
}
async function attachToDocument(p, a, actor) {
  await assertMenu(p, 'qdocs', 'write');
  const post = await loadDocForAttach(p, a.document_id, actor);
  const files = await loadFilesStrict(p, a.file_ids);
  return { document: { post_id: post.id, title: post.title, url: docUrl(post.id) }, ...(await linkToDoc(p, actor, post.id, files)) };
}

// ── create_task / create_document 의 file_ids — 만들기 전 판정 · 만든 뒤 붙이기 ──
/** 만들기 전 — 볼 고객은 «만들 업무» 기준으로 보수적으로(프로젝트 고객 · 고객 담당자). 거절이면 업무를 만들지 않는다. */
//   ★ 출처 대화방(source chat)도 넣는다 — 그 방 고객이 업무를 본다(2026-11-19 Fable 검증 FAIL 차단 1: 빠져 confidential 이 고객 업무에 붙었다).
async function precheckNewTaskFiles(p, a, { projectId, assigneeId, conversationId } = {}) {
  if (!(a.file_ids || []).length) return { files: [], clients: [] };
  assertFilesReadScope(p);
  const files = await loadFilesStrict(p, a.file_ids);
  const clients = await clientViewersOfTask({ business_id: p.businessId, project_id: projectId || null, conversation_id: conversationId || null, assignee_id: assigneeId || null, created_by: p.userId });
  assertClientSafe(files, clients);
  return { files, clients };
}
async function precheckNewDocFiles(p, a) {
  if (!(a.file_ids || []).length) return [];
  assertFilesReadScope(p);
  return loadFilesStrict(p, a.file_ids);
}
/** 만든 뒤 — 경합 실패만 여기 온다. 업무/문서는 남기고 files_failed 로 말한다(create_* 를 다시 부르면 두 개가 된다). */
async function attachAfterCreate(kind, p, actor, target, files) {
  if (!files.length) return {};
  try {
    // 업무는 실제 행으로 고객 판정을 한 번 더 — 사전 판정이 놓친 연결이 있어도 보안등급 파일이 고객 업무에 붙지 않게
    if (kind === 'task') assertClientSafe(files, await clientViewersOfTask(target));
    return kind === 'task' ? await linkToTask(p, target, files) : await linkToDoc(p, actor, target.id, files);
  } catch (e) {
    return {
      attached_files: [],
      files_failed: files.map((f) => ({ file_id: Number(f.id), reason: e.message || e.code || 'attach_failed' })),
      files_hint: `Do not call create_${kind === 'task' ? 'task' : 'document'} again. Retry with attach_files_to_${kind === 'task' ? 'task' : 'document'} and this ${kind === 'task' ? 'task_id' : 'document_id'}.`,
    };
  }
}

module.exports = {
  previewAttachToTask, attachToTask, previewAttachToDocument, attachToDocument,
  precheckNewTaskFiles, precheckNewDocFiles, attachAfterCreate, loadFilesStrict, fileRow, docAudience,
  isPostSharedPublicly, sharedDocErr, uploadUrl, FILES_HINT, MAX_FILES,
};
