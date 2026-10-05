// AI 에이전트 도구 — Q docs 문서 쓰기 · 파일 올리기 (2026-10-05, Irene: "문서도 작성할 수 있어야지. 파일도 보낼 수 있어야 하고.")
//
//   ★ 쓰는 문은 사람과 같다 — 문서는 services/actions/post_actions(화면 POST /api/posts 와 같은 함수),
//     파일 저장은 services/driveImport.ingestDownloadedFile(Drive 가져오기와 같은 함수), 업무 첨부는
//     services/taskAttachmentLink.linkFilesToTask(업무 화면 «기존 파일 연결» 과 같은 함수). 모델을 직접 쓰지 않는다(가드 agentsurface).
//   ★ 범위는 토큰의 워크스페이스로만 — 못 읽는 문서는 NOT_FOUND(있다는 것조차 알리지 않는다).
//   ★ 메뉴 Layer — 문서는 qdocs 쓰기, 파일은 qfile 쓰기.
const fs = require('fs');
const cfg = require('../../agent_oauth/config');
const { err, fromActionFailure } = require('../errors');
const { assertMenu } = require('../menu');
const { markdownToDoc } = require('../markdown');

const docUrl = (id) => `${cfg.APP_URL}/docs?post=${id}`;
const actions = () => require('../../actions/post_actions');

// 행동 계층 실패 → 에이전트 오류. 서명 잠금·편집 권한은 사용자에게 할 말이 따로 있다.
function failOf(r) {
  if (r.code === 'post_locked_by_signature') return err('CONFLICT', 'locked_by_signature', { hint: 'This document has a signature request in progress or completed, so its content cannot change. Create a new document instead.' });
  if (r.code === 'post_edit_forbidden') return err('PERMISSION_DENIED', 'cannot_edit_document');
  if (r.code === 'not_found') return err('NOT_FOUND', 'document_not_found');
  if (r.code === 'invalid project_id') return err('NOT_FOUND', 'project_not_found');   // 남의 워크스페이스 프로젝트의 존재를 흘리지 않는다
  return fromActionFailure(r);
}

// 읽을 수 없는 문서는 «없다» — get_document 와 같은 판정(services/postAccess.canReadPost)
async function loadReadable(p, postId) {
  const { Post } = require('../../../models');
  const { canReadPost } = require('../../postAccess');
  const post = await Post.findOne({ where: { id: postId, business_id: p.businessId } });
  if (!post || !(await canReadPost({ id: p.userId, platform_role: p.platformRole }, post))) throw err('NOT_FOUND', 'document_not_found');
  return post;
}

function shape(post) {
  return {
    post_id: post.id, title: post.title, project_id: post.project_id || null,
    visibility: post.vlevel || null, content_chars: String(post.content_text || '').length, url: docUrl(post.id),
  };
}

// ── create_document ────────────────────────────────────────
async function createDocument(p, a, actor) {
  await assertMenu(p, 'qdocs', 'write');
  const r = await actions().createPost(actor, {
    businessId: p.businessId, projectId: a.project_id || null, title: a.title,
    contentJson: markdownToDoc(a.content || ''), category: a.category || null, status: 'published',
  });
  if (!r.ok) throw failOf(r);
  let post = r.data.post;
  // 함께 연결할 문서 — 만든 사람이 읽을 수 있는 것만 걸린다(setPostLinks 가 같은 판정).
  if (Array.isArray(a.link_document_ids) && a.link_document_ids.length) {
    const lr = await actions().setPostLinks(actor, { businessId: p.businessId, postId: post.id, add: a.link_document_ids });
    if (lr.ok) post = lr.data.post;
  }
  return { document: shape(post), created: true, note: 'Created in PlanQ Q docs. Visible to the project members (or the whole workspace when no project), same as creating it in the app.' };
}

// ── append_to_document ─────────────────────────────────────
async function appendToDocument(p, a, actor) {
  await assertMenu(p, 'qdocs', 'write');
  await loadReadable(p, a.document_id);
  const r = await actions().updatePostContent(actor, { businessId: p.businessId, postId: a.document_id, contentJson: markdownToDoc(a.content), mode: 'append' });
  if (!r.ok) throw failOf(r);
  return { document: shape(r.data.post), appended: true };
}

