// services/personalDrive.js — 개인 Google Drive 파일 목록 (읽기 전용)
//
// external_connections (owner_scope='user', provider='google_drive') 의 내 Drive 파일을
// Q File 개인 탭에서 열람. drive.readonly scope — 다운로드/링크 열기만, PlanQ 가 수정하지 않음.
const { google } = require('googleapis');
const personalOauth = require('./personalOauth');

// 내 Drive 파일 list (최근 수정순). 외부 호출 — 10s timeout.
async function listFiles(conn, { q, pageSize = 50, pageToken } = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const drive = google.drive({ version: 'v3', auth });
  const kw = q ? String(q).trim().slice(0, 100).replace(/'/g, "\\'") : null;
  const query = kw ? `name contains '${kw}' and trashed=false` : 'trashed=false';
  const resp = await drive.files.list({
    q: query,
    fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 100),
    pageToken: pageToken || undefined,
    spaces: 'drive',
  }, { timeout: 10000 });
  return {
    files: (resp.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mime_type: f.mimeType,
      size: f.size ? Number(f.size) : null,
      modified_at: f.modifiedTime,
      icon_link: f.iconLink || null,
      web_view_link: f.webViewLink || null,
    })),
    next_page_token: resp.data.nextPageToken || null,
  };
}

module.exports = { listFiles };
