// routes/export.js — #63 개인 자료 export / 워크스페이스 백업 export (오프보딩)
// Phase 1: 본인 L1 파일 + 본인 작성 문서 zip / 관리자 워크스페이스 자료 zip (L1 개인 제외).
// archiver 스트리밍(메모리 안전) — routes/files.js bulk-download 패턴 재사용.
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const { File, Document } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 문서 → 단독 열람 가능한 HTML 파일
function renderDocHtml(d) {
  const title = escapeHtml(d.title || 'Untitled');
  const body = d.body_html
    ? d.body_html
    : (d.body_json ? `<pre>${escapeHtml(JSON.stringify(d.body_json, null, 2))}</pre>` : '');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${title}</title>`
    + `<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:820px;margin:40px auto;padding:0 20px;color:#0F172A;line-height:1.7}h1{font-size:24px;border-bottom:1px solid #E2E8F0;padding-bottom:12px}img{max-width:100%}</style>`
    + `</head><body><h1>${title}</h1>${body}</body></html>`;
}

// 안전한 파일명 + 동명 충돌 접미사
function uniqueName(map, name) {
  const seen = map.get(name) || 0;
  map.set(name, seen + 1);
  if (seen === 0) return name;
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${seen})${ext}`;
}

// 공통 zip 스트리밍
async function streamExport(res, label, files, docs) {
  const archiver = require('archiver');
  const archive = archiver('zip', { zlib: { level: 6 } });
  const today = new Date().toISOString().slice(0, 10);
  const zipName = `planq-export-${label}-${today}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
  archive.on('warning', (err) => { if (err.code !== 'ENOENT') console.warn('[export-zip] warn', err.message); });
  archive.on('error', (err) => { console.error('[export-zip] err', err); try { res.end(); } catch {} });
  archive.pipe(res);

  const manifest = { exported_at: new Date().toISOString(), scope: label, files: [], documents: [] };

  const usedFiles = new Map();
  for (const f of files) {
    if (!f.file_path || !fs.existsSync(f.file_path)) continue;
    const name = uniqueName(usedFiles, f.file_name || `file-${f.id}`);
    archive.file(f.file_path, { name: `files/${name}` });
    manifest.files.push({ name, size: Number(f.file_size) || 0, security_level: f.security_level, visibility: f.visibility || f.vlevel });
  }

  const usedDocs = new Map();
  for (const d of docs) {
    const safe = String(d.title || 'untitled').replace(/[\/\\:*?"<>|\n\r]/g, '_').slice(0, 120) || 'untitled';
    const name = uniqueName(usedDocs, `${safe}.html`);
    archive.append(renderDocHtml(d), { name: `documents/${name}` });
    manifest.documents.push({ title: d.title, security_level: d.security_level });
  }

  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  await archive.finalize();
}

// ── 본인 자료 수집 (L1 개인 파일 uploader=me + 본인 작성 문서) ──
async function collectSelf(businessId, userId) {
  const files = await File.findAll({
    where: {
      business_id: businessId,
      uploader_id: userId,
      deleted_at: null,
      storage_provider: 'planq',
      [Op.or]: [{ visibility: 'L1' }, { vlevel: 'L1' }],
    },
    order: [['created_at', 'DESC']],
  });
  const docs = await Document.findAll({
    where: { business_id: businessId, created_by: userId },
    order: [['created_at', 'DESC']],
  });
  return { files, docs };
}

// ── 워크스페이스 자료 수집 (L1 개인 제외 = L2/L3/L4 파일 + 전 문서) ──
async function collectWorkspace(businessId) {
  const files = await File.findAll({
    where: {
      business_id: businessId,
      deleted_at: null,
      storage_provider: 'planq',
      // L1 개인 파일은 백업에서도 제외 (사적 공간 보호). NULL legacy 는 워크스페이스로 간주.
      [Op.and]: [
        { [Op.or]: [{ visibility: { [Op.ne]: 'L1' } }, { visibility: null }] },
        { [Op.or]: [{ vlevel: { [Op.ne]: 'L1' } }, { vlevel: null }] },
      ],
    },
    order: [['created_at', 'DESC']],
  });
  const docs = await Document.findAll({
    where: { business_id: businessId },
    order: [['created_at', 'DESC']],
  });
  return { files, docs };
}

function summarize(files, docs) {
  const totalBytes = files.reduce((s, f) => s + (Number(f.file_size) || 0), 0);
  const confidential = files.filter(f => f.security_level === 'confidential').length
    + docs.filter(d => d.security_level === 'confidential').length;
  return {
    files: files.length,
    documents: docs.length,
    total_bytes: totalBytes,
    confidential_count: confidential,
  };
}

// GET /api/export/:businessId/me/preview — 본인 export 대상 미리보기
router.get('/:businessId/me/preview', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    const { files, docs } = await collectSelf(businessId, req.user.id);
    return successResponse(res, summarize(files, docs));
  } catch (err) { next(err); }
});

// POST /api/export/:businessId/me — 본인 자료 zip 다운로드
router.post('/:businessId/me', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    const { files, docs } = await collectSelf(businessId, req.user.id);
    if (files.length === 0 && docs.length === 0) return errorResponse(res, 'nothing_to_export', 404);
    require('../services/auditService').logAudit(req, {
      action: 'data.export.self', targetType: 'business', targetId: businessId, businessId,
      newValue: { files: files.length, documents: docs.length },
    });
    await streamExport(res, 'me', files, docs);
  } catch (err) { next(err); }
});

// GET /api/export/:businessId/workspace/preview — 관리자 전체 export 미리보기
router.get('/:businessId/workspace/preview', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) return errorResponse(res, 'admin_only', 403);
    const { files, docs } = await collectWorkspace(businessId);
    return successResponse(res, summarize(files, docs));
  } catch (err) { next(err); }
});

// POST /api/export/:businessId/workspace — 관리자 워크스페이스 자료 zip
router.post('/:businessId/workspace', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!(scope.isOwner || scope.isAdmin || scope.isPlatformAdmin)) return errorResponse(res, 'admin_only', 403);
    const { files, docs } = await collectWorkspace(businessId);
    if (files.length === 0 && docs.length === 0) return errorResponse(res, 'nothing_to_export', 404);
    require('../services/auditService').logAudit(req, {
      action: 'data.export.workspace', targetType: 'business', targetId: businessId, businessId,
      newValue: { files: files.length, documents: docs.length },
    });
    await streamExport(res, 'workspace', files, docs);
  } catch (err) { next(err); }
});

module.exports = router;
