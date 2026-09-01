const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { File, FileFolder, User, Client, Project, Business, BusinessStorageUsage, BusinessCloudToken,
  MessageAttachment, Message, Conversation, TaskAttachment, Task, PostAttachment, Post } = require('../models');
const { sequelize } = require('../config/database');
const gdrive = require('../services/gdrive');
const planEngine = require('../services/plan');
const { decodeOriginalName, buildContentDisposition } = require('../services/filename');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { attachWorkspaceScope, fileListWhereByLevel, canAccessFileByLevel, isMemberOrAbove, getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
// 영구 삭제는 services/filePurge.js 단일 착지점. cron(uploadCleanup)도 같은 함수를 부른다 —
//   두 벌로 두었더니 cron 이 휴지통을 영영 못 비우는 상태가 됐었다.
// ★ 상단에 둔다 — 아래쪽 const 는 TDZ 라 모듈 평가 중 참조하면 조용히 죽는다(프로젝트 전례).
const { purgeFile } = require('../services/filePurge');
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../services/displayName');
const { perUserLimiter, perUserDaily } = require('../middleware/costGuard');

// ─── #228 파일 드래그 아웃 — 5분 서명 URL ───
//
// OS 로 파일을 빼내는 유일한 웹 표준 경로는 dataTransfer 의 'DownloadURL' 인데, 브라우저가 그 URL 을
// **인증 헤더 없이** 따로 가져간다. 그래서 authenticateToken 다운로드 라우트로는 드래그가 불가능하다.
// 공유 링크(share_token)는 최소 7일 공개 + 컬럼을 덮어써 사용자의 진짜 공유 링크를 무효화하므로 부적합.
//
// 대신 **무상태 HMAC 서명 + 300초 수명** 을 쓴다. DB 쓰기 0. 서명은 파일 1개에 묶여서, URL 이 드롭
// 대상(악성 페이지·타 앱 로그)에 남아도 폭발 반경이 그 파일 하나로 닫힌다.
//
// 서명 키는 JWT_SECRET 에서 **도메인 분리 파생** 한다 — 운영 .env 에 키를 추가하지 않아 배포 시 env
// 누락 사고가 원천 차단되고, JWT 와 서명을 서로 대입할 수 없다.
const DRAG_TTL_SEC = 300;
const DRAG_SIGN_KEY = crypto.createHmac('sha256', String(process.env.JWT_SECRET || ''))
  .update('planq-file-drag-v1').digest();

function dragSig(businessId, fileId, userId, exp) {
  return crypto.createHmac('sha256', DRAG_SIGN_KEY)
    .update(`v1.${Number(businessId)}.${Number(fileId)}.${Number(userId)}.${Number(exp)}`)
    .digest('hex');
}

// ─── 영상·음성 인앱 재생 서명 URL ───
// `<video src>` 는 Authorization 헤더를 실을 수 없다. 그래서 재생만을 위한 서명 URL 을 발급한다.
// 드래그 아웃(#228)과 **같은 키 파생 방식**이되 도메인 문자열을 분리해 서로 대입되지 않게 한다.
//   · TTL 4시간 — 긴 녹화를 끝까지 재생하는 동안 Range 요청이 계속 나간다(5분이면 재생 중 끊긴다)
//   · MIME 을 video/* · audio/* 로 **하드 게이트** — HTML/SVG inline 은 XSS 벡터라 절대 못 태운다
//   · 상환 시 canDownloadFile 을 다시 통과해야 한다(발급 시점 권한을 신뢰하지 않는다)
const MEDIA_TTL_SEC = 4 * 60 * 60;
const MEDIA_SIGN_KEY = crypto.createHmac('sha256', String(process.env.JWT_SECRET || ''))
  .update('planq-file-media-v1').digest();

function mediaSig(businessId, fileId, userId, exp) {
  return crypto.createHmac('sha256', MEDIA_SIGN_KEY)
    .update(`v1.${Number(businessId)}.${Number(fileId)}.${Number(userId)}.${Number(exp)}`)
    .digest('hex');
}

/** 인앱 재생 가능한 MIME 인가 (video/audio 만) */
function isPlayableMedia(mime) {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('video/') || m.startsWith('audio/');
}

// 다운로드 권한 술어 — **단일 원천**. 인증 다운로드 / 드래그 발급 / 드래그 상환 세 곳이 같은 함수를 부른다.
//   같은 판정을 여러 벌로 복제하면 반드시 갈라진다(한 곳만 고쳐진 채 남는다).
async function canDownloadFile(scope, userId, file) {
  if (!file) return false;
  // Client: 자기 참여 프로젝트 파일 또는 본인 업로드만
  if (scope && scope.isClient) {
    const inMyProject = !!file.project_id && (scope.projectClientProjectIds || []).includes(file.project_id);
    return inMyProject || file.uploader_id === userId;
  }
  return await canAccessFileByLevel(userId, file, scope);
}

// s3 독립 서버 파일이면 presign(또는 public URL)로 redirect. 처리하면 true 반환 (운영 #29).
async function _s3Redirect(file, res) {
  if (file.storage_provider !== 's3' || !file.external_id) return false;
  const { WorkspaceStorageConfig } = require('../models');
  const cfg = await WorkspaceStorageConfig.findOne({ where: { business_id: file.business_id } });
  if (!cfg) { errorResponse(res, 's3_config_missing', 502); return true; }
  try {
    const url = cfg.public_base_url
      ? `${cfg.public_base_url.replace(/\/$/, '')}/${file.external_id}`
      : await require('../services/s3Storage').presignGet(cfg, file.external_id, 300);
    res.redirect(url); return true;
  } catch (e) { errorResponse(res, 's3_presign_failed', 502); return true; }
}

// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
// 파일 실시간 반영 — services/fileBroadcast.js 가 단일 원천 (다른 라우트도 같은 것을 쓴다, #378).
const { broadcastFile } = require('../services/fileBroadcast');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// 플랜별 쿼터는 services/plan.js + config/plans.js 에서 관리.
// 이 파일은 plan engine 경유로만 접근.

// ============================================
// 공유 링크 (사이클 N+4 — 통합 공유 시스템 Phase 2)
// 라우트 순서 우선이므로 기존 :businessId/:id 패턴 라우트보다 위에 정의.
// :id 가 숫자가 아니면 next() 로 다음 라우트에 양보 (e.g. /by-token/...).
// ============================================
router.post('/:id/share', authenticateToken, async (req, res, next) => {
  // :id 가 숫자가 아니면 다음 라우트로 넘김 (e.g. /api/files/by-token/...)
  if (!/^\d+$/.test(String(req.params.id))) return next();
  try {
    const file = await File.findByPk(req.params.id);
    if (!file || file.deleted_at) return errorResponse(res, 'file_not_found', 404);
    const scope = await getUserScope(req.user.id, file.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);

    const { applyShareUpdate } = require('../services/share_helper');
    const r = await applyShareUpdate(file, req.body || {});
    const url = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/files/${r.token}`;
    return successResponse(res, {
      share_token: r.token,
      share_url: url,
      shared_at: r.shared_at,
      share_expires_at: r.share_expires_at,
      password_set: r.password_set,
    });
  } catch (err) { next(err); }
});

router.delete('/:id/share', authenticateToken, async (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.id))) return next();
  try {
    const file = await File.findByPk(req.params.id);
    if (!file || file.deleted_at) return errorResponse(res, 'file_not_found', 404);
    const scope = await getUserScope(req.user.id, file.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    await file.update({
      share_token: null,
      shared_at: null,
      share_password_hash: null,
      share_expires_at: null,
    });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

router.get('/public/by-token/:token', async (req, res, next) => {
  try {
    // N+44 — share_expires_at WHERE 제거. 만료 토큰 410 + share_expired 통일 응답.
    const file = await File.findOne({
      where: { share_token: req.params.token, deleted_at: null },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'], required: false },
        { model: Business, attributes: ['id', 'name', 'brand_name'], required: false },
      ],
      attributes: ['id', 'file_name', 'mime_type', 'file_size', 'storage_provider',
        'shared_at', 'share_expires_at', 'share_password_hash', 'business_id', 'created_at'],
    });
    if (!file) return errorResponse(res, 'not_found', 404);
    const { verifySharePassword, checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(file, res)) return;
    const v = await verifySharePassword(file, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    const payload = {
      id: file.id,
      file_name: file.file_name,
      mime_type: file.mime_type,
      file_size: Number(file.file_size),
      storage_provider: file.storage_provider,
      uploader: file.uploader ? { id: file.uploader.id, name: file.uploader.name } : null,
      workspace: file.Business ? { id: file.Business.id, name: file.Business.brand_name || file.Business.name } : null,
      shared_at: file.shared_at,
      created_at: file.created_at,
    };
    await applyMemberDisplayNameOne(payload, file.business_id, ['uploader']);
    return successResponse(res, payload);
  } catch (err) { next(err); }
});

router.get('/public/by-token/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    // N+44 — 410 통일
    const file = await File.findOne({ where: { share_token: req.params.token, deleted_at: null } });
    if (!file) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(file, res)) return;
    const scope = await getUserScope(req.user.id, file.business_id, req.user.platform_role);
    const canAccess = isMemberOrAbove(scope);
    return successResponse(res, {
      canAccess,
      // SPA 라우트는 복수형 `/files` — 단수 `/file` 은 라우트가 없어 대시보드로 튕겼다
      appUrl: canAccess ? `/files?file=${file.id}` : null,
    });
  } catch (err) { next(err); }
});

router.get('/public/by-token/:token/download', async (req, res, next) => {
  try {
    // N+44 — 410 통일
    const file = await File.findOne({ where: { share_token: req.params.token, deleted_at: null } });
    if (!file) return errorResponse(res, 'not_found', 404);
    const { verifySharePassword, checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(file, res)) return;
    const v = await verifySharePassword(file, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    if (await _s3Redirect(file, res)) return;
    if (file.storage_provider !== 'planq') {
      if (file.external_url) return res.redirect(file.external_url);
      return errorResponse(res, 'external_file_no_url', 400);
    }
    if (!fs.existsSync(file.file_path)) return errorResponse(res, 'file_missing_on_disk', 410);
    const inline = String(req.query.inline || '') === '1';
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    fs.createReadStream(file.file_path).pipe(res);
  } catch (err) { next(err); }
});

// ─── 공개 다운로드 (인증 없음) ───
// ─── Public image (이미지 썸네일/미리보기 — <img src> 호환) ───
//   인증 헤더 못 실리는 <img> 태그용. UUID stored_name + image MIME 게이트로만 노출.
//   파일이 비-이미지면 403. 워크스페이스 파일이라도 이미지 콘텐츠는 image MIME 으로 한정.
router.get('/public-image/:storedName', async (req, res, next) => {
  try {
    const stored = String(req.params.storedName || '');
    // ★ 두 종류의 토큰을 받는다 (둘 다 추측 불가능한 값이라는 전제는 동일):
    //     · 로컬 저장분 — UUID 파일명 `xxxxxxxx-....png`
    //     · Drive 저장분 — Drive 파일 ID (점이 없다). file_path 에는 로컬 경로가 아니라 이 ID 가 들어 있다.
    //   여태 `storage_provider: 'planq'` 를 하드코딩해서 **Drive 이미지는 어느 화면에서도 미리보기가 없었다**
    //   (운영 실측 33건). task 첨부(#134)는 이미 readAttachmentBody 로 같은 문제를 고쳐 뒀다 — 그 계약을 따른다.
    const looksLocal = /^[a-z0-9-]+\.[a-z0-9]+$/i.test(stored);
    const looksDriveId = /^[A-Za-z0-9_-]{10,200}$/.test(stored);
    if (!looksLocal && !looksDriveId) return errorResponse(res, 'invalid_filename', 400);

    const file = looksLocal
      ? await File.findOne({ where: { file_path: { [Op.like]: `%${stored}` }, deleted_at: null, storage_provider: 'planq' } })
        // ★ LIKE 는 **접미사** 매칭이라 `e.png`·`8.png` 같은 짧은 값으로도 아무 이미지가 걸린다 —
        //   토큰을 몰라도 **타 워크스페이스 이미지가 무인증으로 열렸다**(2026-08-20 Fable 실측 200 반환).
        //   추측 불가능성이 이 경로의 유일한 방벽이므로, 파일명 전체와 정확히 같을 때만 인정한다.
        //   (message_attachments 의 같은 결함은 이미 같은 방식으로 막았다 — 규칙을 갈라 두지 말 것.)
        .then((row) => (row && require('path').basename(row.file_path) === stored ? row : null))
      : await File.findOne({ where: { external_id: stored, deleted_at: null, storage_provider: 'gdrive' } });
    if (!file) return errorResponse(res, 'not_found', 404);
    // image/* 만 — HTML/JS 를 inline 으로 흘리면 XSS 가 된다 (기존 계약 유지)
    if (!require('../services/filePreview').isRenderableImage(file.mime_type)) {
      return errorResponse(res, 'not_public_image', 403);
    }

    // 저장소 단일 원천 — 로컬이면 로컬, Drive 면 서버가 워크스페이스 토큰으로 받아서 흘려준다.
    const body = await require('../services/attachmentStorage').readAttachmentBody(file);
    if (!body.ok) return errorResponse(res, body.msg, body.code);
    if (body.redirect) return res.redirect(body.redirect);
    // ?w= 리사이즈는 로컬 파일일 때만 (Drive 스트림은 원본 그대로) — task 첨부와 같은 규칙
    if (body.abs && await require('../services/imageResize').maybeServeResized(req, res, body.abs, file.mime_type)) return;

    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    body.stream.on('error', (e) => {
      console.error('[files] public image stream error:', e.message);
      if (!res.headersSent) errorResponse(res, 'stream_failed', 502);
      else res.destroy();
    });
    body.stream.pipe(res);
  } catch (err) { next(err); }
});

// GET /api/files/public/:token/download
// ⚠️ 라우트 순서 중요: /:businessId/:id/download 보다 앞에 와야 path 매치 우선됨.
router.get('/public/:token/download', async (req, res, next) => {
  try {
    const file = await File.findOne({ where: { share_token: req.params.token, deleted_at: null } });
    if (!file) return errorResponse(res, 'invalid_token', 404);
    if (file.share_expires_at && new Date(file.share_expires_at) < new Date()) {
      return errorResponse(res, 'link_expired', 410);
    }
    if (await _s3Redirect(file, res)) return;
    if (file.storage_provider !== 'planq') {
      if (file.external_url) return res.redirect(file.external_url);
      return errorResponse(res, 'external_file_no_url', 400);
    }
    if (!fs.existsSync(file.file_path)) return errorResponse(res, 'physical_file_missing', 410);
    res.setHeader('Content-Disposition', buildContentDisposition(file.file_name));
    if (file.mime_type) res.setHeader('Content-Type', file.mime_type);
    return res.sendFile(path.resolve(file.file_path));
  } catch (err) { next(err); }
});

// GET /api/files/drag/:businessId/:id?u=&exp=&sig=   (#228 드래그 아웃 상환 — **무인증 공개**)
// ⚠️ 라우트 순서: 첫 세그먼트가 리터럴 'drag' 라 /:businessId/:id/download 와 충돌하지 않지만,
//    공개 라우트는 이 블록에 모아 둔다 (인증 라우트 사이에 흩어지면 다음 사람이 못 본다).
//
// 서명만으로 통과시키지 않는다 — **상환 시점에 권한을 다시 본다**. 발급 후 5분 안에 권한이 회수되거나
// 파일이 삭제되면 그 즉시 막힌다(fail-closed). 서명은 "누가 요청했는지" 만 증명한다.
router.get('/drag/:businessId/:id', perUserLimiter('file-drag-redeem', { windowMs: 60 * 1000, max: 60 }), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const fileId = Number(req.params.id);
    const userId = Number(req.query.u);
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || '');
    // 형식 가드 — timingSafeEqual 은 길이가 다르면 throw 한다(500 크래시 경로).
    if (!/^[a-f0-9]{64}$/.test(sig)) return errorResponse(res, 'invalid_signature', 403);
    if (!Number.isInteger(businessId) || !Number.isInteger(fileId) || !Number.isInteger(userId) || !Number.isInteger(exp)) {
      return errorResponse(res, 'invalid_signature', 403);
    }
    const expected = dragSig(businessId, fileId, userId, exp);
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
      return errorResponse(res, 'invalid_signature', 403);
    }
    if (exp * 1000 < Date.now()) return errorResponse(res, 'link_expired', 410);

    const file = await File.findOne({
      where: { id: fileId, business_id: businessId, deleted_at: null, storage_provider: 'planq' },
    });
    if (!file) return errorResponse(res, 'file_not_found', 404);
    // 외부 노출 게이트 — 공유 링크와 같은 술어 (일반 등급만 무인증 URL 발급 대상)
    if (file.security_level && file.security_level !== 'general') {
      return errorResponse(res, 'security_level_blocks_drag', 403, 'security_level_blocks_drag');
    }
    // users 에 is_active 같은 컬럼은 없다 — 계정 상태는 status ENUM('active','suspended','deleted').
    //   없는 컬럼으로 가드를 쓰면 undefined 라 항상 통과해서, 가드가 있는 것처럼 보이지만 죽어 있다.
    const user = await User.findByPk(userId);
    if (!user || user.status !== 'active') return errorResponse(res, 'forbidden', 403);
    const scope = await getUserScope(userId, businessId, user.platform_role);
    if (!(await canDownloadFile(scope, userId, file))) return errorResponse(res, 'forbidden', 403);

    if (!fs.existsSync(file.file_path)) return errorResponse(res, 'physical_file_missing', 410);
    // 무인증 URL 이므로 inline 렌더는 절대 허용하지 않는다 (HTML/SVG inline = XSS 벡터).
    res.setHeader('Content-Disposition', buildContentDisposition(file.file_name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.mime_type) res.setHeader('Content-Type', file.mime_type);
    return res.sendFile(path.resolve(file.file_path));
  } catch (err) { next(err); }
});

// ─── 영상·음성 재생 (서명 URL 상환 — **무인증 공개**, MIME 하드 게이트) ───
// GET /api/files/media/:businessId/:id?u=&exp=&sig=
// res.sendFile 이 Range 를 처리한다(Accept-Ranges: bytes) → 탐색·부분 재생이 그대로 된다.
router.get('/media/:businessId/:id',
  perUserLimiter('file-media', { windowMs: 60 * 1000, max: 600 }), async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const fileId = Number(req.params.id);
      const userId = Number(req.query.u);
      const exp = Number(req.query.exp);
      const sig = String(req.query.sig || '');
      // 형식 가드 — timingSafeEqual 은 길이가 다르면 throw 한다(500 크래시 경로).
      if (!/^[a-f0-9]{64}$/.test(sig)) return errorResponse(res, 'invalid_signature', 403);
      if (!Number.isInteger(businessId) || !Number.isInteger(fileId) || !Number.isInteger(userId) || !Number.isInteger(exp)) {
        return errorResponse(res, 'invalid_signature', 403);
      }
      const expected = mediaSig(businessId, fileId, userId, exp);
      if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) {
        return errorResponse(res, 'invalid_signature', 403);
      }
      if (exp * 1000 < Date.now()) return errorResponse(res, 'link_expired', 410);

      const file = await File.findOne({
        where: { id: fileId, business_id: businessId, deleted_at: null, storage_provider: 'planq' },
      });
      if (!file) return errorResponse(res, 'file_not_found', 404);
      // ★ MIME 게이트 — 서명이 유효해도 영상·음성이 아니면 절대 inline 으로 흘리지 않는다.
      if (!isPlayableMedia(file.mime_type)) return errorResponse(res, 'not_playable_media', 403);
      // 외부 노출 게이트 — 드래그 아웃과 **같은 술어**. 무인증 URL 을 발급하는 경로는 규칙이 하나여야
      //   한다(둘로 갈라두면 한쪽만 고쳐진 채 남는다). 기밀·내부 등급 영상은 미리보기 대신 다운로드로.
      if (file.security_level && file.security_level !== 'general') {
        return errorResponse(res, 'security_level_blocks_media', 403, 'security_level_blocks_media');
      }
      const user = await User.findByPk(userId);
      if (!user || user.status !== 'active') return errorResponse(res, 'forbidden', 403);
      const scope = await getUserScope(userId, businessId, user.platform_role);
      if (!(await canDownloadFile(scope, userId, file))) return errorResponse(res, 'forbidden', 403);

      if (!fs.existsSync(file.file_path)) return errorResponse(res, 'physical_file_missing', 410);
      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.sendFile(path.resolve(file.file_path));
    } catch (err) { next(err); }
  });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadDir, String(req.params.businessId), new Date().toISOString().slice(0, 7));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

// Drive 연동 시 영상 업로드 위해 5GB. 자체 스토리지/플랜 한도 검증은 라우트 핸들러에서.
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }
});

// ─── 헬퍼 ───

async function getOrCreateUsage(businessId, transaction) {
  const [usage] = await BusinessStorageUsage.findOrCreate({
    where: { business_id: businessId },
    defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
    transaction
  });
  return usage;
}

async function getPlanQuota(businessId) {
  return await planEngine.getLimit(businessId, 'storage_bytes');
}

// 해시는 utils/fileHash 단일 원천 (posts editor-image · gdrive 인제스트와 같은 규칙).
const { sha256OfFile } = require('../utils/fileHash');

async function verifyProjectOwnership(projectId, businessId) {
  if (!projectId) return true;
  const project = await Project.findOne({ where: { id: projectId, business_id: businessId } });
  return !!project;
}

async function verifyFolderOwnership(folderId, businessId, projectId) {
  if (!folderId) return true;
  const folder = await FileFolder.findOne({
    where: { id: folderId, business_id: businessId, ...(projectId ? { project_id: projectId } : {}) }
  });
  return !!folder;
}

// ─── List ───

router.get('/:businessId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    // 사이클 N+9: 옵션 A — visibility 단계별 (L1 본인만 / L2 프로젝트 멤버 / L3 워크스페이스)
    const baseWhere = fileListWhereByLevel(req.scope);
    const where = { ...baseWhere, deleted_at: null };
    if (req.query.client_id) where.client_id = req.query.client_id;
    if (req.query.project_id) where.project_id = req.query.project_id;
    if (req.query.folder_id) where.folder_id = req.query.folder_id;
    if (req.query.folder_id === 'null') where.folder_id = null;
    // 사이클 N+58 — ?ids=1,2,3 batch meta fetch (ChatPanel chip meta 등)
    // visibility WHERE 그대로 적용 — 접근 권한 없는 id 는 자동 필터.
    if (req.query.ids) {
      const idsArr = String(req.query.ids).split(',').map(Number).filter(n => Number.isFinite(n) && n > 0).slice(0, 100);
      if (idsArr.length > 0) where.id = idsArr;
    }

    // 사이클 N+50 — pagination. include 가 1:1 (uploader/client) 라 distinct 안전.
    // files 는 누적 빠름 — default 500 / max 1000. frontend 가 ?page= 점진 opt-in
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 500, maxLimit: 1000 });
    const { rows, count } = await File.findAndCountAll({
      where,
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'] },
        { model: Client, attributes: ['id', 'display_name'] }
      ],
      order: [['created_at', 'DESC']],
      limit, offset,
      distinct: true,
    });
    const items = rows.map(r => r.toJSON());
    await applyMemberDisplayName(items, req.params.businessId, ['uploader']);
    return paginatedResponse(res, items, count, { limit, page, offset });
  } catch (error) {
    next(error);
  }
});

// ─── Storage status (쿼터) ───

router.get('/:businessId/storage', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const usage = await getOrCreateUsage(req.params.businessId);
    const { plan } = await planEngine.getBusinessPlan(req.params.businessId);
    const quota = plan.limits.storage_bytes;
    successResponse(res, {
      provider: usage.storage_provider,
      bytes_used: Number(usage.bytes_used),
      bytes_quota: quota === Infinity ? null : quota,
      file_count: usage.file_count,
      plan: plan.code
    });
  } catch (error) {
    next(error);
  }
});

// ─── Upload (쿼터 + SHA-256 dedup) ───

// 업로드 rate-limit — 옛 app.use('/api/files', 10/분·IP) 를 여기로 이관 (#228).
//   서브트리 마운트는 조회·다운로드까지 같이 막았고 IP 버킷이라 NAT 을 한 통에 담았다.
//   30/분은 드롭존 다중 파일 일괄 업로드를 통과시키는 값. 실비용(디스크) 가드는 이 핸들러 안의
//   플랜 스토리지 쿼터 검사가 계속 담당한다 — 리미터는 해머링 방지 역할만 한다.
router.post('/:businessId', authenticateToken, ...perUserDaily('file-upload', { perMin: 30, perDay: 1500 }),
  checkBusinessAccess, upload.single('file'), async (req, res, next) => {
  let tempPath = req.file && req.file.path;
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);
    if (req.businessRole === 'client') {
      if (tempPath) try { fs.unlinkSync(tempPath); } catch { /* */ }
      return errorResponse(res, 'Clients cannot upload files to the workspace library. Use chat attachments instead.', 403);
    }

    const businessId = Number(req.params.businessId);
    const projectId = req.body.project_id ? Number(req.body.project_id) : null;
    const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;
    // 채팅/대화에서 올라온 첨부 — project_id 없어도 Drive 의 "Conversations" 폴더로 라우팅 가능
    const conversationId = req.body.conversation_id ? Number(req.body.conversation_id) : null;

    // 소유권 검증
    if (projectId && !(await verifyProjectOwnership(projectId, businessId))) {
      fs.unlinkSync(tempPath);
      return errorResponse(res, 'Invalid project_id', 400);
    }
    if (folderId && !(await verifyFolderOwnership(folderId, businessId, projectId))) {
      fs.unlinkSync(tempPath);
      return errorResponse(res, 'Invalid folder_id', 400);
    }

    // 외부 클라우드 연동 확인 → 있으면 Google Drive 로 업로드 (자체 쿼터/사이즈 한도 모두 skip)
    // 채팅 첨부 (conversationId) 도 Drive 로 라우팅 — 영상 같은 큰 파일이 자체 스토리지 쿼터를 잠식하지 않도록.
    const cloudToken = await BusinessCloudToken.findOne({
      where: { business_id: businessId, provider: 'gdrive' }
    });
    const useGdrive = !!cloudToken && !!cloudToken.root_folder_id && (projectId || conversationId);

    // S3 독립 서버 (운영 #29) — gdrive 미사용 + 워크스페이스 default 가 s3 + 검증된 설정.
    let s3cfg = null;
    if (!useGdrive) {
      const biz = await Business.findByPk(businessId, { attributes: ['default_storage_provider'] });
      if (biz && biz.default_storage_provider === 's3') {
        const { WorkspaceStorageConfig } = require('../models');
        const c = await WorkspaceStorageConfig.findOne({ where: { business_id: businessId } });
        if (c && c.is_active && c.verified_at) s3cfg = c; // 미검증이면 자체 스토리지로 폴백
      }
    }
    const useS3 = !!s3cfg;

    // plan engine 통합 체크 — 파일 크기 + 스토리지 쿼터 (외부 사용 시 쿼터 skip)
    // race condition 방지: 실제 usage 증가 트랜잭션은 아래에서 SELECT FOR UPDATE 로 원자화.
    // 여기서의 체크는 1차 early return (UX 개선). 최종 게이트는 트랜잭션 내 재검증.
    const canUpload = await planEngine.can(businessId, 'upload_file', {
      size: req.file.size,
      external: useGdrive || useS3,
    });
    if (!canUpload.ok) {
      fs.unlinkSync(tempPath);
      return res.status(canUpload.reason === 'file_size_exceeded' || canUpload.reason === 'storage_quota_exceeded' ? 413 : 403)
        .json(planEngine.buildQuotaError(canUpload, businessId));
    }

    // === S3 독립 서버 경로 (운영 #29) ===
    if (useS3) {
      try {
        const s3svc = require('../services/s3Storage');
        const ext = require('path').extname(req.file.originalname) || '';
        const key = s3svc.buildKey(s3cfg, businessId, ext);
        const buffer = fs.readFileSync(tempPath);
        await s3svc.putObject(s3cfg, key, buffer, req.file.mimetype);
        const file = await File.create({
          business_id: businessId,
          project_id: projectId,
          folder_id: folderId,
          client_id: req.body.client_id || null,
          uploader_id: req.user.id,
          file_name: decodeOriginalName(req.file.originalname),
          file_path: key,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          description: req.body.description || null,
          storage_provider: 's3',
          external_id: key,
          external_url: null,  // private 버킷 — 다운로드 시 presign
          visibility: projectId ? 'L2' : 'L1',
          vlevel: projectId ? 'L2' : 'L1',   // ★ 권위 컬럼 동시 기록 (미기록 시 default L3 노출)
        });
        fs.unlinkSync(tempPath);
        tempPath = null;
        broadcastFile(req, file, 'file:new');
        return successResponse(res, file, 'File uploaded to S3', 201);
      } catch (e) {
        console.error('[files] s3 upload failed:', e.message);
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return errorResponse(res, 'S3 업로드 실패: ' + e.message, 502);
      }
    }

    // === Drive 경로 ===
    if (useGdrive) {
      try {
        const drive = await gdrive.getDriveClient(cloudToken);
        // 부모 폴더 결정 — 프로젝트면 프로젝트 폴더, 채팅이면 "Conversations" 공통 폴더
        let parentFolderId;
        if (projectId) {
          const project = await Project.findByPk(projectId);
          parentFolderId = await gdrive.ensureProjectFolder(drive, cloudToken, project);
        } else {
          parentFolderId = await gdrive.ensureConversationsFolder(drive, cloudToken);
        }
        // 파일 업로드 (stream)
        const driveFile = await gdrive.uploadFile(drive, {
          name: decodeOriginalName(req.file.originalname),
          mimeType: req.file.mimetype,
          body: fs.createReadStream(tempPath),
          parentId: parentFolderId
        });
        // DB 에 메타 저장
        const file = await File.create({
          business_id: businessId,
          project_id: projectId,
          folder_id: folderId,
          client_id: req.body.client_id || null,
          uploader_id: req.user.id,
          file_name: decodeOriginalName(req.file.originalname),
          file_path: driveFile.id,  // gdrive 는 file_path 필드를 external_id 로 활용
          file_size: Number(driveFile.size || req.file.size),
          mime_type: req.file.mimetype,
          description: req.body.description || null,
          storage_provider: 'gdrive',
          external_id: driveFile.id,
          external_url: driveFile.webViewLink,
          visibility: projectId ? 'L2' : 'L1',  // VISIBILITY_VOCABULARY.md §2 — 프로젝트=팀 / 미연결=개인 default
          // ★ vlevel 이 권위 컬럼 — 같이 안 쓰면 모델 default 'L3' 로 저장돼 개인 파일이 전 멤버에게 노출된다
          vlevel: projectId ? 'L2' : 'L1',
        });
        // 로컬 임시 파일 제거
        fs.unlinkSync(tempPath);
        tempPath = null;
        broadcastFile(req, file, 'file:new');
        gdrive.clearTokenError(cloudToken);
        return successResponse(res, file, 'File uploaded to Drive', 201);
      } catch (e) {
        console.error('[files] gdrive upload failed:', e.message);
        gdrive.recordTokenError(cloudToken, e);
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return errorResponse(res, 'Google Drive upload failed: ' + e.message, 502);
      }
    }

    // === 자체 스토리지 경로 ===
    // SHA-256 dedup (트랜잭션 외부에서 해시 계산만)
    const hash = await sha256OfFile(tempPath);

    const t = await sequelize.transaction();
    try {
      // race condition 방지: usage 행 FOR UPDATE lock 으로 직렬화
      await BusinessStorageUsage.findOrCreate({
        where: { business_id: businessId },
        defaults: { business_id: businessId, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
        transaction: t
      });
      const usage = await BusinessStorageUsage.findOne({
        where: { business_id: businessId },
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      // 트랜잭션 내 재검증 — 플랜 쿼터 (early check 이후에도 다른 동시 요청 고려)
      const limit = await planEngine.getLimit(businessId, 'storage_bytes');
      if (limit !== Infinity && Number(usage.bytes_used) + req.file.size > limit) {
        await t.rollback();
        fs.unlinkSync(tempPath);
        return res.status(413).json(planEngine.buildQuotaError(
          { reason: 'storage_quota_exceeded', limit, current: Number(usage.bytes_used) },
          businessId
        ));
      }

      const existing = await File.findOne({
        where: { business_id: businessId, content_hash: hash, deleted_at: null },
        transaction: t
      });

      let file;
      if (existing) {
        // dedup hit — 물리 파일 제거 + 참조 증가
        fs.unlinkSync(tempPath);
        tempPath = null;
        await existing.increment('ref_count', { transaction: t });
        // 같은 파일을 다른 프로젝트/폴더에 올리는 경우 — 별도 레코드로 추가 (같은 file_path 공유)
        if (existing.project_id !== projectId || existing.folder_id !== folderId) {
          file = await File.create({
            business_id: businessId,
            project_id: projectId,
            folder_id: folderId,
            client_id: req.body.client_id || null,
            uploader_id: req.user.id,
            file_name: decodeOriginalName(req.file.originalname),
            file_path: existing.file_path,
            file_size: existing.file_size,
            mime_type: existing.mime_type,
            description: req.body.description || null,
            storage_provider: 'planq',
            content_hash: hash,
            ref_count: 1,
            visibility: projectId ? 'L2' : 'L1',
            vlevel: projectId ? 'L2' : 'L1',   // ★ 권위 컬럼 동시 기록 (미기록 시 default L3 노출)
          }, { transaction: t });
        } else {
          file = existing;
        }
      } else {
        file = await File.create({
          business_id: businessId,
          project_id: projectId,
          folder_id: folderId,
          client_id: req.body.client_id || null,
          uploader_id: req.user.id,
          file_name: decodeOriginalName(req.file.originalname),
          file_path: req.file.path,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          description: req.body.description || null,
          storage_provider: 'planq',
          content_hash: hash,
          ref_count: 1,
          visibility: projectId ? 'L2' : 'L1',
          vlevel: projectId ? 'L2' : 'L1',   // ★ 권위 컬럼 동시 기록 (미기록 시 default L3 노출)
        }, { transaction: t });
        // 쿼터 업데이트 (dedup 히트면 증가 없음)
        usage.bytes_used = Number(usage.bytes_used) + req.file.size;
        usage.file_count += 1;
        await usage.save({ transaction: t });
      }
      await t.commit();
      planEngine.invalidateBusinessCache(businessId);
      tempPath = null;
      // 응답: 이미지면 RichEditor 호환 preview_url 같이 노출 (TipTap 이미지 인라인 삽입용).
      const isImage = file.mime_type && file.mime_type.startsWith('image/');
      const previewUrl = require('../services/filePreview').previewUrlForFile(file) || null;
      broadcastFile(req, file, 'file:new');
      // GDrive 미러 — 워크스페이스 연결 시 로컬 저장 파일을 Drive 사본으로 (best-effort, 응답 블로킹 X).
      //   storage_provider 는 planq 유지 → 서빙 무영향. 실패해도 파일은 로컬에 안전. L1 개인은 owner 본인만.
      setImmediate(() => require('../services/gdriveMirror').mirrorOnUpload(file.id, businessId));
      // 사이클 N+51 — audit. 파일 업로드 (스토리지 mutation + visibility 결정)
      require('../services/auditService').logAudit(req, {
        action: 'file.upload',
        targetType: 'file',
        targetId: file.id,
        businessId,
        newValue: {
          file_name: file.file_name,
          file_size: Number(file.file_size),
          mime_type: file.mime_type,
          project_id: file.project_id,
          visibility: file.visibility,
          storage_provider: file.storage_provider,
        },
      });
      successResponse(res, { ...file.toJSON(), preview_url: previewUrl }, 'File uploaded', 201);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (error) {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    next(error);
  }
});

// ─── 파일 변경 권한 체크 ───
// 본인 업로드 또는 owner/platform_admin 또는 해당 프로젝트 PM → true
// PERMISSION_MATRIX.md §5.3 — "파일 삭제: 본인 업로드 + owner + PM만"
async function canMutateFile(file, req) {
  if (req.user.platform_role === 'platform_admin') return true;
  if (req.businessRole === 'owner') return true;
  if (file.uploader_id === req.user.id) return true;
  if (file.project_id) {
    try {
      const { ProjectMember } = require('../models');
      const pm = await ProjectMember.findOne({
        where: { project_id: file.project_id, user_id: req.user.id, is_pm: true },
        attributes: ['id'],
      });
      if (pm) return true;
    } catch { /* is_pm 컬럼 없음 (Phase 0 이전) → PM 체크 skip */ }
  }
  return false;
}

// ─── Move (폴더 이동) ───

router.post('/:businessId/:id/move', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) {
      return errorResponse(res, '본인 업로드 · 오너 · 프로젝트 PM 만 이동할 수 있습니다', 403);
    }

    const folderId = req.body.folder_id ? Number(req.body.folder_id) : null;
    if (folderId && !(await verifyFolderOwnership(folderId, file.business_id, file.project_id))) {
      return errorResponse(res, 'Invalid folder_id', 400);
    }
    file.folder_id = folderId;
    await file.save();
    // Drive 사본도 같은 자리로 (Irene 2026-08-31). PlanQ 에서 정리했는데 Drive 가 그대로면
    //   두 곳이 갈라진다. 미러된 파일에만 해당하고, 실패해도 이동 자체는 되돌리지 않는다
    //   (PlanQ 가 정본, Drive 는 사본).
    if (file.gdrive_mirror_id) {
      setImmediate(async () => {
        try {
          const gdrive = require('../services/gdrive');
          const mirror = require('../services/gdriveMirror');
          const token = await gdrive.getTokenForBusiness(file.business_id);
          if (!token || !token.root_folder_id) return;
          const drive = await gdrive.getDriveClient(token);
          let parentId = await mirror.ensureWorkspaceFilesFolder(drive, token);
          if (folderId) parentId = await mirror.ensureFolderChainOnDrive(drive, token, folderId, parentId);
          await gdrive.moveFile(drive, file.gdrive_mirror_id, parentId);
        } catch (e) { console.warn('[file move] Drive 반영 실패:', e.message); }
      });
    }
    broadcastFile(req, file, 'file:updated');
    successResponse(res, file, 'File moved');
  } catch (error) {
    next(error);
  }
});

// ─── Visibility 변경 (사이클 N+9) ───
// PUT /api/files/:businessId/:id/visibility  body: { level: 'L1'|'L2'|'L3'|'L4', project_id?, target_member_ids?, target_client_ids? }
// L2-project: project_id 필수. L4: 외부 share — share_token 미사용 시 발급 별도 share 라우트.
// N+67 — L4 까지 통일. owner/admin 또는 uploader 본인만 변경 가능.
router.put('/:businessId/:id/visibility', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const { level, project_id, target_member_ids } = req.body || {};
    if (!['L1', 'L2', 'L3', 'L4'].includes(level)) return errorResponse(res, 'invalid_level', 400);
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'file_not_found', 404);
    // 권한: workspace owner/admin 또는 uploader 본인
    const isOwner = req.scope.isOwner || req.scope.isPlatformAdmin || req.businessRole === 'admin';
    const isUploader = file.uploader_id === req.user.id;
    if (!isOwner && !isUploader) return errorResponse(res, 'forbidden', 403);
    // N+74 — L2 = project_id 또는 target_member_ids 둘 중 하나 필수
    let nextProjectId = file.project_id;
    let nextTargetMemberIds = null;
    if (level === 'L2') {
      if (project_id) {
        nextProjectId = Number(project_id);
      } else if (Array.isArray(target_member_ids) && target_member_ids.length > 0) {
        // L2-members 분기 — project_id 없이 명시 멤버 리스트
        nextProjectId = null;
        nextTargetMemberIds = target_member_ids.map(Number).filter(n => Number.isFinite(n));
        if (nextTargetMemberIds.length === 0) return errorResponse(res, 'invalid_target_member_ids', 400);
      } else {
        // ★ "청중 없는 L2" 를 허용한다 (#378). 문서(posts)는 이미 이 상태로 저장되고,
        //   그 경우 문서 술어는 **워크스페이스 전체**로 본다 — 파일만 막으면 문서에 첨부를
        //   붙일 때마다 400 이 나서 첨부가 L1 로 남고, 문서는 보이는데 첨부만 안 열린다.
        //   (이 400 때문에 #378 결손이 계속 재축적되고 있었다 — Fable 실측)
        nextProjectId = null;
        nextTargetMemberIds = null;
      }
    } else {
      // L1/L3/L4 — project_id, target_member_ids 모두 null
      nextProjectId = null;
      nextTargetMemberIds = null;
    }
    const prevVisibility = file.visibility;
    const prevVlevel = file.vlevel;
    const prevProjectId = file.project_id;
    const prevTargetIds = file.target_member_ids;
    // N+74 — vlevel + visibility 둘 다 갱신 (legacy 정합) + target_member_ids
    await file.update({
      vlevel: level,
      visibility: level,
      project_id: nextProjectId,
      target_member_ids: nextTargetMemberIds,
    });
    broadcastFile(req, file, 'file:updated');
    require('../services/auditService').logAudit(req, {
      action: 'file.visibility_change',
      targetType: 'file',
      targetId: file.id,
      oldValue: { vlevel: prevVlevel, visibility: prevVisibility, project_id: prevProjectId, target_member_ids: prevTargetIds },
      newValue: { vlevel: level, visibility: level, project_id: nextProjectId, target_member_ids: nextTargetMemberIds },
    });
    successResponse(res, { id: file.id, vlevel: level, visibility: level, project_id: nextProjectId, target_member_ids: nextTargetMemberIds });
  } catch (err) { next(err); }
});

// ─── D4 #62 — 보안등급 변경 ───
// PUT /api/files/:businessId/:id/security-level  body: { level: 'general'|'internal'|'confidential' }
//   권한: uploader 본인 또는 owner/admin (visibility 변경과 동일 = 작성자+관리자).
//   일반 외로 올리면 기존 외부 공유 링크 무효화(보안). 내림은 그대로.
router.put('/:businessId/:id/security-level', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const level = String(req.body?.level || '');
    if (!['general', 'internal', 'confidential'].includes(level)) return errorResponse(res, 'invalid_level', 400);
    const file = await File.findOne({ where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null } });
    if (!file) return errorResponse(res, 'file_not_found', 404);
    const isOwner = req.scope.isOwner || req.scope.isPlatformAdmin || req.businessRole === 'admin';
    const isUploader = file.uploader_id === req.user.id;
    if (!isOwner && !isUploader) return errorResponse(res, 'forbidden', 403);
    const prev = file.security_level;
    const patch = { security_level: level };
    // 일반 외로 상향 시 기존 외부 공유 링크 즉시 무효화
    let revokedShare = false;
    if (level !== 'general' && file.share_token) { patch.share_token = null; patch.share_expires_at = null; revokedShare = true; }
    await file.update(patch);
    broadcastFile(req, file, 'file:updated');
    require('../services/auditService').logAudit(req, {
      action: 'file.security_level_change', targetType: 'file', targetId: file.id, businessId: file.business_id,
      oldValue: { security_level: prev }, newValue: { security_level: level, revoked_share: revokedShare },
    });
    return successResponse(res, { id: file.id, security_level: level, revoked_share: revokedShare });
  } catch (err) { next(err); }
});

// ─── Delete (soft) ───

// ─── 파일 메타 편집 (이름 · 설명 · 태그) ───
// PATCH /api/files/:businessId/:id  body: { file_name?, description?, tags? }
// 권한은 삭제와 **같은 술어**(canMutateFile) — 본인 업로드 · 오너 · 프로젝트 PM.
//   파일명은 검색의 1차 열쇠라 잘못 올라온 이름을 고칠 수 없으면 자료를 영영 못 찾는다.
//   확장자는 바꾸지 못하게 한다 — 열리는 프로그램이 달라져 사용자에게는 파일이 깨진 것으로 보인다.
router.patch('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null },
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) return errorResponse(res, 'forbidden', 403);

    const patch = {};
    const before = { file_name: file.file_name, description: file.description, tags: file.tags };

    if (req.body.file_name !== undefined) {
      let name = String(req.body.file_name || '').trim();
      // 경로 구분자·제어문자 제거 — 저장 경로와 무관한 표시용 이름이지만 헤더·ZIP 에 실린다.
      name = name.replace(/[/\\\r\n\t\0]/g, '').replace(/^[.\s]+/, '').slice(0, 255).trim();
      if (!name) return errorResponse(res, 'file_name_required', 400, 'file_name_required');
      const oldExt = path.extname(file.file_name || '').toLowerCase();
      const newExt = path.extname(name).toLowerCase();
      // 확장자를 빼먹고 저장했으면 원래 확장자를 되붙인다(사용자가 지우기 쉬운 부분이다).
      if (oldExt && newExt !== oldExt) name = name.replace(/\.[^.]*$/, '') + oldExt;
      patch.file_name = name;
    }
    if (req.body.description !== undefined) {
      patch.description = String(req.body.description || '').slice(0, 500) || null;
    }
    if (req.body.tags !== undefined) {
      const raw = Array.isArray(req.body.tags) ? req.body.tags : [];
      const seen = new Set();
      const tags = [];
      for (const x of raw) {
        // 문자열·숫자만 — 객체/배열이 오면 String() 이 "[object Object]" 를 만들어 저장된다.
        if (typeof x !== 'string' && typeof x !== 'number') continue;
        const v = String(x).trim().replace(/\s+/g, ' ').slice(0, 40);
        const k = v.toLowerCase();
        if (!v || seen.has(k)) continue;
        seen.add(k); tags.push(v);
        if (tags.length >= 20) break;
      }
      patch.tags = tags.length ? tags : null;
    }
    if (Object.keys(patch).length === 0) return errorResponse(res, 'nothing_to_update', 400);

    await file.update(patch);

    require('../services/auditService').logAudit(req, {
      action: 'file.meta_update',
      targetType: 'file',
      targetId: file.id,
      businessId: file.business_id,
      oldValue: before,
      newValue: patch,
    });
    // 실시간 — 다른 사람이 그 목록을 열고 있으면 즉시 반영된다(CLAUDE.md 운영 안정성 16).
    broadcastFile(req, file, 'file:updated');
    return successResponse(res, {
      id: file.id,
      file_name: file.file_name,
      description: file.description,
      tags: file.tags || [],
    });
  } catch (err) { next(err); }
});

router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    if (!(await canMutateFile(file, req))) {
      return errorResponse(res, '본인 업로드 · 오너 · 프로젝트 PM 만 삭제할 수 있습니다', 403);
    }

    const t = await sequelize.transaction();
    try {
      await trashFile(file, req, t);
      await t.commit();
      // 사이클 N+21 — 파일 삭제 audit
      require('../services/auditService').logAudit(req, {
        action: 'file.delete',
        targetType: 'file',
        targetId: file.id,
        oldValue: { name: file.original_filename, size: Number(file.size_bytes) || 0 },
      });
      broadcastFile(req, { id: file.id, business_id: file.business_id, project_id: file.project_id }, 'file:deleted');
      successResponse(res, null, 'File deleted');
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

// ─── Bulk delete ───

router.post('/:businessId/bulk-delete', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const ids = Array.isArray(req.body.file_ids) ? req.body.file_ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return errorResponse(res, 'file_ids required', 400);

    const files = await File.findAll({
      where: { id: { [Op.in]: ids }, business_id: req.params.businessId, deleted_at: null }
    });

    // 각 파일별 권한 확인 — 권한 없는 것이 하나라도 있으면 부분 실패 대신 전체 거부 (원자성).
    for (const f of files) {
      if (!(await canMutateFile(f, req))) {
        return errorResponse(res, `파일 #${f.id} 에 대한 삭제 권한이 없습니다 (본인 업로드 · 오너 · 프로젝트 PM 만 가능)`, 403);
      }
    }

    const t = await sequelize.transaction();
    try {
      // 사이클 N+59 — bulk delete audit 사전 snapshot (destroy 후엔 메타 잃음)
      const snapshots = files.map((f) => ({
        id: f.id,
        file_name: f.file_name,
        file_size: Number(f.file_size) || 0,
        project_id: f.project_id,
        visibility: f.visibility,
      }));
      for (const f of files) await trashFile(f, req, t);
      await t.commit();
      for (const f of files) broadcastFile(req, { id: f.id, business_id: f.business_id, project_id: f.project_id }, 'file:deleted');
      // 사이클 N+59 — bulk delete audit. 다량 데이터 삭제 = 보안 감사 critical
      require('../services/auditService').logAudit(req, {
        action: 'file.bulk_delete',
        targetType: 'file',
        targetId: null,
        businessId: Number(req.params.businessId),
        oldValue: { count: snapshots.length, files: snapshots },
      });
      successResponse(res, { deleted: files.length }, `${files.length} files deleted`);
    } catch (e) { await t.rollback(); throw e; }
  } catch (error) {
    next(error);
  }
});

