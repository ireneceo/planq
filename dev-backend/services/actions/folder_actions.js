// services/actions/folder_actions.js — 파일 폴더 **만들기**·파일 **폴더로 옮기기** 의 행동 계층 (2026-11-18, Fable 설계 DESIGN-READY)
//
// 왜 생겼나: Irene «클로드나 챗지피티가 프로젝트>파일>폴더를 만들거나 폴더에 파일 넣는게 왜 안돼?»
//   폴더 만들기·옮기기 규칙이 routes/file_folders.js · routes/files.js 안에만 있었다 → 화면(라우트)과 AI(create_folder·move_files_to_folder)가
//   **같은 함수**를 부른다(task/project/workstream actions 와 같은 이유).
//
// 규칙(화면 그대로 + Fable 이 더한 것):
//   · 만들기: 멤버 이상(isMemberOrAbove) · 프로젝트 폴더는 **그 프로젝트가 보이는 사람만**(userCanSeeProject — 화면도 같이 좁아짐) ·
//     부모는 같은 워크스페이스·같은 프로젝트(null 포함) · 같은 자리 같은 이름이면 있는 폴더를 돌려준다(프로젝트 폴더에도 — 화면도 같이) ·
//     깊이 상한 MAX_DEPTH · 감사 file_folder.create(+via agent) · 신호 folder:updated.
//   · 옮기기: 화면 canMutateFile 과 같은 술어(플랫폼 관리자·대표·올린 사람·그 프로젝트 PM) · 감사 file.move · Drive 사본도 같은 자리로 · 신호 file:updated.
//     strict(AI 경로): 읽기 술어(canAccessFileByLevel)도 · 폴더 project_id === 파일 project_id(둘 다 null 포함 — 프로젝트가 바뀌는 이동 = 가시성 확대라 열지 않음) ·
//     메일 첨부 보관분 거절 · **공개 링크가 걸린 폴더(조상 포함)에 넣기 거절**(folderShare 는 열 때마다 폴더 안을 다시 거르므로 넣는 순간 링크로 나간다) ·
//     전수 판정 뒤 전부 또는 0건.
const { Op } = require('sequelize');
const { FileFolder, File, Project, ProjectMember } = require('../../models');
const { resolveSubject, fail: baseFail, done } = require('./_subject');

// 실패에 어느 항목이 걸렸는지(file_id·folder_id)를 싣는다 — AI 가 사용자에게 무엇이 안 됐는지 말할 수 있게
const fail = (code, http = 400, detail) => ({ ...baseFail(code, http), ...(detail ? { detail } : {}) });

const MAX_DEPTH = 10;
const MAX_NAME = 200;   // DB 칸 길이(STRING 200). AI 도구 입력은 100 으로 더 좁힌다(registry)

function getIO() { return global.__planqIo || null; }

function audit(actor, entry) {
  const via = actor?.channel?.kind === 'agent'
    ? { via: `agent:${actor.channel.provider || 'unknown'}`, agent_grant_id: actor.channel.grant_id || null }
    : null;
  const e = via && entry.newValue && typeof entry.newValue === 'object' ? { ...entry, newValue: { ...entry.newValue, ...via } } : entry;
  try {
    require('../auditService').logAudit(actor?.req || null, { userId: actor?.userId || null, ...e });
  } catch (err) { console.warn('[folder_actions] audit 실패', entry.action, err.message); }
}

function signalFolder(folder) {
  const io = getIO();
  if (!io) return;
  // 신호만(id·소속) — 받는 화면이 자기 권한으로 다시 읽는다(fileBroadcast 와 같은 원칙)
  io.to(`business:${folder.business_id}`).emit('folder:updated', { id: folder.id, business_id: folder.business_id, project_id: folder.project_id || null });
}

function signalFile(file) {
  const io = getIO();
  if (!io) return;
  const data = { id: file.id, business_id: file.business_id, project_id: file.project_id || null };
  io.to(`business:${file.business_id}`).emit('file:updated', data);
  if (file.project_id) require('../projectRoom').emitProject(io, file.project_id, 'file:updated', data);
}

