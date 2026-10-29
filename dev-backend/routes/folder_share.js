// 폴더 공유 링크 (#469 · 설계 docs/FOLDER_SHARE_DESIGN.md §4 Fable 판정).
//
//   멤버 문: POST/DELETE /api/folders/:id/share — 발급·설정(만료·비밀번호)·끄기.
//   공개 문(무인증):
//     GET /api/folders/public/:token                         — 메타 + 파일 목록(경로·이름 순, 500 상한)
//     GET /api/folders/public/:token/auth-check              — 로그인 멤버면 Q file 그 폴더로
//     GET /api/folders/public/:token/files/:fileId/download   — 한 파일 받기(`?inline=1` 은 안전한 형식만)
//     GET /api/folders/public/:token/zip                      — 전체 받기(합계 상한, 시작 전 413)
//     GET /api/folders/public-thumb/:token/:fileId?w=         — 썸네일. ★ 접두어가 다른 이유: 이미지 버킷(IMAGE_PATHS)으로
//                                                              세야 한다 — 한 화면 썸네일 수백 장이 IP 600/분을 태운다.
//   «무엇이 실리나» 는 전부 services/folderShare 한 벌이다. 이 파일은 그 결과를 내보내기만 한다.
//   ★ /api/folders 에 file_folders.js 보다 **먼저** 마운트한다(server.js) — 그쪽 DELETE /:id 와 경로가 다르지만
//     공개 경로가 인증 미들웨어를 타는 라우트에 먹히지 않게 순서를 계약으로 둔다.
'use strict';

const express = require('express');
const path = require('path');
const router = express.Router();
const { FileFolder, Business } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
const share = require('../services/share_helper');
const fs = require('../services/folderShare');
const { serializeFolder } = require('../services/folderResponse');

// 지운 워크스페이스의 공개 링크는 닫힌다 — :token 하위 주소 전부(2026-10-09 규칙).
router.param('token', (req, res, next, token) =>
  require('../services/shareOpenable').workspaceAliveParam([[FileFolder, 'share_token']])(req, res, next, token));

const APP_URL = () => process.env.APP_URL || 'https://dev.planq.kr';
const DEFAULT_EXPIRES_DAYS = 30;   // 내용이 계속 바뀌는 그릇이라 무기한 기본은 과하다(판정 7). 무기한은 고를 수 있다.

function previewKind(f) {
  const { isSafeInline } = require('../services/fileServing');
  if (!isSafeInline(f.mime_type, f.file_name)) return null;
  const m = String(f.mime_type || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return null;
}

// 실시간 — 신호만(행을 뿌리면 토큰이 간다). 폴더는 멤버 화면만 공유 상태를 그리므로 워크스페이스 방.
function signalFolder(req, folder) {
  const io = req.app.get('io');
  if (io) io.to(`business:${folder.business_id}`).emit('folder:updated', { id: folder.id, business_id: folder.business_id, project_id: folder.project_id || null });
}

// 공유 창 숫자 — 보임 N · 빠짐 M(이유별) + 지금 창을 연 사람이 올린 «나만 보기» 파일 id(정정 판정 c:
//   링크를 넓히지 않고 올린 사람이 자기 파일을 여는 길 — 화면이 기존 PUT …/visibility 로 L3 로 바꾼다).
async function summaryOf(folder, viewerId) {
  const issuer = await fs.issuerScopeFor(folder, folder.shared_by);
  if (!issuer) return null;
  const r = await fs.listFolderLinkFiles(folder, issuer, { limit: 0 });
  const myPrivate = r.rows.filter((f) => f.uploader_id === viewerId && (f.vlevel || f.visibility) === 'L1'
    && (!f.security_level || f.security_level === 'general')).map((f) => f.id);
  return {
    visible: r.total, excluded: r.excluded, reasons: r.reasons,
    truncated: r.total > fs.MAX_FILES, max_files: fs.MAX_FILES, bytes: r.bytes,
    my_private_file_ids: myPrivate,
  };
}

// ─── 멤버 문 ────────────────────────────────────────────────────────────────
router.post('/:id/share', authenticateToken, async (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.id))) return next();
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'folder_not_found', 404);
    if (!(await fs.canManageFolderShare(req.user, folder))) return errorResponse(res, 'forbidden', 403);
    const body = { ...(req.body || {}) };
    const isNew = !folder.share_token;
    if (isNew && body.expires_in_days === undefined) body.expires_in_days = DEFAULT_EXPIRES_DAYS;
    const r = await share.applyShareUpdate(folder, body);
    // 발급자 = 처음 연 사람. 내용은 이 사람이 볼 수 있는 것으로 계산된다(services/folderShare).
    if (isNew) await folder.update({ shared_by: req.user.id });
    require('../services/auditService').logAudit(req, {
      action: isNew ? 'file_folder.share_create' : 'file_folder.share_update',
      targetType: 'file_folder', targetId: folder.id, businessId: folder.business_id,
      newValue: { access_locked: !!folder.share_password_hash, expires_at: folder.share_expires_at || null },
    });
    if (isNew || Object.keys(r.updates).length) signalFolder(req, folder);
    return successResponse(res, {
      share_token: r.token,
      share_url: `${APP_URL()}/public/folders/${r.token}`,
      shared_at: r.shared_at,
      share_expires_at: r.share_expires_at,
      password_set: r.password_set,
      folder_summary: await summaryOf(folder, req.user.id),
    });
  } catch (err) { next(err); }
});