// ─── 삭제 = 2단계 (휴지통 → 영구삭제) ──────────────────────────────
//
// ★ 여기가 이번 변경의 핵심이다. 여태 "soft delete" 라고 부르던 것이 **바이트까지 지우고
//   있었다** — DB 행만 남고 파일은 사라졌다. 그 상태로 복구 화면만 붙이면 "복구" 버튼이
//   거짓말을 한다(memory: feedback_soft_delete_without_trash_ui).
//
//   삭제(trashFile)  : deleted_at/deleted_by 만 기록. 바이트·원격 객체는 **손대지 않는다.**
//   영구삭제(purgeFile): 그때 비로소 ref_count 감소 · 물리 unlink · 원격 삭제.
//
//   쿼터는 **삭제 시점에 즉시 반환**한다(현행 유지). Free 1GB 인 제품에서 "지웠는데 용량이
//   안 준다" 는 즉시 막힘으로 이어진다 — Dropbox 모델. 실제 디스크는 보존기간(TRASH_RETENTION_DAYS)
//   만큼 더 쓰지만 자동 정리 cron 이 상한을 잡는다.
const TRASH_RETENTION_DAYS = 30;

async function trashFile(file, req, transaction) {
  file.deleted_at = new Date();
  file.deleted_by = req?.user?.id ?? null;
  await file.save({ transaction });

  // 쿼터 반환 (자체 스토리지만 쿼터 사용) — 바이트는 남지만 사용자 한도에서는 즉시 빠진다.
  if (file.storage_provider === 'planq') {
    const usage = await getOrCreateUsage(file.business_id, transaction);
    usage.bytes_used = Math.max(0, Number(usage.bytes_used) - Number(file.file_size));
    usage.file_count = Math.max(0, usage.file_count - 1);
    await usage.save({ transaction });
  }
}

