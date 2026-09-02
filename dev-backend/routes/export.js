// routes/export.js — #63 개인 자료 export / 워크스페이스 백업 export (오프보딩)
// Phase 1: 본인 L1 파일 + 본인 작성 문서 zip / 관리자 워크스페이스 자료 zip (L1 개인 제외).
// archiver 스트리밍(메모리 안전) — routes/files.js bulk-download 패턴 재사용.
const express = require('express');
const { safeArchiveName } = require('../utils/archiveName');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { File, Document, Post, BusinessMember, Business, BusinessStorageUsage, ExportJob } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { getUserScope, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 문서 → 단독 열람 가능한 HTML 파일
// zip 안 문서 1건 → HTML.
//
// ★ 본문 렌더는 `services/pdfTemplates.js richBodyToHtml` 을 **재사용**한다. 옛 코드는
//   `body_html` 이 없으면 `<pre>${JSON.stringify(body_json)}</pre>` 로 **JSON 원문을 덤프**했다 —
//   Post(content_json = TipTap TEXT)로 넘어오면 zip 안 문서가 전부 JSON 덤프가 된다.
//   2026-08-07 포스트 PDF 파손과 같은 계열이라 그때 만든 렌더러를 그대로 쓴다.
// ★ 두 번째 인자에 `d.body_html` 을 **반드시 넘긴다** — processExport 의 Q Note 의사-doc 은
//   content_json 없이 body_html 만 갖는다. null 을 넘기면 Q Note 문서가 전부 빈 HTML 이 된다.
const PDF_ASSET_BASE = (process.env.PDF_ASSET_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3003}`).replace(/\/+$/, '');
const PUBLIC_ASSET_BASE = (process.env.APP_URL || 'https://dev.planq.kr').replace(/\/+$/, '');

function renderDocHtml(d) {
  const title = escapeHtml(d.title || 'Untitled');
  let body = require('../services/pdfTemplates').richBodyToHtml(d.content_json, d.body_html, d.content_text);
  // 이미지 절대화 base 교체 — 렌더러는 puppeteer(서버 자신)용 loopback 을 쓴다. 그대로 두면
  //   사용자가 자기 PC 에서 연 zip HTML 이 **자기 localhost** 를 찌르고 이미지가 전부 깨진다.
  if (body && PUBLIC_ASSET_BASE && PDF_ASSET_BASE !== PUBLIC_ASSET_BASE) {
    body = body.split(PDF_ASSET_BASE).join(PUBLIC_ASSET_BASE);
  }
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
    const name = uniqueName(usedFiles, safeArchiveName(f.file_name, `file-${f.id}`));
    archive.file(f.file_path, { name: `files/${name}` });
    manifest.files.push({ name, size: Number(f.file_size) || 0, security_level: f.security_level, visibility: f.visibility || f.vlevel });
  }

  const usedDocs = new Map();
  for (const d of docs) {
    const safe = safeArchiveName(d.title, 'untitled');   // 파일 분기와 **같은 함수** (따로 쓰면 갈라진다)
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
  // ★ 문서 = **Post** 다 (#250 후속 청크 2). Document 는 제품에 여는 화면이 없어(운영 0행)
  //   이 수집이 운영에서 실문서를 단 한 건도 잡은 적이 없었다 — 미리보기가 늘 "문서 0" 이었다.
  //
  // "내 자료" 정의 (Irene 결정 (a)): **본인이 쓴 개인 자산만**. 본인 작성 published 공개글은
  //   워크스페이스 공용 자산이라 제외한다.
  //   ★ 술어는 `draft` **OR** `L1` — AND 로 묶으면 과소수집이다:
  //     · published + L1 ("나만보기" 로 내린 글, brief 후속 문서) 은 개인 자산인데 빠진다
  //     · draft 는 posts.js 목록 필터가 작성자에게만 노출하므로 vlevel 과 무관하게 개인 자산이다
  const docs = await Post.findAll({
    where: {
      business_id: businessId,
      author_id: userId,
      [Op.or]: [{ status: 'draft' }, { vlevel: 'L1' }],
    },
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
  // ★ 문서 = Post. 파일 쪽과 **같은 정책**으로 L1 개인글을 제외한다(사적 공간 보호).
  //   draft 는 작성자에게만 보이는 개인 자산이라 워크스페이스 백업 대상이 아니다.
  //   legacy NULL vlevel 은 파일 패턴 그대로 워크스페이스로 간주.
  const docs = await Post.findAll({
    where: {
      business_id: businessId,
      status: 'published',
      [Op.or]: [{ vlevel: { [Op.ne]: 'L1' } }, { vlevel: null }],
    },
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

// ── Phase 2 (#63) — 워크스페이스 간 이전 (복사, 원본 유지) ──

// GET /api/export/:businessId/me/transfer-targets — 본인이 멤버인 다른 워크스페이스 목록
router.get('/:businessId/me/transfer-targets', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    const rows = await BusinessMember.findAll({
      where: { user_id: req.user.id, business_id: { [Op.ne]: businessId }, removed_at: null },
      include: [{ model: Business, attributes: ['id', 'name', 'brand_name'], required: true }],
    });
    const targets = rows.map((m) => ({
      id: m.Business.id,
      name: m.Business.brand_name || m.Business.name,
    }));
    return successResponse(res, targets);
  } catch (err) { next(err); }
});

// POST /api/export/:businessId/me/transfer  body { target_business_id }
// 본인 L1 파일 + 본인 작성 문서를 타겟 워크스페이스에 복사(원본 유지). 본인이 양쪽 멤버여야.
router.post('/:businessId/me/transfer', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const sourceBiz = Number(req.params.businessId);
    const targetBiz = Number(req.body?.target_business_id);
    if (!targetBiz || targetBiz === sourceBiz) return errorResponse(res, 'invalid_target', 400);

    const srcScope = await getUserScope(req.user.id, sourceBiz, req.user.platform_role);
    if (!isMemberOrAbove(srcScope)) return errorResponse(res, 'forbidden', 403);
    const tgtScope = await getUserScope(req.user.id, targetBiz, req.user.platform_role);
    if (!isMemberOrAbove(tgtScope)) return errorResponse(res, 'target_not_member', 403);

    const { files, docs } = await collectSelf(sourceBiz, req.user.id);
    let filesCopied = 0, docsCopied = 0, bytesAdded = 0, skipped = 0;

    for (const f of files.slice(0, 1000)) {
      if (!f.content_hash) { skipped++; continue; }
      // 이미 본인이 타겟에 같은 파일 보유 → 중복 이전 방지
      const mine = await File.findOne({
        where: { business_id: targetBiz, content_hash: f.content_hash, uploader_id: req.user.id, deleted_at: null },
      });
      if (mine) { skipped++; continue; }
      // 타겟 내 dedup — 같은 해시 물리파일 있으면 ref 공유
      const existing = await File.findOne({
        where: { business_id: targetBiz, content_hash: f.content_hash, deleted_at: null },
      });
      if (existing) {
        await existing.increment('ref_count');
        await File.create({
          business_id: targetBiz, uploader_id: req.user.id,
          file_name: f.file_name, file_path: existing.file_path, file_size: f.file_size,
          mime_type: f.mime_type, storage_provider: 'planq', content_hash: f.content_hash,
          ref_count: 1, visibility: 'L1', vlevel: 'L1', security_level: f.security_level,
        });
        filesCopied++;
        continue;
      }
      // 물리 복사
      if (!f.file_path || !fs.existsSync(f.file_path)) { skipped++; continue; }
      const dir = path.join(UPLOAD_DIR, String(targetBiz), new Date().toISOString().slice(0, 7));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const newPath = path.join(dir, crypto.randomUUID() + path.extname(f.file_path));
      fs.copyFileSync(f.file_path, newPath);
      await File.create({
        business_id: targetBiz, uploader_id: req.user.id,
        file_name: f.file_name, file_path: newPath, file_size: f.file_size,
        mime_type: f.mime_type, storage_provider: 'planq', content_hash: f.content_hash,
        ref_count: 1, visibility: 'L1', vlevel: 'L1', security_level: f.security_level,
      });
      filesCopied++;
      bytesAdded += Number(f.file_size) || 0;
    }

    // ★ 산출물은 **Post** 다 (#250 후속). 워커(services/exportJobWorker.js)와 같은 이유·같은 헬퍼 —
    //   Document 를 여는 화면이 제품에 없어서, 옛 코드는 사용자가 영영 못 여는 행을 만들고
    //   "문서 N건 복사됨" 이라고 보고했다. 두 경로 중 하나만 고치면 반쪽 전환이 된다.
    for (const d of docs.slice(0, 1000)) {
      const created = await require('../services/exportJobWorker').createTransferredPost({
        targetBiz, userId: req.user.id,
        // ★ 소스가 Post 다 — `body_json`/`kind` 를 넘기면 본문이 비고 category 가 Post.kind 로 오염된다
        title: d.title, tiptap: d.content_json,
        category: d.category || null, securityLevel: d.security_level,
      });
      if (!created) { skipped++; continue; }   // 본문 없거나 이미 복사된 건은 새로 만들지 않는다
      // 첨부 재링크 — 워커와 같은 헬퍼(본문만 옮기고 첨부를 끊으면 반쪽)
      await require('../services/exportJobWorker').relinkAttachments(d.id, created.id, targetBiz, req.user.id);
      docsCopied++;
    }

    if (bytesAdded > 0) {
      const [usage] = await BusinessStorageUsage.findOrCreate({
        where: { business_id: targetBiz, storage_provider: 'planq' },
        defaults: { business_id: targetBiz, bytes_used: 0, file_count: 0, storage_provider: 'planq' },
      });
      await usage.update({
        bytes_used: Number(usage.bytes_used) + bytesAdded,
        file_count: usage.file_count + filesCopied,
      });
    }

    require('../services/auditService').logAudit(req, {
      action: 'data.transfer.self', targetType: 'business', targetId: targetBiz, businessId: sourceBiz,
      newValue: { target_business_id: targetBiz, files_copied: filesCopied, documents_copied: docsCopied, skipped },
    });

    return successResponse(res, { files_copied: filesCopied, documents_copied: docsCopied, skipped });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// #63 Phase 3 — 비동기 job (이동/복사 + Q Note + 대용량 export)
// ════════════════════════════════════════════════════════════════

// POST /:businessId/me/transfer-job — 본인 L1 자료를 다른 워크스페이스로 이동/복사 (비동기)
router.post('/:businessId/me/transfer-job', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const sourceBiz = Number(req.params.businessId);
    const targetBiz = Number(req.body?.target_business_id);
    const mode = req.body?.mode === 'move' ? 'move' : 'copy';
    const includeQnote = !!req.body?.include_qnote;
    if (!targetBiz || targetBiz === sourceBiz) return errorResponse(res, 'invalid_target', 400);

    const srcScope = await getUserScope(req.user.id, sourceBiz, req.user.platform_role);
    if (!isMemberOrAbove(srcScope)) return errorResponse(res, 'forbidden', 403);
    const tgtScope = await getUserScope(req.user.id, targetBiz, req.user.platform_role);
    if (!isMemberOrAbove(tgtScope)) return errorResponse(res, 'target_not_member', 403);

    const job = await ExportJob.create({
      user_id: req.user.id, business_id: sourceBiz, kind: 'transfer',
      mode, target_business_id: targetBiz, include_qnote: includeQnote, status: 'queued',
    });
    require('../services/auditService').logAudit(req, {
      action: 'data.transfer_job.create', targetType: 'export_job', targetId: job.id, businessId: sourceBiz,
      newValue: { mode, target_business_id: targetBiz, include_qnote: includeQnote },
    });
    return successResponse(res, { job_id: job.id, status: job.status }, 'queued', 201);
  } catch (err) { next(err); }
});

// POST /:businessId/me/export-job — 본인 L1 자료 다운로드 zip 생성 (비동기, 대용량)
router.post('/:businessId/me/export-job', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const includeQnote = !!req.body?.include_qnote;
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    const job = await ExportJob.create({
      user_id: req.user.id, business_id: businessId, kind: 'export',
      include_qnote: includeQnote, status: 'queued',
    });
    return successResponse(res, { job_id: job.id, status: job.status }, 'queued', 201);
  } catch (err) { next(err); }
});

// GET /:businessId/me/jobs — 본인 job 목록 (최근 20)
router.get('/:businessId/me/jobs', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const jobs = await ExportJob.findAll({
      where: { business_id: businessId, user_id: req.user.id },
      order: [['id', 'DESC']], limit: 20,
    });
    return successResponse(res, jobs.map(j => {
      const tj = j.toJSON();
      return {
        id: tj.id, kind: tj.kind, mode: tj.mode, status: tj.status,
        target_business_id: tj.target_business_id, include_qnote: tj.include_qnote,
        result: tj.result, error: tj.error,
        has_download: tj.kind === 'export' && !!j.download_token && (!j.expires_at || new Date(j.expires_at) > new Date()),
        download_token: j.download_token || null, // 본인 job 목록이라 토큰 노출 안전
        created_at: tj.created_at, done_at: tj.done_at,
      };
    }));
  } catch (err) { next(err); }
});

// GET /:businessId/me/jobs/:jobId — 본인 job 상세 (소유자만)
router.get('/:businessId/me/jobs/:jobId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const job = await ExportJob.findOne({
      where: { id: Number(req.params.jobId), business_id: Number(req.params.businessId) },
    });
    if (!job) return errorResponse(res, 'not_found', 404);
    if (job.user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    const tj = job.toJSON();
    return successResponse(res, {
      id: tj.id, kind: tj.kind, mode: tj.mode, status: tj.status,
      result: tj.result, error: tj.error,
      has_download: tj.kind === 'export' && !!job.download_token && (!job.expires_at || new Date(job.expires_at) > new Date()),
      download_token: job.download_token,
      created_at: tj.created_at, done_at: tj.done_at,
    });
  } catch (err) { next(err); }
});

// GET /:businessId/me/jobs/:jobId/download?token= — export zip 다운로드 (본인 + 토큰)
router.get('/:businessId/me/jobs/:jobId/download', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const job = await ExportJob.findOne({
      where: { id: Number(req.params.jobId), business_id: Number(req.params.businessId) },
    });
    if (!job) return errorResponse(res, 'not_found', 404);
    if (job.user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    if (job.kind !== 'export' || !job.download_token) return errorResponse(res, 'not_ready', 404);
    if (req.query.token !== job.download_token) return errorResponse(res, 'invalid_token', 403);
    if (job.expires_at && new Date(job.expires_at) < new Date()) return errorResponse(res, 'expired', 410);
    if (!job.download_path || !fs.existsSync(job.download_path)) return errorResponse(res, 'file_missing', 410);
    let datePart = 'export';
    try { const c = job.toJSON().created_at; if (c) datePart = new Date(c).toISOString().slice(0, 10); } catch { /* fallback */ }
    const zipName = `planq-export-${datePart}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${encodeURIComponent(zipName)}`);
    fs.createReadStream(job.download_path).pipe(res);
  } catch (err) { next(err); }
});

// DELETE /:businessId/me/jobs/:jobId — 작업 내역에서 제거 (본인·running 제외). export zip 도 정리.
router.delete('/:businessId/me/jobs/:jobId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const job = await ExportJob.findOne({
      where: { id: Number(req.params.jobId), business_id: Number(req.params.businessId) },
    });
    if (!job) return errorResponse(res, 'not_found', 404);
    if (job.user_id !== req.user.id) return errorResponse(res, 'forbidden', 403);
    if (job.status === 'running') return errorResponse(res, 'job_running', 409); // 처리 중엔 삭제 불가
    if (job.download_path && fs.existsSync(job.download_path)) { try { fs.unlinkSync(job.download_path); } catch { /* best-effort */ } }
    await job.destroy();
    return successResponse(res, { id: job.id }, 'deleted');
  } catch (err) { next(err); }
});

module.exports = router;
// #63 Phase 3 — 워커(services/exportJobWorker.js)가 재사용
module.exports.collectSelf = collectSelf;
module.exports.streamExport = streamExport;
module.exports.renderDocHtml = renderDocHtml;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
