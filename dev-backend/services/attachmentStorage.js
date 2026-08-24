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

// 워크스페이스별 "Drive 인증이 죽어 있는 동안" 창 — 같은 실패를 구글까지 반복해서 묻지 않는다.
const driveDownUntil = new Map();

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
    // 토큰이 죽은 직후엔 구글을 다시 때리지 않는다 (아래 catch 에서 세운 창).
    const downUntil = driveDownUntil.get(att.business_id) || 0;
    if (downUntil > Date.now()) return { ok: false, code: 409, msg: 'drive_reconnect_required' };
    const cloudToken = await BusinessCloudToken.findOne({
      where: { business_id: att.business_id, provider: 'gdrive' },
    });
    if (!cloudToken) return { ok: false, code: 409, msg: 'drive_not_connected' };
    try {
      const drive = await gdrive.getDriveClient(cloudToken);
      const stream = await gdrive.getFileStream(drive, att.external_id);
      return { ok: true, stream };
    } catch (e) {
      // ★ 2026-08-24 — 토큰이 죽으면(invalid_grant) 모든 첨부가 502 가 되고, 화면이 그걸 계속
      //   재시도해 브라우저 자원이 고갈됐다(ERR_INSUFFICIENT_RESOURCES 폭주). 실패를 짧게 기억해
      //   같은 워크스페이스의 뒤이은 요청은 **구글까지 가지 않고** 바로 돌려준다.
      //   토큰이 재연결되면 60초 뒤 자동으로 다시 시도한다(수동 개입 불필요).
      const isAuth = /invalid_grant|unauthorized|invalid_credentials/i.test(e.message || '');
      if (isAuth) driveDownUntil.set(att.business_id, Date.now() + 60_000);
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