// 복구 가능한가 — **바이트가 실제로 있는가**로 판정한다.
//   파생 컬럼(purged_at 같은 것)을 진실의 원천으로 두지 않는다: 그 컬럼과 디스크가 어긋나는
//   순간 복구 버튼이 거짓말을 한다(memory: feedback_derived_field_not_source_of_truth).
//   외부 저장소(gdrive/s3)는 우리가 삭제를 미뤘으므로 원격에 남아 있다 — 다만 사용자가 Drive
//   에서 직접 지웠을 수 있어 확답하지 않고, 복구 시도에서 실패하면 그때 알린다.
function isRestorable(file) {
  if (file.storage_provider !== 'planq') return true;
  try { return !!file.file_path && fs.existsSync(file.file_path); } catch { return false; }
}



// ─── Download ───

router.get('/:businessId/:id/download', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    // 사이클 N+9: 옵션 A — visibility 단계별 권한 (L1 본인만 / L2 프로젝트 멤버 / L3 워크스페이스)
    // Client 분기 포함 판정은 canDownloadFile 단일 원천 (#228 에서 추출 — 동작 무변경)
    if (!(await canDownloadFile(req.scope, req.user.id, file))) {
      return errorResponse(res, 'forbidden', 403);
    }
    if (await _s3Redirect(file, res)) return;
    if (file.storage_provider !== 'planq') {
      if (file.external_url) return res.redirect(file.external_url);
      return errorResponse(res, 'External file has no URL', 400);
    }
    if (!fs.existsSync(file.file_path)) return errorResponse(res, 'Physical file missing', 410);
    const absPath = path.resolve(file.file_path);
    // ★ 2026-08-24 (Irene: "이메일에 이미지가 첨부된게 너무 늦게 떠")
    //   ?w= 가 붙은 이미지 요청은 리사이즈본(webp)을 준다 — 원본 2.4MB 를 그대로 내려주던 것이
    //   메일 본문 인라인 이미지가 늦게 뜨는 직접 원인이었다.
    //   services/imageResize 는 이미 문서 에디터(#97)가 쓰는 공용 구현 — 디스크 캐시 + 허용 폭 스냅 +
    //   실패 시 원본 폴백(false 반환)까지 포함이라 여기 붙이는 것은 추가 위험이 없다.
    //   ?w= 없는 기존 호출(내려받기 등)은 **완전히 그대로** 원본을 받는다.
    if (await require('../services/imageResize').maybeServeResized(req, res, absPath, file.mime_type)) return;
    res.setHeader('Content-Disposition', buildContentDisposition(file.file_name));
    if (file.mime_type) res.setHeader('Content-Type', file.mime_type);
    return res.sendFile(absPath);
  } catch (error) {
    next(error);
  }
});

