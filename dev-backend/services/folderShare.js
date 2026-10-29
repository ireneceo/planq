// 폴더 공유 링크(#469) — **판정 한 벌** (Fable 설계 판정 3, docs/FOLDER_SHARE_DESIGN.md §4).
//
//   공개 메타·받기·썸네일·zip·auth-check·공유 창 숫자(보임 N · 빠짐 M)가 **전부 이 파일만** 부른다.
//   라우트마다 «이 파일이 링크에 드나» 를 따로 적으면 목록과 받기가 갈라진다(id 만 알면 받는 구멍).
//
//   내용은 **살아 있다** — 열 때마다 폴더(+하위 폴더) 안 파일을 발급자 기준으로 다시 거른다.
//   파일을 L1·대외비로 바꾸거나 밖으로 옮기면 다음 요청부터 빠지고, 넣으면 나타난다.
//   발급자가 워크스페이스를 떠나거나(멤버 아님) 그 프로젝트를 못 보게 되면 링크 전체가 닫힌다(판정 2).
'use strict';

const { Op } = require('sequelize');
const { FileFolder, File, User } = require('../models');
const { getUserScope, isMemberOrAbove, canSeeProject } = require('../middleware/access_scope');
const { isFolderLinkFile, folderLinkExcludeReason } = require('./shareOpenable');

const MAX_FILES = 500;
const MAX_DEPTH = 10;
const ZIP_MAX_BYTES = Number(process.env.FOLDER_SHARE_ZIP_MAX_BYTES) || 500 * 1024 * 1024;

// 파일 판정에 필요한 칸 — canAccessFileByLevel 이 읽는 것 + 보여 줄 것.
const FILE_ATTRS = ['id', 'business_id', 'project_id', 'folder_id', 'uploader_id', 'file_name', 'file_path', 'file_size',
  'mime_type', 'storage_provider', 'external_id', 'external_url', 'vlevel', 'visibility', 'target_member_ids',
  'security_level', 'deleted_at', 'created_at'];

/** 발급자가 지금도 이 폴더를 내보낼 수 있는 사람인가 — 발급 문과 같은 선(멤버 이상 ∧ 프로젝트 폴더면 그 프로젝트가 보임). */
async function issuerScopeFor(folder, userId) {
  if (!userId) return null;
  const u = await User.findByPk(userId, { attributes: ['id', 'status'] });
  if (!u || u.status !== 'active') return null;
  const scope = await getUserScope(userId, folder.business_id);
  if (!isMemberOrAbove(scope)) return null;
  if (folder.project_id && !canSeeProject(scope, folder.project_id)) return null;
  return scope;
}

/**
 * 토큰 → { folder, issuerScope } 또는 { reason }.
 *   reason: 'missing' (없음·발급자 없음 — 404) · 'expired' (410 은 라우트가 checkShareExpiry 로 낸다).
 *   ★ 발급자가 떠난 링크는 'missing' 과 같은 404 다 — 바깥 사람에게 «누가 떠났다» 를 알리지 않는다.
 */
async function resolveFolderShare(token) {
  const t = String(token || '').trim();
  if (!t) return { reason: 'missing' };
  const folder = await FileFolder.findOne({ where: { share_token: t } });
  if (!folder) return { reason: 'missing' };
  if (folder.share_expires_at && new Date(folder.share_expires_at) < new Date()) return { reason: 'expired', folder };
  const issuerScope = await issuerScopeFor(folder, folder.shared_by);
  if (!issuerScope) return { reason: 'missing' };
  return { folder, issuerScope };
}

