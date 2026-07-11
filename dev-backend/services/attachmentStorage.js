// 첨부 실체 읽기 — 저장소(provider) 단일 원천.
//
// #134 근본원인: 업무 첨부는 프로젝트에 Drive 가 연결돼 있으면 Drive 에 올리고 로컬 파일을 지운다.
//   그런데 서빙 경로들이 항상 로컬 경로만 봐서 410 → 이미지 깨짐. "어떤 업무는 이미지가 보이고
//   어떤 업무는 안 보인다"(워크스페이스 직속=로컬 / 프로젝트=Drive)의 정체.
//
// Drive 링크(webViewLink)로 리다이렉트하면 안 된다 — <img> 가 구글 로그인 벽에 막혀 여전히 안 보인다.
//   서버가 워크스페이스 Drive 토큰으로 받아서 흘려준다 (접근제어가 서버에 남는다).
//
// 반환:
//   { ok: true, stream, abs? }   — 스트림으로 흘려보내면 됨 (abs 는 로컬일 때만 — 리사이즈용)
//   { ok: true, redirect: url }  — 외부 URL 로 302 (S3 presign 등)
//   { ok: false, code, msg }     — 에러 (errorResponse 로 그대로 전달)

const fs = require('fs');
const path = require('path');
const { BusinessCloudToken } = require('../models');
const gdrive = require('./gdrive');

async function readAttachmentBody(att) {
  // 자체 저장(planq) — 로컬 파일
  if (!att.storage_provider || att.storage_provider === 'planq') {
    const abs = path.isAbsolute(att.file_path)
      ? att.file_path
      : path.join(__dirname, '..', att.file_path);
    if (!fs.existsSync(abs)) return { ok: false, code: 410, msg: 'file_missing' };
    return { ok: true, stream: fs.createReadStream(abs), abs };
  }

  // 구글 드라이브 — 워크스페이스 토큰으로 서버가 받아서 흘려준다
  if (att.storage_provider === 'gdrive' && att.external_id) {
    const cloudToken = await BusinessCloudToken.findOne({
      where: { business_id: att.business_id, provider: 'gdrive' },
    });
    if (!cloudToken) return { ok: false, code: 409, msg: 'drive_not_connected' };
    try {
      const drive = await gdrive.getDriveClient(cloudToken);
      const stream = await gdrive.getFileStream(drive, att.external_id);
      return { ok: true, stream };
    } catch (e) {
      console.error('[attachmentStorage] drive stream failed:', e.message);
      gdrive.recordTokenError(cloudToken, e);
      return { ok: false, code: 502, msg: 'drive_fetch_failed' };
    }
  }

  // 독립 서버(S3) — presign 또는 public URL (files.js _s3Redirect 와 같은 규칙)
  if (att.storage_provider === 's3' && att.external_id) {
    const { WorkspaceStorageConfig } = require('../models');
    const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: att.business_id } });
    if (!cfg) return { ok: false, code: 502, msg: 's3_config_missing' };
    try {
      const url = cfg.public_base_url
        ? `${cfg.public_base_url.replace(/\/$/, '')}/${att.external_id}`
        : await require('./s3Storage').presignGet(cfg, att.external_id, 300);
      return { ok: true, redirect: url };
    } catch (e) {
      console.error('[attachmentStorage] s3 presign failed:', e.message);
      return { ok: false, code: 502, msg: 's3_presign_failed' };
    }
  }

  // 그 외 외부 저장소 — 외부 URL 이 있으면 그리로
  if (att.external_url) return { ok: true, redirect: att.external_url };
  return { ok: false, code: 409, msg: 'external_file_no_url' };
}

module.exports = { readAttachmentBody };