// ─── #228 드래그 아웃 서명 URL 발급 ───
// POST /api/files/:businessId/:id/drag-url  →  { url, expires_at }
// 인증 필수. 다운로드와 **같은 권한 술어**(canDownloadFile)를 통과해야만 발급한다.
router.post('/:businessId/:id/drag-url', authenticateToken, attachWorkspaceScope(),
  perUserLimiter('file-drag-url', { windowMs: 60 * 1000, max: 60 }), async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const file = await File.findOne({
        where: { id: req.params.id, business_id: businessId, deleted_at: null },
      });
      if (!file) return errorResponse(res, 'File not found', 404);
      if (!(await canDownloadFile(req.scope, req.user.id, file))) {
        return errorResponse(res, 'forbidden', 403);
      }
      // 외부 노출 게이트 — 공유 링크 발급과 같은 기준 (D4 #62)
      if (file.security_level && file.security_level !== 'general') {
        return errorResponse(res, 'security_level_blocks_drag', 403, 'security_level_blocks_drag');
      }
      // 외부 스토리지(gdrive/s3)는 바이트를 우리가 쥐고 있지 않다 — 리다이렉트 대상의 Content-Disposition
      // 을 보장할 수 없어 드래그 결과물이 뷰어 HTML 이 될 수 있다. 드래그 대상에서 제외한다.
      if (file.storage_provider !== 'planq') {
        return errorResponse(res, 'external_file_not_draggable', 400, 'external_file_not_draggable');
      }
      const exp = Math.floor(Date.now() / 1000) + DRAG_TTL_SEC;
      const sig = dragSig(businessId, file.id, req.user.id, exp);
      return successResponse(res, {
        url: `/api/files/drag/${businessId}/${file.id}?u=${req.user.id}&exp=${exp}&sig=${sig}`,
        expires_at: new Date(exp * 1000).toISOString(),
      });
    } catch (err) { next(err); }
  });