router.delete('/:id/share', authenticateToken, async (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.id))) return next();
  try {
    const folder = await FileFolder.findByPk(req.params.id);
    if (!folder) return errorResponse(res, 'folder_not_found', 404);
    // 끄는 사람도 만들 수 있는 사람과 같은 술어(파일 0-J 선례)
    if (!(await fs.canManageFolderShare(req.user, folder))) return errorResponse(res, 'forbidden', 403);
    await folder.update({ ...share.shareOffPatch(folder), shared_by: null });
    require('../services/auditService').logAudit(req, { action: 'file_folder.share_revoke', targetType: 'file_folder', targetId: folder.id, businessId: folder.business_id });
    signalFolder(req, folder);
    return successResponse(res, { revoked: true, folder: serializeFolder(folder) });
  } catch (err) { next(err); }
});

// ─── 공개 문 ────────────────────────────────────────────────────────────────
// 토큰 → 폴더·발급자. 만료는 410, 없음·발급자 떠남은 404(바깥에 사유를 알리지 않는다).
async function openShare(req, res) {
  const r = await fs.resolveFolderShare(req.params.token);
  if (r.reason === 'expired') { share.checkShareExpiry(r.folder, res); return null; }
  if (!r.folder) { errorResponse(res, 'not_found', 404); return null; }
  return r;
}

router.get('/public/:token', async (req, res, next) => {
  try {
    const r = await openShare(req, res);
    if (!r) return;
    const { folder, issuerScope } = r;
    const v = await share.verifySharePassword(folder, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    res.setHeader('Cache-Control', 'no-store');
    const list = await fs.listFolderLinkFiles(folder, issuerScope);
    const biz = await Business.findByPk(folder.business_id, { attributes: ['id', 'name', 'brand_name'] });
    const token = req.params.token;
    return successResponse(res, {
      folder: { name: folder.name },
      workspace: biz ? { name: biz.brand_name || biz.name } : null,
      shared_at: folder.shared_at,
      share_expires_at: folder.share_expires_at,
      // 하위 폴더 경로 — 빈 폴더도 보여 준다(«폴더는 있는데 비었다» 와 «폴더가 없다» 를 가른다)
      folders: list.tree.filter((f) => f.path).map((f) => f.path),
      // ★ 파일 칸은 화이트리스트(판정 D) — 단건 공유 토큰·설명·태그·올린 사람이 섞여 나가지 않게.
      files: list.files.map(({ file: f, path: p }) => ({
        id: f.id,
        file_name: f.file_name,
        mime_type: f.mime_type,
        file_size: Number(f.file_size || 0),
        created_at: f.created_at,
        folder_path: p,
        preview_kind: previewKind(f),
        thumb: require('../services/filePreview').isRenderableImage(f.mime_type, f.file_name),
        // 비밀번호 공유면 받기·썸네일 주소에 붙일 서명(대상 file:<id>). 비밀번호 없으면 ''.
        download_qs: share.shareSubQuery(folder, token, `file:${f.id}`),
      })),
      total: list.total,
      truncated: list.truncated,
      total_bytes: list.bytes,
      zip_max_bytes: fs.ZIP_MAX_BYTES,
      zip_qs: share.shareSubQuery(folder, token, 'zip'),
    });
  } catch (err) { next(err); }
});

router.get('/public/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    const r = await openShare(req, res);
    if (!r) return;
    const scope = await getUserScope(req.user.id, r.folder.business_id, req.user.platform_role);
    const canAccess = isMemberOrAbove(scope);
    // Q file 은 프로젝트 폴더까지 같은 트리에 그린다 — 한 주소로 연다(QFilePage 가 ?folder 를 읽는다).
    const where = `/files?folder=${r.folder.id}`;
    return successResponse(res, {
      canAccess,
      appUrl: canAccess ? require('../services/notification_link').withWorkspace(where, r.folder.business_id) : null,
    });
  } catch (err) { next(err); }
});

