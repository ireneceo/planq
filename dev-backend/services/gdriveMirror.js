// services/gdriveMirror.js
// GDrive 미러 — 로컬(planq) 저장 파일을 워크스페이스 연결 Drive 에 "사본"으로 올린다.
//   ★ storage_provider 는 'planq' 유지 (서빙/다운로드/인라인이미지/ZIP 전부 로컬 그대로). Drive 는 가시성용 사본.
//   File.gdrive_mirror_id/_url/_at 에 기록. 업로드 시점 미러는 비치명(파일은 이미 로컬에 안전).
//   Fable 게이트 반영: L1 개인파일은 연결계정 주인(owner) 본인 것만, security!=general 제외, 멱등, content_hash 중복 회피(백필).
const path = require('path');
const fs = require('fs');
const gdrive = require('./gdrive');
const { File, Project } = require('../models');

function absLocalPath(file) {
  const p = file.file_path;
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(__dirname, '..', p);
}

// 워크스페이스 파일 공용 폴더 (root/Workspace Files) — dedup + token 캐시 (ensureConversationsFolder 패턴)
async function ensureWorkspaceFilesFolder(drive, token) {
  if (token.workspace_folder_id) {
    try {
      const r = await drive.files.get({ fileId: token.workspace_folder_id, fields: 'id, trashed' });
      if (r.data && !r.data.trashed) return token.workspace_folder_id;
    } catch { /* 재생성 */ }
  }
  try {
    const q = `'${token.root_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and name='Workspace Files' and trashed=false`;
    const list = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 1 });
    if (list.data.files && list.data.files.length > 0) {
      const id = list.data.files[0].id;
      try { await token.update({ workspace_folder_id: id }); } catch { /* 컬럼 없으면 silent */ }
      return id;
    }
  } catch { /* 새로 생성 */ }
  const folder = await gdrive.createFolder(drive, 'Workspace Files', token.root_folder_id);
  try { await token.update({ workspace_folder_id: folder.id }); } catch { /* silent */ }
  return folder.id;
}

// 미러 대상 여부 — storage=planq · 미미러 · security general · (L1 이면 uploader==연결자 본인만)
function isEligible(file, token) {
  if (!file) return false;
  if (file.storage_provider !== 'planq') return false;   // gdrive/s3 는 이미 외부에 사본 존재
  if (file.gdrive_mirror_id) return false;               // 이미 미러됨 (멱등)
  if (file.deleted_at) return false;
  if (file.security_level && file.security_level !== 'general') return false;  // confidential/internal 제외 (File.js 정책)
  const level = file.vlevel || file.visibility || 'L3';
  if (level === 'L1') {
    // 개인 파일은 연결계정 주인(owner) 본인 것만 — 타 멤버 개인파일을 owner Drive 에 노출 금지
    return token.connected_by != null && String(file.uploader_id) === String(token.connected_by);
  }
  return true;  // L2/L3/L4 워크스페이스·팀·외부
}

// 부모 폴더 결정 → Drive 사본 업로드 → File 미러 컬럼 기록. drive/token 은 호출부 재사용.
async function mirrorFile(file, token, drive) {
  const abs = absLocalPath(file);
  if (!abs || !fs.existsSync(abs)) throw new Error('local file missing: ' + (file.file_path || '?'));
  let parentId;
  if (file.project_id) {
    const project = await Project.findByPk(file.project_id);
    parentId = project
      ? await gdrive.ensureProjectFolder(drive, token, project)
      : await ensureWorkspaceFilesFolder(drive, token);
  } else {
    parentId = await ensureWorkspaceFilesFolder(drive, token);
  }
  const driveFile = await gdrive.uploadFile(drive, {
    name: file.file_name || path.basename(abs),
    mimeType: file.mime_type || 'application/octet-stream',
    body: fs.createReadStream(abs),
    parentId,
  });
  await file.update({
    gdrive_mirror_id: driveFile.id,
    gdrive_mirror_url: driveFile.webViewLink || null,
    gdrive_mirrored_at: new Date(),
  });
  return driveFile.id;
}

// 업로드 시점 best-effort 미러 (응답 블로킹 X — 실패해도 파일은 로컬에 안전, 502 안 냄)
async function mirrorOnUpload(fileId, businessId) {
  try {
    const token = await gdrive.getTokenForBusiness(businessId);
    if (!token || !token.root_folder_id) return;
    const file = await File.findByPk(fileId);
    if (!file || !isEligible(file, token)) return;
    const drive = await gdrive.getDriveClient(token);
    await mirrorFile(file, token, drive);
    gdrive.clearTokenError(token);
  } catch (e) {
    console.warn('[gdriveMirror] mirrorOnUpload failed (file', fileId, '):', e.message);
    try { const t = await gdrive.getTokenForBusiness(businessId); if (t) gdrive.recordTokenError(t, e); } catch { /* */ }
  }
}

module.exports = { ensureWorkspaceFilesFolder, isEligible, mirrorFile, mirrorOnUpload, absLocalPath };