// ─── 영상·음성 재생 URL 발급 ───
// POST /api/files/:businessId/:id/media-url  →  { url, expires_at }
// 다운로드와 **같은 권한 술어**(canDownloadFile)를 통과해야만 발급한다.
router.post('/:businessId/:id/media-url', authenticateToken, attachWorkspaceScope(),
  perUserLimiter('file-media-url', { windowMs: 60 * 1000, max: 120 }), async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const file = await File.findOne({
        where: { id: req.params.id, business_id: businessId, deleted_at: null },
      });
      if (!file) return errorResponse(res, 'File not found', 404);
      if (!(await canDownloadFile(req.scope, req.user.id, file))) {
        return errorResponse(res, 'forbidden', 403);
      }
      if (!isPlayableMedia(file.mime_type)) {
        return errorResponse(res, 'not_playable_media', 400, 'not_playable_media');
      }
      // 외부 노출 게이트 — 공유 링크·드래그 아웃과 같은 기준 (D4 #62)
      if (file.security_level && file.security_level !== 'general') {
        return errorResponse(res, 'security_level_blocks_media', 403, 'security_level_blocks_media');
      }
      // 바이트를 우리가 쥔 파일만 — 외부 스토리지는 Range·MIME 을 보장할 수 없다.
      if (file.storage_provider !== 'planq') {
        return errorResponse(res, 'external_file_not_playable', 400, 'external_file_not_playable');
      }
      const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_SEC;
      const sig = mediaSig(businessId, file.id, req.user.id, exp);
      return successResponse(res, {
        url: `/api/files/media/${businessId}/${file.id}?u=${req.user.id}&exp=${exp}&sig=${sig}`,
        expires_at: new Date(exp * 1000).toISOString(),
      });
    } catch (err) { next(err); }
  });