async function sendOne(req, res, { thumb }) {
  const r = await openShare(req, res);
  if (!r) return;
  const { folder, issuerScope } = r;
  const fileId = req.params.fileId;
  if (!(await share.verifyShareSub(folder, req, req.params.token, `file:${fileId}`))) {
    return res.status(401).json({ success: false, message: 'password_required', requires_password: true });
  }
  // ★ id 만 알면 받는 구멍을 막는다 — 지금 이 링크에 드는 파일인지 목록과 같은 판정으로 다시 본다.
  const file = await fs.folderLinkFileById(folder, issuerScope, fileId);
  if (!file) return errorResponse(res, 'not_found', 404);
  const resize = require('../services/imageResize');
  if (thumb) {
    if (!require('../services/filePreview').isRenderableImage(file.mime_type, file.file_name)) return errorResponse(res, 'not_image', 403);
    const cacheId = file.storage_provider === 'gdrive' && file.external_id ? `drive:${file.external_id}` : null;
    if (cacheId && resize.serveCachedIfPresent(req, res, file.mime_type, cacheId)) return;
  }
  // Drive 저장분도 서버가 받아 흘린다 — external_url 로 보내면 바깥 사람에게는 로그인 벽이다(2026-09-03).
  const body = await require('../services/attachmentStorage').readAttachmentBody(file);
  if (!body.ok) return errorResponse(res, body.msg, body.code);
  if (body.redirect) return res.redirect(body.redirect);
  if (thumb) {
    const cacheId = file.storage_provider === 'gdrive' && file.external_id ? `drive:${file.external_id}` : null;
    if (body.abs && await resize.maybeServeResized(req, res, body.abs, file.mime_type)) return;
    if (!body.abs && body.stream && cacheId && await resize.resizeStreamAndServe(req, res, body.stream, file.mime_type, cacheId)) return;
    require('../services/fileServing').applyFileResponseHeaders(res, file, { inline: true });
    res.setHeader('Cache-Control', 'private, max-age=600');
    return require('../services/attachmentStorage').sendAttachmentBody(res, body, 'folders/public-thumb');
  }
  // inline 은 안전한 형식에만 — 판정은 services/fileServing 한 곳(.html 을 planq.kr 에서 렌더하던 구멍, 2026-09-02).
  const inline = String(req.query.inline || '') === '1';
  require('../services/fileServing').applyFileResponseHeaders(res, file, {
    inline,
    disposition: `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
  });
  res.setHeader('Cache-Control', 'no-store');
  return require('../services/attachmentStorage').sendAttachmentBody(res, body, 'folders/public-download');
}

router.get('/public/:token/files/:fileId/download', async (req, res, next) => {
  try { await sendOne(req, res, { thumb: false }); } catch (err) { next(err); }
});
router.get('/public-thumb/:token/:fileId', async (req, res, next) => {
  try { await sendOne(req, res, { thumb: true }); } catch (err) { next(err); }
});

// 전체 받기 — 링크에 실린 파일(경로째) 그대로. 합계 상한은 **시작 전**에 본다(스트림 도중 끊으면 깨진 zip 이다).
//   무인증 + 무거운 일이라 IP 당 분 3회.
const zipLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later' },
});
router.get('/public/:token/zip', zipLimiter, async (req, res, next) => {
  try {
    const r = await openShare(req, res);
    if (!r) return;
    const { folder, issuerScope } = r;
    if (!(await share.verifyShareSub(folder, req, req.params.token, 'zip'))) {
      return res.status(401).json({ success: false, message: 'password_required', requires_password: true });
    }
    const list = await fs.listFolderLinkFiles(folder, issuerScope);
    if (!list.files.length) return errorResponse(res, 'no_files', 404);
    const bytes = list.files.reduce((s, x) => s + Number(x.file.file_size || 0), 0);
    if (bytes > fs.ZIP_MAX_BYTES) {
      return res.status(413).json({ success: false, message: 'zip_too_large', total_bytes: bytes, max_bytes: fs.ZIP_MAX_BYTES });
    }
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 6 } });
    const zipName = `${String(folder.name || 'folder').replace(/[\\/:*?"<>|]/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="folder.zip"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    archive.on('warning', (e) => { if (e.code !== 'ENOENT') console.warn('[folder-zip] warn', e.message); });
    archive.on('error', (e) => { console.error('[folder-zip] err', e.message); try { res.end(); } catch { /* 이미 끝남 */ } });
    archive.pipe(res);
    const used = new Map();
    const failed = [];
    const { readAttachmentBody } = require('../services/attachmentStorage');
    const { PassThrough } = require('stream');
    // 하나씩 연다(Drive 동시 연결) · 원본 스트림은 PassThrough 로 감싼다(열린 뒤 터지면 entry 가 안 닫힌다 — bulk-download 와 같은 이유).
    for (const { file: f, path: p } of list.files) {
      const want = p ? `${p}/${f.file_name}` : f.file_name;
      const seen = used.get(want) || 0;
      used.set(want, seen + 1);
      const ext = path.extname(want);
      const name = seen ? `${want.slice(0, want.length - ext.length)} (${seen})${ext}` : want;
      const body = await readAttachmentBody(f).catch(() => ({ ok: false }));
      if (!body.ok || !body.stream) { failed.push(name); continue; }
      const pt = new PassThrough();
      body.stream.on('error', (e) => { console.warn('[folder-zip] item', e.message); failed.push(name); pt.end(); });
      body.stream.pipe(pt);
      await new Promise((resolve) => { archive.once('entry', resolve); archive.append(pt, { name }); });
    }
    if (failed.length) archive.append(`${failed.join('\n')}\n`, { name: '_not_included.txt' });
    await archive.finalize();
  } catch (err) { next(err); }
});

module.exports = router;
