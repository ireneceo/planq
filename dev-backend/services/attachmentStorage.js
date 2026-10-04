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
const driveCache = require('./driveCache');

// 워크스페이스별 "Drive 인증이 죽어 있는 동안" 창 — 같은 실패를 구글까지 반복해서 묻지 않는다.
const driveDownUntil = new Map();

// 로컬 파일 본문 — 스트림은 **꺼낼 때** 연다.
//   sendFile 로 내보내는 호출부는 `stream` 을 한 번도 안 건드리는데, 미리 열어 두면 그 fd 가 닫히지 않는다.
function localBody(abs, size) {
  let s = null;
  return {
    ok: true,
    abs,
    size,
    get stream() { if (!s) s = fs.createReadStream(abs); return s; },
  };
}

async function readAttachmentBody(att) {
  // 자체 저장(planq) — 로컬 파일
  if (!att.storage_provider || att.storage_provider === 'planq') {
    const abs = path.isAbsolute(att.file_path)
      ? att.file_path
      : path.join(__dirname, '..', att.file_path);
    let st;
    try { st = fs.statSync(abs); } catch { return { ok: false, code: 410, msg: 'file_missing' }; }
    return localBody(abs, st.size);
  }

  // 구글 드라이브 — 워크스페이스 토큰으로 서버가 받아서 흘려준다
  if (att.storage_provider === 'gdrive' && att.external_id) {
    // 토큰이 죽은 직후엔 구글을 다시 때리지 않는다 (아래 catch 에서 세운 창).
    // ★ 2026-10-04 — 캐시본이 있으면 **Drive 에 가지 않는다.** (권한은 호출부가 이미 봤다 — 이 함수는
    //   언제나 판정 뒤에 불린다.) 캐시본은 로컬 파일과 똑같이 돌려준다 → sendFile·Range·Content-Length·
    //   리사이즈가 그대로 탄다. 첫 바이트 0.7~2.5초(Drive 왕복) → 수 ms.
    const hit = driveCache.lookup(att.business_id, att.external_id, att.file_size);
    // ★ 펼치기(`...`)를 쓰지 않는다 — getter 가 평가돼 스트림이 미리 열린다.
    if (hit) { const b = localBody(hit.path, hit.size); b.cached = true; return b; }
    const downUntil = driveDownUntil.get(att.business_id) || 0;
    if (downUntil > Date.now()) return { ok: false, code: 409, msg: 'drive_reconnect_required' };
    const cloudToken = await BusinessCloudToken.findOne({
      where: { business_id: att.business_id, provider: 'gdrive' },
    });
    if (!cloudToken) return { ok: false, code: 409, msg: 'drive_not_connected' };
    try {
      const drive = await gdrive.getDriveClient(cloudToken);
      const raw = await gdrive.getFileStream(drive, att.external_id);
      const size = Number.isFinite(raw.contentLength) ? raw.contentLength : null;
      // 받는 길에 캐시에도 쓴다 — 다음부터는 위 적중 분기로 나간다. 길이가 맞을 때만 캐시가 남는다.
      const stream = driveCache.teeIntoCache(raw, att.business_id, att.external_id, { expectedLen: size });
      return { ok: true, stream, size, drive: true };
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

/**
 * readAttachmentBody 결과를 응답으로 내보낸다 — **헤더(Content-Type·Disposition 등)는 호출부가 먼저 세운다.**
 *   · 로컬·캐시본(abs) → sendFile: Range·Content-Length·ETag 를 express 가 처리한다
 *   · 스트림(Drive 첫 다운로드) → 길이를 알면 Content-Length 를 싣는다(화면이 % 를 낸다)
 *   · 받는 쪽이 끊으면 원본 스트림도 끊는다(pipe 는 끊지 않아 Drive 연결·반쪽 캐시가 남았다)
 */
function sendAttachmentBody(res, body, tag = 'attachment') {
  // 운영에서 «캐시가 먹는가» 를 응답만 보고 알 수 있게(값은 hit/miss 뿐 — 경로·키는 싣지 않는다).
  if (body.cached) res.setHeader('X-Storage-Cache', 'hit');
  else if (body.drive) res.setHeader('X-Storage-Cache', 'miss');
  if (body.abs) {
    // uploads/.cache 아래 캐시본은 경로에 점 폴더가 있다 — send 의 기본(dotfiles:ignore)이면 404 가 된다.
    return res.sendFile(body.abs, { dotfiles: 'allow' }, (err) => {
      if (!err) return;
      if (err.code === 'ECONNABORTED' || err.code === 'EPIPE' || res.writableEnded) return;
      console.error(`[${tag}] sendFile error:`, err.message);
      if (!res.headersSent) res.status(err.status || 500).json({ success: false, message: 'stream_failed' });
      else res.destroy();
    });
  }
  if (Number.isFinite(body.size) && body.size >= 0) res.setHeader('Content-Length', String(body.size));
  return require('stream').pipeline(body.stream, res, (err) => {
    if (!err || err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
    console.error(`[${tag}] stream error:`, err.message);
    if (!res.headersSent) {
      res.removeHeader('Content-Length');
      res.status(502).json({ success: false, message: 'stream_failed' });
    }
  });
}

module.exports = { readAttachmentBody, sendAttachmentBody };