// ─── 공유 링크 생성 ───
// POST /api/files/:businessId/:id/share-link  body: { expires_days?: 7|14|30|90 }
// 응답: { share_url, share_token, expires_at }
// 기본 만료 30일. 같은 파일에 다시 요청하면 새 토큰 발급 (이전 링크는 무효화).
router.post('/:businessId/:id/share-link', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);

    // D4 #62 — 보안등급 게이트: 일반(general) 외 외부 공유 링크 발급 차단
    if (file.security_level && file.security_level !== 'general') {
      return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
    }

    const expiresDays = [7, 14, 30, 90].includes(Number(req.body?.expires_days))
      ? Number(req.body.expires_days)
      : 30;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresDays * 86400000);
    const prevHadToken = !!file.share_token;
    await file.update({
      share_token: token,
      share_expires_at: expiresAt,
      share_created_at: new Date(),
    });
    const appUrl = process.env.APP_URL || 'https://dev.planq.kr';
    // 사이클 N+59 — audit. 파일 외부 노출 (share token 발급) = 보안 critical
    require('../services/auditService').logAudit(req, {
      action: 'file.share_link_create',
      targetType: 'file',
      targetId: file.id,
      businessId: file.business_id,
      oldValue: { had_previous_token: prevHadToken },
      newValue: {
        file_name: file.file_name,
        expires_days: expiresDays,
        expires_at: expiresAt.toISOString(),
        visibility: file.visibility,
      },
    });
    return successResponse(res, {
      share_token: token,
      share_url: `${appUrl}/api/files/public/${token}/download`,
      expires_at: expiresAt.toISOString(),
      expires_days: expiresDays,
    });
  } catch (err) { next(err); }
});

