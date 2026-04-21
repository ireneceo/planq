// Dropbox OAuth + API 래퍼
// App Folder 모드 — /Apps/PlanQ/ 외부 접근 불가 (최소 권한)
const { Dropbox, DropboxAuth } = require('dropbox');
const { BusinessCloudToken } = require('../models');

// App Folder 모드에서는 scope 지정 불필요 (앱 권한이 App Folder 로 제한됨)
// 파일/폴더 CRUD 기본 scope
const SCOPES = [
  'files.content.write',
  'files.content.read',
  'files.metadata.write',
  'files.metadata.read',
  'account_info.read'
];

function isConfigured() {
  return !!(process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET && process.env.DROPBOX_REDIRECT_URI);
}

function newAuth() {
  return new DropboxAuth({
    clientId: process.env.DROPBOX_CLIENT_ID,
    clientSecret: process.env.DROPBOX_CLIENT_SECRET
  });
}

async function buildAuthUrl(businessId, userId) {
  const auth = newAuth();
  const state = Buffer.from(JSON.stringify({ b: businessId, u: userId, t: Date.now() })).toString('base64url');
  const url = await auth.getAuthenticationUrl(
    process.env.DROPBOX_REDIRECT_URI,
    state,
    'code',
    'offline',             // refresh_token 수령
    SCOPES,
    'none',
    false
  );
  return url.toString();
}

function parseState(state) {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return { businessId: decoded.b, userId: decoded.u, ts: decoded.t };
  } catch { return null; }
}

async function exchangeCodeForTokens(code) {
  const auth = newAuth();
  const { result } = await auth.getAccessTokenFromCode(process.env.DROPBOX_REDIRECT_URI, code);
  const tokens = {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: result.expires_in ? new Date(Date.now() + result.expires_in * 1000) : null,
    scope: result.scope
  };
  // 계정 정보
  let accountEmail = null;
  let accountName = null;
  try {
    const dbx = new Dropbox({ accessToken: result.access_token });
    const acct = await dbx.usersGetCurrentAccount();
    accountEmail = acct.result.email;
    accountName = acct.result.name?.display_name;
  } catch (e) {
    console.error('[dropbox] account info failed:', e.message);
  }
  return { tokens, accountEmail, accountName };
}

function getDbxClient(token) {
  const client = new Dropbox({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    clientId: process.env.DROPBOX_CLIENT_ID,
    clientSecret: process.env.DROPBOX_CLIENT_SECRET
  });
  // auto-refresh 는 Dropbox SDK 가 access_token 만료 시 자동 refresh
  return client;
}

/**
 * App Folder 루트는 계정 단위로 자동 관리 (별도 폴더 생성 불필요).
 * 다만 워크스페이스별 구분을 위해 "/PlanQ - {workspace}/" 하위 폴더 생성.
 */
async function createRootFolder(dbx, businessName) {
  const name = `/PlanQ - ${businessName || 'workspace'}`;
  try {
    const res = await dbx.filesCreateFolderV2({ path: name, autorename: false });
    return { id: res.result.metadata.id, name: res.result.metadata.name, path: res.result.metadata.path_display };
  } catch (e) {
    if (e?.error?.error_summary?.startsWith('path/conflict')) {
      // 이미 존재 → 메타 조회
      const meta = await dbx.filesGetMetadata({ path: name });
      return { id: meta.result.id, name: meta.result.name, path: meta.result.path_display };
    }
    throw e;
  }
}

async function createFolder(dbx, name, parentPath) {
  const path = `${parentPath}/${name}`;
  try {
    const res = await dbx.filesCreateFolderV2({ path, autorename: false });
    return { id: res.result.metadata.id, name: res.result.metadata.name, path: res.result.metadata.path_display };
  } catch (e) {
    if (e?.error?.error_summary?.startsWith('path/conflict')) {
      const meta = await dbx.filesGetMetadata({ path });
      return { id: meta.result.id, name: meta.result.name, path: meta.result.path_display };
    }
    throw e;
  }
}

async function uploadFile(dbx, { name, body, parentPath }) {
  const path = `${parentPath}/${name}`;
  // stream 을 Buffer 로 모음 (Dropbox SDK 는 Buffer 필요)
  let contents;
  if (Buffer.isBuffer(body)) contents = body;
  else {
    const chunks = [];
    for await (const chunk of body) chunks.push(chunk);
    contents = Buffer.concat(chunks);
  }
  const res = await dbx.filesUpload({ path, contents, mode: { '.tag': 'add' }, autorename: true });
  const md = res.result;
  return {
    id: md.id,
    name: md.name,
    size: md.size,
    path: md.path_display,
    webViewLink: `https://www.dropbox.com/home${md.path_display}`,
    createdTime: md.server_modified
  };
}

async function deleteFile(dbx, pathOrId) {
  await dbx.filesDeleteV2({ path: pathOrId });
}

async function renameFile(dbx, fromPath, newName) {
  // Dropbox move 는 to_path 를 전체 경로로 받음
  const parent = fromPath.substring(0, fromPath.lastIndexOf('/'));
  const toPath = `${parent}/${newName}`;
  const res = await dbx.filesMoveV2({ from_path: fromPath, to_path: toPath, autorename: false });
  return { id: res.result.metadata.id, name: res.result.metadata.name, path: res.result.metadata.path_display };
}

async function getTokenForBusiness(businessId) {
  return await BusinessCloudToken.findOne({
    where: { business_id: businessId, provider: 'dropbox' }
  });
}

/**
 * 프로젝트 폴더 확보 — Dropbox 는 id 말고 path 기반이 간단.
 * BusinessCloudToken.root_folder_id 에는 경로를 저장 (e.g. "/PlanQ - 워프로랩")
 */
async function ensureProjectFolder(dbx, token, project) {
  const rootPath = token.root_folder_id;  // Dropbox 에서는 path_display 가 ID 역할
  if (project.dropbox_folder_id) {
    try {
      await dbx.filesGetMetadata({ path: project.dropbox_folder_id });
      return project.dropbox_folder_id;
    } catch { /* 재생성 */ }
  }
  const folder = await createFolder(dbx, project.name || `Project ${project.id}`, rootPath);
  project.dropbox_folder_id = folder.path;  // 경로를 id 로 저장
  await project.save();
  return folder.path;
}

module.exports = {
  isConfigured,
  SCOPES,
  buildAuthUrl,
  parseState,
  exchangeCodeForTokens,
  getDbxClient,
  createRootFolder,
  createFolder,
  uploadFile,
  deleteFile,
  renameFile,
  getTokenForBusiness,
  ensureProjectFolder
};
