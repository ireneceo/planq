// AI 에이전트 도구 — Q file 폴더·파일 쓰기 (2026-11-18, Fable 설계 DESIGN-READY)
//
//   Irene «클로드나 챗지피티가 프로젝트>파일>폴더를 만들거나 폴더에 파일 넣는게 왜 안돼?» — 폴더 도구가 없었고,
//   upload_file 은 ChatGPT 첨부만 받으며 폴더 칸이 없었다(클로드는 첨부 바이트를 도구에 넘길 길이 없다).
//
//   도구: list_folders(읽기) · create_folder · move_files_to_folder · create_text_file · upload_file(+folder_id). 모두 LOW · files:write.
//   ★ 쓰는 문은 사람과 같다 — 폴더 만들기·옮기기는 services/actions/folder_actions(화면 라우트도 같은 함수),
//     파일 저장은 driveImport.ingestDownloadedFile, 업무 첨부는 taskAttachmentLink, 문서 첨부는 post_actions.attachFiles.
//   ★ 범위는 토큰 워크스페이스로만 — 폴더·프로젝트·파일은 business_id 로 묶어 찾는다. 못 보는 것은 NOT_FOUND.
//   ★ 공개 링크가 걸린 폴더(조상 포함)에는 넣지 않는다(folder_shared_publicly) — 폴더 링크는 열 때마다 안을 다시 거르므로
//     넣는 순간 밖으로 나간다. 확인 2단계로 열 수 없다(riskOf 는 인자만 본다). 빼는 이동은 허용.
//   ★ 뺀 것: 폴더 삭제·이름 바꾸기·순서·공유 켜고 끄기·파일 삭제·공개 범위 바꾸기·파일의 프로젝트 바꾸기 — PlanQ 화면에서.
const fs = require('fs');
const { Op } = require('sequelize');
const cfg = require('../../agent_oauth/config');
const { err, fromActionFailure } = require('../errors');
const { assertMenu } = require('../menu');

const folderActions = () => require('../../actions/folder_actions');
const fileUrl = (id) => `${cfg.APP_URL}/files?file=${id}`;
const docUrl = (id) => `${cfg.APP_URL}/docs?post=${id}`;

// 텍스트로 만들 수 있는 형식 — 허용 확장자 정본(driveImport.ALLOWED_EXT)과의 교집합만.
const TEXT_TYPES = { txt: 'text/plain; charset=utf-8' };   // md·csv 는 미룸(Fable): 정본 ALLOWED_EXT 에 넣고 화면 미리보기·내려받기를 실측한 뒤에만
const TEXT_MAX_CHARS = 100000;

async function scopeOf(p) {
  const { getUserScope } = require('../../../middleware/access_scope');
  return getUserScope(p.userId, p.businessId, p.platformRole);
}

function folderFail(r) {
  const c = r.code;
  if (c === 'folder_shared_publicly') return err('PERMISSION_DENIED', c, { folder_id: r.detail?.folder_id ?? null, hint: 'This folder (or a folder above it) is shared by public link. Ask the user to add files to it in PlanQ directly.' });
  if (c === 'folder_in_other_project') return err('VALIDATION_ERROR', c, { file_id: r.detail?.file_id ?? null, hint: 'A file can only go into a folder of its own project (or a workspace folder if it has no project). Changing a file\'s project is done in PlanQ.' });
  if (c === 'mail_attachment_not_movable') return err('VALIDATION_ERROR', c, { file_id: r.detail?.file_id ?? null, hint: 'Saved mail attachments stay under Mail in Q file and cannot be put in folders.' });
  if (c === 'file_move_forbidden') return err('PERMISSION_DENIED', c, { file_id: r.detail?.file_id ?? null, hint: 'Only the uploader, the workspace owner or the project PM can move this file.' });
  if (c === 'file_not_found') return err('NOT_FOUND', c, { file_id: r.detail?.file_id ?? null });
  if (c === 'folder_not_found' || c === 'Invalid parent_id') return err('NOT_FOUND', 'folder_not_found');
  if (c === 'folder_too_deep') return err('VALIDATION_ERROR', c, { hint: `Folders can be at most ${folderActions().MAX_DEPTH} levels deep.` });
  if (c === 'forbidden') return err('PERMISSION_DENIED', 'members_only');
  return fromActionFailure(r);
}