/** 폴더의 조상 사슬(자기 포함, 아래→위). 끊기거나 고리면 거기서 멈춘다. */
async function ancestorChain(folder) {
  const chain = [folder];
  const seen = new Set([folder.id]);
  let cur = folder;
  while (cur.parent_id && chain.length <= MAX_DEPTH + 5) {
    const parent = await FileFolder.findOne({ where: { id: cur.parent_id, business_id: folder.business_id } });
    if (!parent || seen.has(parent.id)) break;
    chain.push(parent); seen.add(parent.id); cur = parent;
  }
  return chain;
}

/** 이 폴더(또는 조상)에 살아 있는 공개 링크가 걸려 있는가. */
async function isSharedPublicly(folder) {
  const now = Date.now();
  for (const f of await ancestorChain(folder)) {
    if (f.share_token && (!f.share_expires_at || new Date(f.share_expires_at).getTime() > now)) return true;
  }
  return false;
}

/** 폴더 경로 «상위/하위» — AI 응답용. */
async function folderPath(folder) {
  return (await ancestorChain(folder)).reverse().map((f) => f.name).join('/');
}

/**
 * 폴더 만들기 — `POST /api/file-folders/workspace/:biz` · `POST /api/file-folders/projects/:id` · AI create_folder 가 같이 쓴다.
 * @param actor  { kind:'user'|'cue', userId, platformRole?, req?, channel? }
 * @param params { businessId, projectId?, parentId?, name, sortOrder? }
 * @returns {ok:true, data:{ folder, created }} | {ok:false, code, http}
 */
async function createFolder(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const businessId = Number(params.businessId);
  if (!businessId) return fail('business_id required', 400);
  const { getUserScope, isMemberOrAbove, canSeeProject } = require('../../middleware/access_scope');
  const scope = await getUserScope(subj.subjectId, businessId, subj.platformRole);
  if (!isMemberOrAbove(scope)) return fail('forbidden', 403);

  const name = String(params.name || '').trim();
  if (!name) return fail('name required', 400);
  if (name.length > MAX_NAME) return fail('name_too_long', 400);

  const projectId = params.projectId ? Number(params.projectId) : null;
  if (projectId) {
    const project = await Project.findOne({ where: { id: projectId, business_id: businessId }, attributes: ['id'] });
    // 볼 수 없는 프로젝트는 «없다» — 있다는 것조차 알리지 않는다
    if (!project || !canSeeProject(scope, projectId)) return fail('project_not_found', 404);
  }

  const parentId = params.parentId ? Number(params.parentId) : null;
  if (parentId) {
    const parent = await FileFolder.findOne({ where: { id: parentId, business_id: businessId, project_id: projectId } });
    if (!parent) return fail('Invalid parent_id', 400);
    if ((await ancestorChain(parent)).length >= MAX_DEPTH) return fail('folder_too_deep', 400);
  }

  // 같은 자리에 같은 이름 두 개는 만들지 않는다 — 목록에서 구별이 안 된다(워크스페이스·프로젝트 같은 규칙)
  const dup = await FileFolder.findOne({ where: { business_id: businessId, project_id: projectId, parent_id: parentId, name } });
  if (dup) return done({ folder: dup, created: false });

  const folder = await FileFolder.create({
    business_id: businessId, project_id: projectId, parent_id: parentId,
    name, sort_order: Number(params.sortOrder) || 0, created_by: subj.subjectId,
  });
  audit(actor, {
    action: 'file_folder.create', targetType: 'file_folder', targetId: folder.id, businessId,
    newValue: { name: folder.name, parent_id: folder.parent_id, project_id: folder.project_id },
  });
  signalFolder(folder);
  return done({ folder, created: true });
}

/** 화면 canMutateFile 과 같은 술어 — 플랫폼 관리자 · 대표 · 올린 사람 · 그 프로젝트 PM. */
async function canMutateFile(file, subjectId, scope) {
  if (scope.isPlatformAdmin) return true;
  if (scope.isOwner) return true;
  if (Number(file.uploader_id) === Number(subjectId)) return true;
  if (file.project_id) {
    const pm = await ProjectMember.findOne({ where: { project_id: file.project_id, user_id: subjectId, is_pm: true }, attributes: ['id'] });
    if (pm) return true;
  }
  return false;
}

/**
 * 파일을 폴더로 옮기기 — `POST /api/files/:biz/:id/move`(파일 1개, strict:false) · AI move_files_to_folder(strict:true) 가 같이 쓴다.
 * @param params { businessId, fileIds:number[], folderId|null, strict? }
 * @returns {ok:true, data:{ files, folder, moved }} | {ok:false, code, http, detail?}
 */
