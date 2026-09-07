// services/personalDrive.js — 개인 Google Drive 파일 목록
//
// external_connections (owner_scope='user', provider='google_drive') 기준.
// drive.file scope (비제한 — 회사 Drive 와 동일) → PlanQ 가 내 개인 Drive 에 저장/연 파일만 보임.
// 기존 전체 파일 열람(drive.readonly)은 제한 권한·유료심사라 채택 안 함 (Irene 결정 2026-06-01).
const { google } = require('googleapis');
const personalOauth = require('./personalOauth');
const gdrive = require('./gdrive');

// 내 Drive 파일 list — 목록 구현은 gdrive.listDriveFiles 하나다(팀 드라이브와 공용).
//   여기서 다시 짜면 한쪽에만 검색·페이지네이션·공유드라이브 지원이 남는다.
async function listFiles(conn, opts = {}) {
  const auth = await personalOauth.getAuthedClient(conn);
  const drive = google.drive({ version: 'v3', auth });
  return gdrive.listDriveFiles(drive, opts);
}

module.exports = { listFiles };