/** 폴더와 하위 폴더 — [{ id, name, path }] (path = 공유 폴더 기준 상대 경로, 루트는 ''). 깊이 10 · visited. */
async function folderTree(folder) {
  const out = [{ id: folder.id, name: folder.name, path: '' }];
  const visited = new Set([folder.id]);
  let frontier = [{ id: folder.id, path: '' }];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    // ★ business_id 를 건다 — parent_id 사슬만 믿지 않는다(멀티테넌트 격리).
    const kids = await FileFolder.findAll({
      where: { business_id: folder.business_id, parent_id: frontier.map((f) => f.id) },
      attributes: ['id', 'name', 'parent_id'],
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    const pathOf = new Map(frontier.map((f) => [f.id, f.path]));
    const next = [];
    for (const k of kids) {
      if (visited.has(k.id)) continue;
      visited.add(k.id);
      const parentPath = pathOf.get(k.parent_id) || '';
      const path = parentPath ? `${parentPath}/${k.name}` : k.name;
      out.push({ id: k.id, name: k.name, path });
      next.push({ id: k.id, path });
    }
    frontier = next;
  }
  return out;
}

/**
 * 링크에 실리는 파일 — 경로·이름 순으로 **고정**(요청마다 다른 «앞부분» 이면 파일이 사라졌다 나타났다로 읽힌다).
 * @returns {{ files: Array<{file, path}>, total, truncated, excluded, reasons, bytes, tree, rows }}
 *   total = 실리는 파일 수(상한 전) · excluded = 폴더 안에 있지만 빠진 파일 수(나만 보기·대외비·한정 범위 등)
 */
async function listFolderLinkFiles(folder, issuerScope, { limit = MAX_FILES } = {}) {
  const tree = await folderTree(folder);
  const pathById = new Map(tree.map((f) => [f.id, f.path]));
  const rows = await File.findAll({
    where: { business_id: folder.business_id, folder_id: { [Op.in]: tree.map((f) => f.id) }, deleted_at: null },
    attributes: FILE_ATTRS,
  });
  const ok = [];
  let excluded = 0;
  const reasons = { private: 0, targeted: 0, confidential: 0, no_access: 0 };
  for (const f of rows) {
    const why = await folderLinkExcludeReason(f, issuerScope);
    if (why === null) ok.push({ file: f, path: pathById.get(f.folder_id) || '' });
    else { excluded += 1; reasons[why] += 1; }
  }
  ok.sort((a, b) => (a.path === b.path
    ? String(a.file.file_name).localeCompare(String(b.file.file_name), 'ko') || a.file.id - b.file.id
    : (a.path === '' ? -1 : b.path === '' ? 1 : a.path.localeCompare(b.path, 'ko'))));
  const bytes = ok.reduce((s, x) => s + Number(x.file.file_size || 0), 0);
  return { files: ok.slice(0, limit), total: ok.length, truncated: ok.length > limit, excluded, reasons, bytes, tree, rows };
}

/** 이 파일이 지금 이 링크에 드는가 — 받기·썸네일이 id 만으로 통과하지 않게 같은 판정을 다시 한다. */
async function folderLinkFileById(folder, issuerScope, fileId) {
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const f = await File.findOne({ where: { id, business_id: folder.business_id, deleted_at: null }, attributes: FILE_ATTRS });
  if (!f || !f.folder_id) return null;
  const tree = await folderTree(folder);
  if (!tree.some((x) => x.id === f.folder_id)) return null;
  if (!(await isFolderLinkFile(f, issuerScope))) return null;
  return f;
}

/** 발급·끄기 — 멤버 이상(고객 X) ∧ 프로젝트 폴더면 그 프로젝트가 보임. 발급자 판정과 같은 술어. */
async function canManageFolderShare(user, folder) {
  const scope = await getUserScope(user.id, folder.business_id, user.platform_role);
  if (!isMemberOrAbove(scope)) return null;
  if (folder.project_id && !canSeeProject(scope, folder.project_id)) return null;
  return scope;
}

module.exports = {
  MAX_FILES, MAX_DEPTH, ZIP_MAX_BYTES,
  resolveFolderShare, folderTree, listFolderLinkFiles, folderLinkFileById, canManageFolderShare, issuerScopeFor,
};