/** 폴더 하나를 읽는다 — 이 워크스페이스 것이고, 프로젝트 폴더면 그 프로젝트가 보여야 한다. */
async function loadFolder(p, folderId, scope) {
  const { FileFolder } = require('../../../models');
  const { canSeeProject } = require('../../../middleware/access_scope');
  const folder = await FileFolder.findOne({ where: { id: folderId, business_id: p.businessId } });
  if (!folder || !canSeeProject(scope || await scopeOf(p), folder.project_id)) throw err('NOT_FOUND', 'folder_not_found');
  return folder;
}

// ── list_folders ───────────────────────────────────────────
async function listFolders(p, a) {
  await assertMenu(p, 'qfile', 'read');
  const { FileFolder, Project } = require('../../../models');
  const { projectScopeWhere } = require('../../../middleware/access_scope');
  const scope = await scopeOf(p);
  const conds = [{ business_id: p.businessId }];
  const ps = projectScopeWhere(scope, 'project_id');
  if (ps) conds.push(ps);
  if (a.project_id) conds.push({ project_id: a.project_id });
  const rows = await FileFolder.findAll({
    where: { [Op.and]: conds },
    attributes: ['id', 'name', 'parent_id', 'project_id', 'share_token', 'share_expires_at'],
    order: [['project_id', 'ASC'], ['parent_id', 'ASC'], ['sort_order', 'ASC'], ['created_at', 'ASC']],
    limit: 2000,   // 경로를 조립하려면 조상까지 한 번에 — 쪽 나누기는 조립 뒤에
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
  const projects = pids.length ? await Project.findAll({ where: { id: pids, business_id: p.businessId }, attributes: ['id', 'name'] }) : [];
  const pname = new Map(projects.map((x) => [Number(x.id), x.name]));
  const now = Date.now();
  const live = (f) => !!f.share_token && (!f.share_expires_at || new Date(f.share_expires_at).getTime() > now);
  const walk = (f) => {
    const names = []; let shared = false; let cur = f; const seen = new Set();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); names.unshift(cur.name); if (live(cur)) shared = true; cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
    return { path: names.join('/'), shared };
  };
  const items = rows.map((f) => {
    const w = walk(f);
    return {
      folder_id: f.id, name: f.name, parent_id: f.parent_id || null, path: w.path,
      project: f.project_id ? { project_id: Number(f.project_id), name: pname.get(Number(f.project_id)) || null } : null,
      shared_by_link: w.shared,
    };
  });
  const { parsePage, pageOf } = require('../page');
  const pg = parsePage(a, { defaultSize: 50 });
  return {
    ...pageOf(items.slice(pg.offset, pg.offset + pg.pageSize), items.length, pg),
    note: 'Folders without a project are workspace folders (Q file). shared_by_link folders cannot receive files through this connection.',
  };
}

// ── create_folder ──────────────────────────────────────────
async function createFolder(p, a, actor) {
  await assertMenu(p, 'qfile', 'write');
  // 부모만 주고 project_id 를 빼면 부모의 프로젝트를 따른다 — «폴더가 있는데 없다» 로 답해 AI 가 헤매지 않게(Fable 비차단 3)
  let projectId = a.project_id || null;
  if (a.parent_folder_id && !a.project_id) {
    const parent = await loadFolder(p, a.parent_folder_id);
    projectId = parent.project_id ? Number(parent.project_id) : null;
  }
  const r = await folderActions().createFolder(actor, {
    businessId: p.businessId, projectId, parentId: a.parent_folder_id || null, name: a.name,
  });
  if (!r.ok) throw folderFail(r);
  const f = r.data.folder;
  const path = await folderActions().folderPath(f);
  return {
    folder: { folder_id: f.id, name: f.name, parent_id: f.parent_id || null, path, project_id: f.project_id ? Number(f.project_id) : null },
    created: r.data.created,
    ...(r.data.created ? {} : { note: 'A folder with this name already exists here — returned it instead of creating a duplicate.' }),
    url: f.project_id ? `${cfg.APP_URL}/projects/p/${f.project_id}?tab=docs` : `${cfg.APP_URL}/files`,
  };
}

// ── move_files_to_folder ───────────────────────────────────
async function moveFilesToFolder(p, a, actor) {
  await assertMenu(p, 'qfile', 'write');
  if (a.folder_id) await loadFolder(p, a.folder_id);
  const r = await folderActions().moveFiles(actor, {
    businessId: p.businessId, fileIds: a.file_ids, folderId: a.folder_id || null, strict: true,
  });
  if (!r.ok) throw folderFail(r);
  const path = r.data.folder ? await folderActions().folderPath(r.data.folder) : null;
  return {
    folder: r.data.folder ? { folder_id: r.data.folder.id, path } : null,
    files: r.data.files.map((f) => ({ file_id: f.id, name: f.file_name, url: fileUrl(f.id) })),
    moved_count: r.data.moved.length,
  };
}

// ── 붙일 곳·폴더 판정 (upload_file · create_text_file 한 벌) ─────
//   받기·쓰기 **전에** 다 확인한다(파일을 받은 뒤 «못 붙인다» 로 버리지 않게). 공개 범위는 붙일 곳을 따른다.
async function resolveTarget(p, a, actor) {
  const target = a.attach_to || { kind: 'workspace' };
  let projectId = null; let visibility = 'L3'; let post = null; let task = null;
  if (target.kind === 'document') {
    const { Post } = require('../../../models');
    const { canReadPost } = require('../../postAccess');
    const found = await Post.findOne({ where: { id: target.id, business_id: p.businessId } });
    if (!found || !(await canReadPost({ id: p.userId, platform_role: p.platformRole }, found))) throw err('NOT_FOUND', 'document_not_found');
    const chk = await require('../../actions/post_actions').checkEditable(actor, { businessId: p.businessId, postId: target.id });
    if (!chk.ok) throw require('./docs_write').failOf(chk);
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

  let folder = null;
  if (a.folder_id) {
    folder = await loadFolder(p, a.folder_id);
    const fp = folder.project_id ? Number(folder.project_id) : null;
    if (a.attach_to) {
      // 붙일 곳이 정한 프로젝트와 폴더의 프로젝트가 다르면 받기 전에 거절 — 폴더가 프로젝트를 바꾸지 않는다
      if (fp !== (projectId ? Number(projectId) : null)) throw err('VALIDATION_ERROR', 'folder_project_mismatch', { hint: 'The folder belongs to a different project (or to the workspace) than attach_to. Use a folder of the same project.' });
    } else if (fp) {
      // 프로젝트 폴더에 넣으면 그 프로젝트 파일(L2)이 된다 — 화면에서 프로젝트 폴더에 올리는 것과 같다
      projectId = fp; visibility = 'L2';
    }
    if (await folderActions().isSharedPublicly(folder)) throw err('PERMISSION_DENIED', 'folder_shared_publicly', { folder_id: folder.id, hint: 'This folder (or a folder above it) is shared by public link. Ask the user to add files to it in PlanQ directly.' });
  }
  return { projectId, visibility, post, task, folder };
}

/** 받은(쓴) 임시 파일 → 요금제 한도 → 저장 → 붙이기 → Drive 사본. */
async function storeAndAttach(p, actor, tgt, temp, { name, mimeType, auditValue }) {
  const di = require('../../driveImport');
  const size = fs.statSync(temp).size;
  const gate = await require('../../plan').can(p.businessId, 'upload_file', { size, external: false });
  if (!gate.ok) { try { fs.unlinkSync(temp); } catch { /* noop */ } throw err('QUOTA_EXCEEDED', gate.reason || 'upload_limit', { limit: gate.limit ?? null, size_bytes: size }); }

  const ing = await di.ingestDownloadedFile({ businessId: p.businessId, uploaderId: p.userId }, temp, {
    projectId: tgt.projectId, folderId: tgt.folder ? tgt.folder.id : null, visibility: tgt.visibility,
    fileName: name, mimeType, auditValue,
  });
  if (!ing.ok) throw ing.reason === 'storage_quota_exceeded' ? err('QUOTA_EXCEEDED', 'storage_quota_exceeded') : err('INTERNAL', ing.reason || 'ingest_failed');
  const file = ing.file;

  let attached = null;
  if (tgt.post) {
    const ar = await require('../../actions/post_actions').attachFiles(actor, { businessId: p.businessId, postId: tgt.post.id, fileIds: [file.id] });
    if (!ar.ok) throw require('./docs_write').failOf(ar);
    attached = { kind: 'document', post_id: tgt.post.id, url: docUrl(tgt.post.id) };
  } else if (tgt.task) {
    await require('../../taskAttachmentLink').linkFilesToTask(tgt.task, [file], p.userId, { context: 'task' });
    attached = { kind: 'task', task_id: tgt.task.id, url: `${cfg.APP_URL}/tasks?task=${tgt.task.id}` };
  } else if (tgt.projectId) {
    attached = { kind: 'project', project_id: Number(tgt.projectId) };
  }
  // Drive 연결 워크스페이스면 화면 업로드와 같은 사본(best-effort) — 정본은 PlanQ 저장. isEligible 이 L1·대외비 등을 거른다.
  setImmediate(() => { require('../../gdriveMirror').mirrorOnUpload(file.id, p.businessId).catch(() => {}); });

  return {
    file: { file_id: file.id, name: file.file_name, size_bytes: file.file_size, mime_type: file.mime_type, visibility: tgt.visibility, url: fileUrl(file.id) },
    folder: tgt.folder ? { folder_id: tgt.folder.id, path: await folderActions().folderPath(tgt.folder) } : null,
    attached_to: attached, created: true,
  };
}

// ── upload_file (ChatGPT fileParams) ───────────────────────
async function uploadFile(p, a, actor) {
  await assertMenu(p, 'qfile', 'write');
  const dw = require('./docs_write');
  const f = a.file;
  if (!dw.allowedFileUrl(f.download_url)) throw err('VALIDATION_ERROR', 'file_url_not_allowed', { hint: UPLOAD_HINT });
  const di = require('../../driveImport');
  const name = String(a.file_name || f.file_name || 'file').trim().slice(0, 255) || 'file';
  if (!di.ALLOWED_EXT.has(di.extOf(name))) throw err('VALIDATION_ERROR', 'extension_not_allowed', { allowed: [...di.ALLOWED_EXT] });
  const tgt = await resolveTarget(p, a, actor);
  const temp = di.uploadPathFor(p.businessId);
  await dw._downloadCapped(f.download_url, temp, dw.HARD_MAX_BYTES);
  return storeAndAttach(p, actor, tgt, temp, {
    name, mimeType: f.mime_type || 'application/octet-stream',
    auditValue: { source: 'agent', provider: p.provider, grant_id: p.grantId, file_id: f.file_id },
  });
}
const UPLOAD_HINT = 'Only files the user attached in this ChatGPT conversation can be uploaded. Files you made in the chat (docx/xlsx/pdf/images) cannot be passed through this connection: use create_document for formatted text, create_text_file for plain text, otherwise create the folder and ask the user to upload the file in PlanQ.';

// ── create_text_file ───────────────────────────────────────
async function createTextFile(p, a, actor) {
  await assertMenu(p, 'qfile', 'write');
  const di = require('../../driveImport');
  const name = String(a.file_name || '').trim().slice(0, 255);
  const ext = di.extOf(name);
  const textExts = Object.keys(TEXT_TYPES).filter((x) => di.ALLOWED_EXT.has(x));
  if (!name || !textExts.includes(ext)) throw err('VALIDATION_ERROR', 'extension_not_allowed', { allowed: textExts, hint: 'Give a file name ending in one of the allowed extensions, e.g. "notes.txt".' });
  const content = String(a.content ?? '');
  if (content.length > TEXT_MAX_CHARS) throw err('VALIDATION_ERROR', 'content_too_long', { max_chars: TEXT_MAX_CHARS });
  const tgt = await resolveTarget(p, a, actor);
  const temp = di.uploadPathFor(p.businessId);
  fs.writeFileSync(temp, content, 'utf8');
  return storeAndAttach(p, actor, tgt, temp, {
    name, mimeType: TEXT_TYPES[ext],
    auditValue: { source: 'agent_text', provider: p.provider, grant_id: p.grantId },
  });
}

module.exports = { listFolders, createFolder, moveFilesToFolder, uploadFile, createTextFile, TEXT_MAX_CHARS, UPLOAD_HINT };