async function moveFiles(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const businessId = Number(params.businessId);
  const strict = !!params.strict;
  const { getUserScope, isMemberOrAbove, canAccessFileByLevel } = require('../../middleware/access_scope');
  const scope = await getUserScope(subj.subjectId, businessId, subj.platformRole);
  if (!isMemberOrAbove(scope)) return fail('forbidden', 403);

  const ids = [...new Set((params.fileIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return fail('file_ids required', 400);

  const folderId = params.folderId ? Number(params.folderId) : null;
  let folder = null;
  if (folderId) {
    folder = await FileFolder.findOne({ where: { id: folderId, business_id: businessId } });
    if (!folder) return fail(strict ? 'folder_not_found' : 'Invalid folder_id', strict ? 404 : 400);
  }

  const files = await File.findAll({ where: { id: { [Op.in]: ids }, business_id: businessId, deleted_at: null } });
  const byId = new Map(files.map((f) => [f.id, f]));
  let mailIds = null;
  if (strict) mailIds = new Set(await require('../mailAttachmentFiles').mailAttachmentFileIds(businessId));
  const shared = strict && folder ? await isSharedPublicly(folder) : false;

  // 전수 판정 — 하나라도 안 되면 아무것도 옮기지 않는다
  for (const id of ids) {
    const file = byId.get(id);
    if (!file) return fail('file_not_found', 404, { file_id: id });
    if (strict && !(await canAccessFileByLevel(subj.subjectId, file, scope))) return fail('file_not_found', 404, { file_id: id });
    if (!(await canMutateFile(file, subj.subjectId, scope))) return fail('file_move_forbidden', 403, { file_id: id });
    if (strict && mailIds.has(file.id)) return fail('mail_attachment_not_movable', 400, { file_id: id });
    if (folder) {
      const fp = file.project_id ? Number(file.project_id) : null;
      const dp = folder.project_id ? Number(folder.project_id) : null;
      // 화면: 파일에 프로젝트가 있으면 같은 프로젝트 폴더만(verifyFolderOwnership). AI: 둘 다 엄격히 같아야 — 프로젝트가 바뀌는 이동은 가시성 확대.
      if (strict ? fp !== dp : (fp && fp !== dp)) return fail(strict ? 'folder_in_other_project' : 'Invalid folder_id', 400, { file_id: id });
    }
    if (shared) return fail('folder_shared_publicly', 403, { folder_id: folder.id });
  }

  const moved = [];
  for (const id of ids) {
    const file = byId.get(id);
    const prev = file.folder_id;
    if (prev === folderId) continue;
    file.folder_id = folderId;
    await file.save();
    moved.push(file.id);
    audit(actor, { action: 'file.move', targetType: 'file', targetId: file.id, businessId, oldValue: { folder_id: prev }, newValue: { folder_id: folderId } });
    mirrorMove(file, folderId);
    signalFile(file);
  }
  return done({ files: ids.map((id) => byId.get(id)), folder, moved });
}

// Drive 사본도 같은 자리로 (Irene 2026-08-31). 미러된 파일에만 · 실패해도 이동은 되돌리지 않는다(PlanQ 가 정본).
//   ★ 업로드·미러와 **같은 함수**(resolveDriveParent)로 자리를 정한다 — `프로젝트/폴더/`.
function mirrorMove(file, folderId) {
  if (!file.gdrive_mirror_id) return;
  setImmediate(async () => {
    try {
      const gdrive = require('../gdrive');
      const mirror = require('../gdriveMirror');
      const token = await gdrive.getTokenForBusiness(file.business_id);
      if (!token || !token.root_folder_id) return;
      const drive = await gdrive.getDriveClient(token);
      const parentId = await mirror.resolveDriveParent(drive, token, { projectId: file.project_id, folderId });
      await gdrive.moveFile(drive, file.gdrive_mirror_id, parentId);
    } catch (e) { console.warn('[file move] Drive 반영 실패:', e.message); }
  });
}

module.exports = { createFolder, moveFiles, isSharedPublicly, folderPath, ancestorChain, MAX_DEPTH, MAX_NAME };