// ─── 공유 링크 해제 ───
// DELETE /api/files/:businessId/:id/share-link
router.delete('/:businessId/:id/share-link', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const file = await File.findOne({
      where: { id: req.params.id, business_id: req.params.businessId, deleted_at: null }
    });
    if (!file) return errorResponse(res, 'File not found', 404);
    const hadToken = !!file.share_token;
    const prevExpiresAt = file.share_expires_at;
    await file.update({ share_token: null, share_expires_at: null, share_created_at: null });
    // 사이클 N+59 — audit. share revoke (외부 접근 차단)
    require('../services/auditService').logAudit(req, {
      action: 'file.share_link_revoke',
      targetType: 'file',
      targetId: file.id,
      businessId: file.business_id,
      oldValue: { had_token: hadToken, share_expires_at: prevExpiresAt },
      newValue: { file_name: file.file_name },
    });
    return successResponse(res, { ok: true });
  } catch (err) { next(err); }
});

// ─── 대량 다운로드 (ZIP 스트리밍) ───
// POST /api/files/:businessId/bulk-download  body: { ids: ["direct-1", "chat-2", "task-3", ...] }
// composite ID 를 source 별 테이블에서 검색 + 권한 검증 후 ZIP 으로 묶어 스트리밍.
// 지원 source: direct (File), chat (MessageAttachment), task (TaskAttachment).
// post/meeting source 는 후속.
router.post('/:businessId/bulk-download', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (raw.length === 0) return errorResponse(res, 'ids_required', 400);
    if (raw.length > 200) return errorResponse(res, 'too_many_files', 400);

    // composite ID 파싱 — "direct-12", "chat-345", "task-67"
    const parsed = raw.map(s => {
      const m = String(s).match(/^(direct|chat|task)-(\d+)$/);
      return m ? { source: m[1], id: Number(m[2]) } : null;
    }).filter(Boolean);
    if (parsed.length === 0) return errorResponse(res, 'invalid_ids', 400);

    const directIds = parsed.filter(p => p.source === 'direct').map(p => p.id);
    const chatIds = parsed.filter(p => p.source === 'chat').map(p => p.id);
    const taskIds = parsed.filter(p => p.source === 'task').map(p => p.id);

    // D4 #62 — 기밀(confidential) 자료 일괄 내보내기는 관리자(owner/admin)만
    const dlScope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    const canExportConfidential = !!(dlScope.isOwner || dlScope.isAdmin || dlScope.isPlatformAdmin);

    const items = []; // { name, path }
    let confidentialSkipped = 0;

    // 1) direct = File 테이블, business_id 직접 검증
    if (directIds.length > 0) {
      const direct = await File.findAll({
        where: {
          id: { [Op.in]: directIds },
          business_id: businessId, deleted_at: null, storage_provider: 'planq',
        }
      });
      for (const f of direct) {
        if (f.security_level === 'confidential' && !canExportConfidential) { confidentialSkipped++; continue; }
        if (f.file_path && fs.existsSync(f.file_path)) {
          items.push({ name: f.file_name, path: f.file_path });
        }
      }
    }

    // 2) chat = MessageAttachment, message → conversation → business 검증
    if (chatIds.length > 0) {
      const chats = await MessageAttachment.findAll({
        where: { id: { [Op.in]: chatIds }, storage_provider: 'planq' },
        include: [{
          model: Message,
          attributes: ['id', 'conversation_id'],
          include: [{
            model: Conversation,
            attributes: ['id', 'business_id'],
            where: { business_id: businessId },
          }],
        }],
      });
      for (const a of chats) {
        if (a.file_path && fs.existsSync(a.file_path)) {
          items.push({ name: a.file_name, path: a.file_path });
        }
      }
    }

    // 3) task = TaskAttachment, business_id 직접 검증
    if (taskIds.length > 0) {
      const tasks = await TaskAttachment.findAll({
        where: {
          id: { [Op.in]: taskIds },
          business_id: businessId, storage_provider: 'planq',
        }
      });
      for (const a of tasks) {
        if (a.file_path && fs.existsSync(a.file_path)) {
          items.push({ name: a.original_name, path: a.file_path });
        }
      }
    }

    // 기밀만 요청했는데 권한 없어 전부 제외된 경우 — 명시적 차단
    if (items.length === 0 && confidentialSkipped > 0) return errorResponse(res, 'confidential_export_admin_only', 403, 'confidential_export_admin_only');
    if (items.length === 0) return errorResponse(res, 'no_files', 404);
    if (confidentialSkipped > 0) res.setHeader('X-Confidential-Skipped', String(confidentialSkipped));

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 6 } });
    const today = new Date().toISOString().slice(0, 10);
    const zipName = `planq-files-${today}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[bulk-zip] warn', err.message); });
    archive.on('error', (err) => { console.error('[bulk-zip] err', err); try { res.end(); } catch {} });
    archive.pipe(res);

    // 파일명 충돌 방지 — 동명이 있으면 (1), (2) 접미사
    const usedNames = new Map();
    for (const it of items) {
      let name = it.name;
      const seen = usedNames.get(it.name) || 0;
      if (seen > 0) {
        const ext = path.extname(name);
        const base = name.slice(0, name.length - ext.length);
        name = `${base} (${seen})${ext}`;
      }
      usedNames.set(it.name, seen + 1);
      archive.file(it.path, { name });
    }
    await archive.finalize();
  } catch (err) { next(err); }
});

// ─── 내부 API (Python Q Note ↔ Node) — 사이클 O4 ───
// Q Note 의 link-workspace-file 흐름에서 파일 메타·절대경로 조회.
// 인증: INTERNAL_API_KEY 헤더만 (사용자 토큰 없음).
router.get('/internal/:fileId', async (req, res, next) => {
  try {
    const key = req.header('x-internal-api-key');
    if (!process.env.INTERNAL_API_KEY || key !== process.env.INTERNAL_API_KEY) {
      return errorResponse(res, 'forbidden', 403);
    }
    const fileId = parseInt(req.params.fileId, 10);
    const businessId = req.query.business_id ? parseInt(req.query.business_id, 10) : null;
    if (!fileId || !businessId) return errorResponse(res, 'invalid_params', 400);

    const file = await File.findOne({ where: { id: fileId, business_id: businessId } });
    if (!file) return errorResponse(res, 'file_not_found', 404);

    // file_path 가 상대 경로면 uploadDir 기준 절대 경로로 정규화
    let absPath = file.file_path;
    if (absPath && !path.isAbsolute(absPath)) {
      absPath = path.join(__dirname, '..', absPath);
    }
    return successResponse(res, {
      id: file.id, file_name: file.file_name, file_size: Number(file.file_size),
      mime_type: file.mime_type, storage_provider: file.storage_provider,
      absolute_path: absPath,
    });
  } catch (err) { next(err); }
});

// 휴지통 라우터(routes/file_trash.js)가 **같은 술어**를 쓰도록 내보낸다.
//   따로 짜면 갈라진다 — 권한·가시성·보존기간은 한 곳에서만 정의한다.
module.exports = router;
module.exports.canMutateFile = canMutateFile;
module.exports.getOrCreateUsage = getOrCreateUsage;
module.exports.applyMemberDisplayName = applyMemberDisplayName;
module.exports.broadcastFile = broadcastFile;
module.exports.isRestorable = isRestorable;
module.exports.TRASH_RETENTION_DAYS = TRASH_RETENTION_DAYS;
