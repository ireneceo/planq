// services/personalDrive.js — 개인 Google Drive 파일 목록
//
// external_connections (owner_scope='user', provider='google_drive') 기준.
// drive.file scope (비제한 — 회사 Drive 와 동일) → PlanQ 가 내 개인 Drive 에 저장/연 파일만 보임.
// 기존 전체 파일 열람(drive.readonly)은 제한 권한·유료심사라 채택 안 함 (Irene 결정 2026-06-01).
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