// ── update_document (MEDIUM — 덮어쓰기) ─────────────────────
async function previewUpdate(p, a) {
  if (a.title === undefined && a.content === undefined) throw err('VALIDATION_ERROR', 'no_fields');
  await assertMenu(p, 'qdocs', 'write');
  await loadReadable(p, a.document_id);
  const chk = await actions().checkEditable({ kind: 'user', userId: p.userId, platformRole: p.platformRole }, { businessId: p.businessId, postId: a.document_id });
  if (!chk.ok) throw failOf(chk);
  const post = chk.data.post;
  return {
    document: { post_id: post.id, title: post.title, url: docUrl(post.id) },
    before: { title: post.title, content_chars: String(post.content_text || '').length },
    after: { title: a.title || post.title, content: a.content !== undefined ? 'replaced (previous version stays in the document history)' : 'unchanged' },
  };
}
async function updateDocument(p, a, actor) {
  await assertMenu(p, 'qdocs', 'write');
  await loadReadable(p, a.document_id);
  const r = await actions().updatePostContent(actor, {
    businessId: p.businessId, postId: a.document_id, title: a.title,
    contentJson: a.content !== undefined ? markdownToDoc(a.content) : undefined, mode: 'replace',
  });
  if (!r.ok) throw failOf(r);
  return { document: shape(r.data.post), updated: true, note: 'The previous version is kept in the document history (restorable in PlanQ).' };
}

// ── link_documents ─────────────────────────────────────────
async function linkDocuments(p, a, actor) {
  await assertMenu(p, 'qdocs', 'write');
  await loadReadable(p, a.document_id);
  const r = await actions().setPostLinks(actor, { businessId: p.businessId, postId: a.document_id, add: a.link || [], remove: a.unlink || [] });
  if (!r.ok) throw failOf(r);
  return { document: shape(r.data.post), linked: r.data.added, unlinked: r.data.removed, note: 'Links are two-way: the other documents show this one too. Documents the user cannot read are ignored.' };
}

// ── move_document_to_project (MEDIUM — 보는 사람이 바뀐다) ─────
async function projectName(p, id) {
  if (!id) return null;
  const { Project } = require('../../../models');
  const pr = await Project.findOne({ where: { id, business_id: p.businessId }, attributes: ['id', 'name'] });
  if (!pr) throw err('NOT_FOUND', 'project_not_found');
  return { project_id: pr.id, name: pr.name };
}
async function previewMove(p, a) {
  await assertMenu(p, 'qdocs', 'write');
  await loadReadable(p, a.document_id);
  const chk = await actions().checkEditable({ kind: 'user', userId: p.userId, platformRole: p.platformRole }, { businessId: p.businessId, postId: a.document_id });
  if (!chk.ok) throw failOf(chk);
  const post = chk.data.post;
  const to = await projectName(p, a.project_id || null);
  const from = post.project_id ? await projectName(p, post.project_id).catch(() => null) : null;
  return {
    document: { post_id: post.id, title: post.title, url: docUrl(post.id), visibility: post.vlevel },
    before: { project: from }, after: { project: to },
    note: post.vlevel === 'L2' ? 'This document is visible to project members, so who can see it changes with the project.' : 'Visibility level stays the same.',
  };
}
async function moveDocument(p, a, actor) {
  await assertMenu(p, 'qdocs', 'write');
  await loadReadable(p, a.document_id);
  const r = await actions().movePostToProject(actor, { businessId: p.businessId, postId: a.document_id, projectId: a.project_id || null });
  if (!r.ok) throw r.code === 'invalid project_id' ? err('NOT_FOUND', 'project_not_found') : failOf(r);
  return { document: shape(r.data.post), moved: true };
}

// ── upload_file (ChatGPT fileParams) ───────────────────────
//   ChatGPT 는 사용자가 대화에 올린 파일을 { download_url, file_id, file_name, mime_type } 로 넘긴다(Apps SDK openai/fileParams).
//   ★ 받는 주소는 OpenAI 파일 도메인만 — 아무 주소나 받게 두면 서버가 내부망·임의 사이트로 요청을 보내는 문이 된다(SSRF).
//   ★ 리다이렉트를 따라가지 않는다(따라가면 허용 도메인 검사가 무력해진다).
//   ★ 크기는 받는 **중에** 자른다 — 다 받고 재면 큰 파일이 디스크를 먼저 채운다.
const FILE_HOST_SUFFIXES = ['.oaiusercontent.com', '.openai.com', '.chatgpt.com'];
const HARD_MAX_BYTES = 100 * 1024 * 1024;   // 요금제 한도보다 먼저 거는 바닥 — 요금제 한도는 plan.can 이 다시 본다

function allowedFileUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    const h = url.hostname.toLowerCase();
    return FILE_HOST_SUFFIXES.some((s) => h.endsWith(s) || h === s.slice(1));
  } catch { return false; }
}

async function downloadCapped(url, dest, maxBytes) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  if (res.status >= 300 && res.status < 400) throw err('VALIDATION_ERROR', 'file_redirect_not_allowed');
  if (!res.ok || !res.body) throw err('VALIDATION_ERROR', `file_download_failed:${res.status}`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > maxBytes) throw err('QUOTA_EXCEEDED', 'file_too_large', { size_bytes: declared, limit_bytes: maxBytes });
  const out = fs.createWriteStream(dest);
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw err('QUOTA_EXCEEDED', 'file_too_large', { limit_bytes: maxBytes });
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
  } catch (e) {
    out.destroy();
    try { fs.unlinkSync(dest); } catch { /* noop */ }
    throw e;
  }
  return total;
}

