// Google Drive OAuth + API 래퍼
// drive.file scope — 앱이 만든 파일/폴더만 접근
const { google } = require('googleapis');
const { BusinessCloudToken } = require('../models');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

function newOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * OAuth 동의 URL 생성
 * state 에 { businessId, userId } 를 인코딩해서 callback 에서 복원
 */
function buildAuthUrl(businessId, userId) {
  const client = newOAuth2Client();
  const state = Buffer.from(JSON.stringify({ b: businessId, u: userId, t: Date.now() })).toString('base64url');
  return client.generateAuthUrl({
    access_type: 'offline',     // refresh_token 받기 위해 필수
    prompt: 'consent',          // refresh_token 매번 받도록 강제 (재연동 시)
    scope: SCOPES,
    state,
    include_granted_scopes: true
  });
}

function parseState(state) {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return { businessId: decoded.b, userId: decoded.u, ts: decoded.t };
  } catch {
    return null;
  }
}

/**
 * code → tokens 교환 + 사용자 이메일 조회
 */
async function exchangeCodeForTokens(code) {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);

  // drive.file scope 로 about.get 호출하여 계정 이메일/이름 취득
  // (id_token 에는 email 정보가 없음 — openid scope 가 없으므로)
  let accountEmail = null;
  let accountName = null;
  try {
    client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: client });
    const about = await drive.about.get({ fields: 'user(emailAddress, displayName)' });
    accountEmail = about.data.user?.emailAddress || null;
    accountName = about.data.user?.displayName || null;
  } catch (e) {
    console.error('[gdrive] about.get failed:', e.message);
  }
  return { tokens, accountEmail, accountName };
}

/**
 * 저장된 토큰으로 Drive 클라이언트 구성
 * 만료 시 자동 갱신 + DB 업데이트
 */
async function getDriveClient(token) {
  const client = newOAuth2Client();
  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expiry_date: token.expires_at ? new Date(token.expires_at).getTime() : null
  });
  // 자동 토큰 갱신 감지 → DB 업데이트
  client.on('tokens', async (fresh) => {
    try {
      const update = {};
      if (fresh.access_token) update.access_token = fresh.access_token;
      if (fresh.refresh_token) update.refresh_token = fresh.refresh_token;
      if (fresh.expiry_date) update.expires_at = new Date(fresh.expiry_date);
      if (Object.keys(update).length > 0) await token.update(update);
    } catch (e) { console.error('[gdrive] token refresh save failed:', e.message); }
  });
  return google.drive({ version: 'v3', auth: client });
}

/**
 * PlanQ 루트 폴더 생성 (앱이 만든 파일만 접근하므로, 폴더도 앱이 생성해야 함)
 */
async function createRootFolder(drive, businessName) {
  const res = await drive.files.create({
    requestBody: {
      name: `PlanQ - ${businessName || 'workspace'}`,
      mimeType: 'application/vnd.google-apps.folder'
    },
    fields: 'id, name, webViewLink'
  });
  return res.data;
}

/**
 * 하위 폴더 생성 (parent 아래)
 */
async function createFolder(drive, name, parentId) {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined
    },
    fields: 'id, name, webViewLink'
  });
  return res.data;
}

/**
 * 파일 업로드 (Buffer 또는 stream)
 */
async function uploadFile(drive, { name, mimeType, body, parentId }) {
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: parentId ? [parentId] : undefined
    },
    media: { mimeType, body },
    fields: 'id, name, size, mimeType, webViewLink, webContentLink, createdTime'
  });
  return res.data;
}

/**
 * 파일 삭제
 */
async function deleteFile(drive, fileId) {
  await drive.files.delete({ fileId });
}

/**
 * 폴더 이름 변경
 */
async function renameFile(drive, fileId, name) {
  const res = await drive.files.update({
    fileId,
    requestBody: { name },
    fields: 'id, name'
  });
  return res.data;
}

/**
 * 비즈니스의 저장된 토큰 조회
 */
async function getTokenForBusiness(businessId) {
  return await BusinessCloudToken.findOne({
    where: { business_id: businessId, provider: 'gdrive' }
  });
}

/**
 * 프로젝트용 Drive 폴더 확보 — 없으면 루트 아래에 생성하고 project.gdrive_folder_id 저장
 */
async function ensureProjectFolder(drive, token, project) {
  // 이미 매핑되어 있으면 그대로 (실제 Drive 존재 여부는 신뢰)
  if (project.gdrive_folder_id) {
    try {
      // 폴더 존재 여부 확인
      await drive.files.get({ fileId: project.gdrive_folder_id, fields: 'id, trashed' });
      return project.gdrive_folder_id;
    } catch {
      // 외부에서 삭제됨 → 재생성
    }
  }
  const folder = await createFolder(drive, project.name || `Project ${project.id}`, token.root_folder_id);
  project.gdrive_folder_id = folder.id;
  await project.save();
  return folder.id;
}

module.exports = {
  isConfigured,
  SCOPES,
  buildAuthUrl,
  parseState,
  exchangeCodeForTokens,
  getDriveClient,
  createRootFolder,
  createFolder,
  uploadFile,
  deleteFile,
  renameFile,
  getTokenForBusiness,
  ensureProjectFolder
};