async function uploadFile(p, a, actor) {
  await assertMenu(p, 'qfile', 'write');
  const f = a.file;
  if (!allowedFileUrl(f.download_url)) throw err('VALIDATION_ERROR', 'file_url_not_allowed', { hint: 'Only files attached in this ChatGPT conversation can be uploaded.' });
  const di = require('../../driveImport');
  const name = String(a.file_name || f.file_name || 'file').trim().slice(0, 255) || 'file';
  if (!di.ALLOWED_EXT.has(di.extOf(name))) throw err('VALIDATION_ERROR', 'extension_not_allowed', { allowed: [...di.ALLOWED_EXT] });

  // 붙일 곳 — 먼저 확인한다(파일을 받은 뒤 «못 붙인다» 로 버리지 않게). 공개 범위는 붙일 곳을 따른다.
  const target = a.attach_to || { kind: 'workspace' };
  let projectId = null; let visibility = 'L3'; let post = null; let task = null;
  if (target.kind === 'document') {
    const chk = await actions().checkEditable(actor, { businessId: p.businessId, postId: target.id });
    if (!chk.ok) throw failOf(chk);
    post = chk.data.post;
    projectId = post.project_id || null;
    // 문서보다 넓게 올리지 않는다 — 문서는 나만 보기인데 첨부만 전체면 그게 유출이다(화면 persistAttachments 와 같은 원칙)
    visibility = post.vlevel === 'L4' ? 'L3' : (post.vlevel || (projectId ? 'L2' : 'L3'));
  } else if (target.kind === 'task') {
    const { Task } = require('../../../models');
    const { getUserScope, canAccessTask } = require('../../../middleware/access_scope');
    task = await Task.findOne({ where: { id: target.id, business_id: p.businessId } });
    const scope = task ? await getUserScope(p.userId, p.businessId, p.platformRole) : null;
    if (!task || !(await canAccessTask(p.userId, task, scope))) throw err('NOT_FOUND', 'task_not_found');
    projectId = task.project_id || null;
    visibility = projectId ? 'L2' : 'L3';
  } else if (target.kind === 'project') {
    const { Project } = require('../../../models');
    const { getUserScope, canAccessProject } = require('../../../middleware/access_scope');
    const prj = await Project.findOne({ where: { id: target.id, business_id: p.businessId } });
    if (!prj || !(await canAccessProject(p.userId, prj, await getUserScope(p.userId, p.businessId, p.platformRole)))) throw err('NOT_FOUND', 'project_not_found');
    projectId = target.id;
    visibility = 'L2';
  }

  // 요금제 파일당 한도(plan.can upload_file) — 받기 전에 바닥을, 받은 뒤 실제 크기로 다시
  const plan = require('../../plan');
  const temp = di.uploadPathFor(p.businessId);
  const size = await downloadCapped(f.download_url, temp, HARD_MAX_BYTES);
  const gate = await plan.can(p.businessId, 'upload_file', { size, external: false });
  if (!gate.ok) { try { fs.unlinkSync(temp); } catch { /* noop */ } throw err('QUOTA_EXCEEDED', gate.reason || 'upload_limit', { limit: gate.limit ?? null, size_bytes: size }); }

  const ing = await di.ingestDownloadedFile({ businessId: p.businessId, uploaderId: p.userId }, temp, {
    projectId, visibility, fileName: name, mimeType: f.mime_type || 'application/octet-stream',
    auditValue: { source: 'agent', provider: p.provider, grant_id: p.grantId, file_id: f.file_id },
  });
  if (!ing.ok) throw ing.reason === 'storage_quota_exceeded' ? err('QUOTA_EXCEEDED', 'storage_quota_exceeded') : err('INTERNAL', ing.reason || 'ingest_failed');
  const file = ing.file;

  let attached = null;
  if (post) {
    const ar = await actions().attachFiles(actor, { businessId: p.businessId, postId: post.id, fileIds: [file.id] });
    if (!ar.ok) throw failOf(ar);
    attached = { kind: 'document', post_id: post.id, url: docUrl(post.id) };
  } else if (task) {
    await require('../../taskAttachmentLink').linkFilesToTask(task, [file], p.userId, { context: 'task' });
    attached = { kind: 'task', task_id: task.id, url: `${cfg.APP_URL}/tasks?task=${task.id}` };
  } else if (projectId) {
    attached = { kind: 'project', project_id: projectId };
  }
  return {
    file: { file_id: file.id, name: file.file_name, size_bytes: file.file_size, mime_type: file.mime_type, visibility, url: `${cfg.APP_URL}/files` },
    attached_to: attached, created: true,
  };
}

module.exports = {
  createDocument, appendToDocument, previewUpdate, updateDocument, linkDocuments, previewMove, moveDocument, uploadFile,
  allowedFileUrl, _downloadCapped: downloadCapped,
};
