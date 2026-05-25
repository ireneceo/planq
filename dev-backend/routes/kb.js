// Q Talk 대화 자료 (KB) 라우터
// 내부 명칭 kb_*, 사용자 표기 "대화 자료"

const express = require('express');
const router = express.Router();
const { KbDocument, KbChunk, KbPinnedFaq, KbCategory, File: FileModel, Post } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { isMemberOrAbove, getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
function broadcastKb(req, doc, event = 'kb:updated') {
  const io = req.app.get('io');
  if (!io) return;
  const data = doc.toJSON ? doc.toJSON() : doc;
  if (doc.business_id) io.to(`business:${doc.business_id}`).emit(event, data);
  if (doc.project_id) io.to(`project:${doc.project_id}`).emit(event, data);
}
const { decodeOriginalName } = require('../services/filename');
const { createAuditLog } = require('../middleware/audit');
const kbService = require('../services/kb_service');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { User, Business } = require('../models');

// KB 직접 업로드용 multer (텍스트 추출 후 KbDocument 만들고 물리 파일도 보존)
const KB_UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(KB_UPLOAD_ROOT)) fs.mkdirSync(KB_UPLOAD_ROOT, { recursive: true });
const KB_TEXT_EXT = ['.txt', '.md', '.markdown', '.html', '.htm', '.json', '.csv', '.log'];
const kbUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ym = new Date().toISOString().slice(0, 7);
    const dir = path.join(KB_UPLOAD_ROOT, String(req.params.businessId || 'misc'), ym);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
const kbUpload = multer({
  storage: kbUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — KB 인덱싱 용도라 작게
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!KB_TEXT_EXT.includes(ext)) return cb(new Error('disallowed_extension'));
    cb(null, true);
  },
});

const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner';

// ─── N+64: 카테고리 + visibility 통합 헬퍼 ───────────────────
// 카테고리: 자유 string (40자 cap). categories JSON 우선, category 컬럼은 ENUM 호환 위해 'manual' fallback 또는 ENUM-match.
// vlevel: L1/L2/L3/L4 + target_member_ids — 라우트가 항상 vlevel 채움.
const LEGACY_CAT_ENUM = ['policy','manual','incident','faq','about','pricing'];
function sanitizeCategories(input) {
  if (input === null) return null;
  if (!Array.isArray(input)) return undefined;
  const cleaned = input.map(c => String(c || '').trim().slice(0, 40)).filter(Boolean);
  // dedup
  return Array.from(new Set(cleaned));
}
function pickLegacyCategoryEnum(categories) {
  if (!Array.isArray(categories)) return 'manual';
  const match = categories.find(c => LEGACY_CAT_ENUM.includes(c));
  return match || 'manual';
}
// 새 categories 가 들어오면 KbCategory 마스터 row 자동 upsert (사용자가 자유 추가한 카테고리도 마스터에 박제 → 다음 등록 시 추천)
async function upsertKbCategories(businessId, categories) {
  if (!Array.isArray(categories) || categories.length === 0) return;
  for (const name of categories) {
    try {
      await KbCategory.findOrCreate({
        where: { business_id: businessId, name },
        defaults: { business_id: businessId, name, sort_order: 0 }
      });
    } catch (_) { /* unique 충돌 무시 */ }
  }
}
// visibility 입력 → DB 컬럼 매핑
// req.body 의 vlevel, target_member_ids, project_id, client_id, client_ids 를 받아
// scope/read_policy/project_id/client_id/client_ids/vlevel/target_member_ids 풀세트 반환
function resolveVisibility(body) {
  const inVlevel = body.vlevel;
  if (!['L1','L2','L3','L4'].includes(inVlevel)) return null;  // vlevel 없으면 legacy scope 로 fallback
  const out = {
    vlevel: inVlevel,
    target_member_ids: null,
    scope: 'workspace',
    read_policy: 'all',
    project_id: null,
    client_id: null,
    client_ids: null,
  };
  if (inVlevel === 'L1') {
    out.scope = 'private';
  } else if (inVlevel === 'L2') {
    if (body.project_id) {
      out.scope = 'project';
      out.project_id = Number(body.project_id) || null;
    } else if (Array.isArray(body.target_member_ids) && body.target_member_ids.length > 0) {
      out.scope = 'workspace';
      out.read_policy = 'owner'; // legacy 호환 — 멤버 지정은 owner-only 영역에 가까움
      out.target_member_ids = body.target_member_ids.map(Number).filter(Boolean);
    } else {
      // L2 인데 target 없음 — 프로젝트도 멤버도 미지정. 일단 workspace 로 fallback (라우트가 400 처리해도 됨)
      out.scope = 'workspace';
    }
  } else if (inVlevel === 'L3') {
    out.scope = 'workspace';
  } else if (inVlevel === 'L4') {
    out.scope = 'client';
    if (Array.isArray(body.client_ids) && body.client_ids.length > 0) {
      out.client_ids = body.client_ids.map(Number).filter(Boolean);
      out.client_id = out.client_ids[0]; // legacy single 호환
    } else if (body.client_id) {
      out.client_id = Number(body.client_id) || null;
      out.client_ids = out.client_id ? [out.client_id] : null;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────

// List documents
router.get('/businesses/:businessId/kb/documents', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    // 사이클 G — 카테고리/스코프 필터 (옵션)
    const where = { business_id: req.params.businessId };
    const allowedCats = ['policy','manual','incident','faq','about','pricing'];
    // 단일 category (legacy 호환) — 하위 호환
    if (req.query.category && allowedCats.includes(req.query.category)) {
      where.category = req.query.category;
    }
    if (req.query.scope && ['workspace','project','client'].includes(req.query.scope)) {
      where.scope = req.query.scope;
    }
    if (req.query.project_id) where.project_id = parseInt(req.query.project_id, 10) || null;
    if (req.query.client_id) where.client_id = parseInt(req.query.client_id, 10) || null;
    if (req.query.q) where.title = { [require('sequelize').Op.like]: `%${String(req.query.q).slice(0,80)}%` };

    // 사이클 N+50 — SaaS readiness cap. KB documents 는 보통 작지만 (10~100) 안전망.
    // post-fetch JS filter (categories/tags) 가 있어 정식 pagination 대신 cap. 사용자 ?limit 가능.
    const rawLimit = Number(req.query.limit);
    const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : 1000;
    let docs = await KbDocument.findAll({
      where,
      attributes: ['id', 'title', 'source_type', 'category', 'categories', 'scope', 'project_id', 'client_id', 'file_name', 'file_size', 'version', 'status', 'chunk_count', 'uploaded_by', 'tags', 'attached_file_ids', 'attached_post_ids', 'custom_columns', 'custom_values', 'read_policy', 'client_ids', 'created_at', 'updated_at'],
      order: [['updated_at', 'DESC']],
      limit: safeLimit,
    });
    // 멀티 카테고리 필터 (?categories=policy,manual) — categories JSON 또는 legacy category 매칭
    if (req.query.categories) {
      const wanted = String(req.query.categories).split(',').map(s => s.trim()).filter(s => allowedCats.includes(s));
      if (wanted.length > 0) {
        docs = docs.filter(d => {
          const cats = Array.isArray(d.categories) && d.categories.length > 0 ? d.categories : [d.category];
          return cats.some(c => wanted.includes(c));
        });
      }
    }
    // 사이클 P3 — 태그 필터 (DB JSON 검색 대신 in-memory — KB 데이터량 작아 OK)
    if (req.query.tag) {
      const wanted = String(req.query.tag).toLowerCase();
      docs = docs.filter(d => Array.isArray(d.tags) && d.tags.some(t => String(t).toLowerCase() === wanted));
    }
    successResponse(res, docs);
  } catch (err) { next(err); }
});

// Create document — 사이클 P3: 단일 폼 (제목 + 본문 + 첨부파일ids + 첨부포스트ids)
// 본문 + 첨부 텍스트 통합 → 1개의 KbDocument 로 인덱싱. LLM 자동 태그 추출 (백그라운드).
router.post('/businesses/:businessId/kb/documents', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const {
      title, body, source_type, category, categories, scope, project_id, client_id,
      attached_file_ids, attached_post_ids,
      // Q info — 사용자 정의 항목 + 권한
      custom_columns, custom_values, read_policy, client_ids,
    } = req.body;
    if (!title) return errorResponse(res, 'title required', 400);

    // 본문 또는 첨부 중 하나는 필수
    const fileIds = Array.isArray(attached_file_ids) ? attached_file_ids.map(Number).filter(Boolean) : [];
    const postIds = Array.isArray(attached_post_ids) ? attached_post_ids.map(Number).filter(Boolean) : [];
    if (!body && fileIds.length === 0 && postIds.length === 0) {
      return errorResponse(res, 'body_or_attachments_required', 400);
    }

    // N+64 — 자유 카테고리 (string 40자 cap). categories JSON 우선, 옛 category ENUM 은 backward-compat.
    const sanitized = sanitizeCategories(categories) ?? (category ? [String(category).trim().slice(0, 40)] : ['manual']);
    const finalCategories = sanitized.length > 0 ? sanitized : ['manual'];
    const finalCategory = pickLegacyCategoryEnum(finalCategories);

    // N+64 — vlevel 우선, 없으면 legacy scope 로 fallback
    const v = resolveVisibility(req.body);
    const allowedScopes = ['private','workspace','project','client'];
    let finalScope, finalProjectId, finalClientId, finalReadPolicy, finalClientIds, finalVlevel, finalTargetMembers;
    if (v) {
      finalScope = v.scope; finalProjectId = v.project_id; finalClientId = v.client_id;
      finalReadPolicy = v.read_policy; finalClientIds = v.client_ids;
      finalVlevel = v.vlevel; finalTargetMembers = v.target_member_ids;
    } else {
      finalScope = allowedScopes.includes(scope) ? scope : ((project_id ? 'project' : (client_id ? 'client' : 'private')));
      finalProjectId = null; finalClientId = null;
      finalReadPolicy = ['all', 'owner'].includes(read_policy) ? read_policy : 'all';
      finalClientIds = Array.isArray(client_ids) ? client_ids.map(Number).filter(Boolean) : null;
      finalVlevel = null;  // hook 가 채움
      finalTargetMembers = null;
      if (finalScope === 'project') {
        finalProjectId = parseInt(project_id, 10) || null;
        if (!finalProjectId) return errorResponse(res, 'project_id_required_for_project_scope', 400);
      }
      if (finalScope === 'client') {
        finalClientId = parseInt(client_id, 10) || null;
        if (!finalClientId) return errorResponse(res, 'client_id_required_for_client_scope', 400);
      }
    }
    if (finalVlevel === 'L2' && finalScope === 'project' && !finalProjectId) {
      return errorResponse(res, 'project_id_required_for_L2_project', 400);
    }
    if (finalVlevel === 'L4' && !finalClientId) {
      return errorResponse(res, 'client_id_required_for_L4', 400);
    }

    // 첨부 파일 텍스트 추출 → 본문에 합치기 (txt/md/html/json/csv 만)
    const textExtensions = ['.txt', '.md', '.markdown', '.html', '.htm', '.json', '.csv', '.log'];
    let mergedBody = String(body || '');
    if (fileIds.length > 0) {
      const files = await FileModel.findAll({ where: { id: fileIds, business_id: businessId } });
      for (const f of files) {
        const ext = path.extname(f.file_name || '').toLowerCase();
        if (!textExtensions.includes(ext)) continue;
        if (f.storage_provider !== 'planq') continue;
        try {
          const absPath = path.isAbsolute(f.file_path) ? f.file_path : path.join(__dirname, '..', f.file_path);
          let text = await fs.promises.readFile(absPath, 'utf8');
          if (ext === '.html' || ext === '.htm') {
            text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
          }
          if (text.trim()) mergedBody += `\n\n--- ${f.file_name} ---\n${text}`;
        } catch (e) { console.error('[kb] file read for merge failed', e.message); }
      }
    }
    if (postIds.length > 0) {
      const posts = await Post.findAll({ where: { id: postIds, business_id: businessId } });
      for (const p of posts) {
        let text = p.body_text || '';
        if (!text && p.body_html) {
          text = String(p.body_html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (text.trim()) mergedBody += `\n\n--- ${p.title} ---\n${text}`;
      }
    }

    if (!mergedBody.trim()) return errorResponse(res, 'no_indexable_content', 400);

    const doc = await KbDocument.create({
      business_id: businessId,
      title: String(title).slice(0, 300),
      body: mergedBody,
      source_type: ['manual', 'faq', 'policy', 'pricing', 'other', 'file', 'post'].includes(source_type) ? source_type : 'manual',
      category: finalCategory,
      categories: finalCategories,
      scope: finalScope,
      project_id: finalProjectId,
      client_id: finalClientId,
      attached_file_ids: fileIds.length > 0 ? fileIds : null,
      attached_post_ids: postIds.length > 0 ? postIds : null,
      custom_columns: Array.isArray(custom_columns) ? custom_columns : null,
      custom_values: (custom_values && typeof custom_values === 'object') ? custom_values : null,
      read_policy: finalReadPolicy,
      client_ids: finalClientIds,
      vlevel: finalVlevel,
      target_member_ids: finalTargetMembers,
      uploaded_by: req.user.id,
      status: 'pending',
    });
    // N+64 — categories 마스터 자동 upsert
    upsertKbCategories(businessId, finalCategories).catch(() => {});

    // 비동기 인덱싱 + LLM 태그 추출
    kbService.indexDocument(doc.id).catch(err => {
      console.error('[kb] indexing failed', err.message);
    });
    kbService.extractTags(doc.id).catch(err => {
      console.error('[kb] tag extraction failed', err.message);
    });

    await createAuditLog({
      userId: req.user.id,
      businessId,
      action: 'kb.document_create',
      targetType: 'KbDocument',
      targetId: doc.id,
      newValue: { title: doc.title, size: mergedBody.length, files: fileIds.length, posts: postIds.length }
    });

    broadcastKb(req, doc, 'kb:new');
    successResponse(res, doc, 'Document created and queued for indexing', 201);
  } catch (err) { next(err); }
});

// ─── 파일 직접 업로드 → Knowledge ingest ──────────────────────────────
// "새 지식 등록 → 파일 업로드" 탭. multipart 로 파일 1개 받아 텍스트 추출 + 즉시 인덱싱.
// 사이클 P1 (재구성).
router.post('/businesses/:businessId/kb/documents/upload',
  authenticateToken, checkBusinessAccess,
  (req, res, next) => {
    kbUpload.single('file')(req, res, (err) => {
      if (!err) return next();
      if (err.message === 'disallowed_extension') return errorResponse(res, 'unsupported_file_type', 400);
      if (err.code === 'LIMIT_FILE_SIZE') return errorResponse(res, 'file_too_large_for_kb (max 5MB)', 400);
      return errorResponse(res, err.message || 'upload_failed', 400);
    });
  },
  async (req, res, next) => {
    try {
      if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
      if (!req.file) return errorResponse(res, 'file_required', 400);
      const businessId = parseInt(req.params.businessId, 10);

      const ext = path.extname(req.file.originalname || '').toLowerCase();
      let text;
      try {
        text = await fs.promises.readFile(req.file.path, 'utf8');
      } catch (e) {
        return errorResponse(res, `read_failed: ${e.message}`, 500);
      }
      if (ext === '.html' || ext === '.htm') {
        text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (!text.trim()) return errorResponse(res, 'empty_file_body', 400);

      // N+64 — 자유 카테고리 (string 40자 cap)
      const sanU = sanitizeCategories(req.body.categories) ?? (req.body.category ? [String(req.body.category).trim().slice(0,40)] : ['manual']);
      const finalCategories = sanU.length > 0 ? sanU : ['manual'];
      const finalCategory = pickLegacyCategoryEnum(finalCategories);
      const allowedScopes = ['private','workspace','project','client'];
      let finalScope = allowedScopes.includes(req.body.scope) ? req.body.scope : ((req.body.project_id ? 'project' : (req.body.client_id ? 'client' : 'private')));
      let finalProjectId = null;
      let finalClientId = null;
      if (finalScope === 'project') {
        finalProjectId = parseInt(req.body.project_id, 10) || null;
        if (!finalProjectId) return errorResponse(res, 'project_id_required_for_project_scope', 400);
      }
      if (finalScope === 'client') {
        finalClientId = parseInt(req.body.client_id, 10) || null;
        if (!finalClientId) return errorResponse(res, 'client_id_required_for_client_scope', 400);
      }

      const decodedName = decodeOriginalName(req.file.originalname);
      const doc = await KbDocument.create({
        business_id: businessId,
        title: String(req.body.title || decodedName).slice(0, 300),
        body: text,
        source_type: 'file',
        file_name: decodedName,
        file_path: path.relative(path.join(__dirname, '..'), req.file.path),
        file_size: req.file.size,
        mime_type: req.file.mimetype || null,
        category: finalCategory,
        categories: finalCategories,
        scope: finalScope,
        project_id: finalProjectId,
        client_id: finalClientId,
        uploaded_by: req.user.id,
        status: 'pending',
      });

      kbService.indexDocument(doc.id).catch(err => {
        console.error('[kb] direct upload indexing failed', err.message);
      });

      await createAuditLog({
        userId: req.user.id, businessId,
        action: 'kb.document_upload',
        targetType: 'KbDocument', targetId: doc.id,
        newValue: { file_name: decodedName, size: text.length },
      });

      broadcastKb(req, doc, 'kb:new');
      return successResponse(res, doc, 'Uploaded and queued for indexing', 201);
    } catch (err) { next(err); }
  }
);

// ─── 파일 → Knowledge ingest ──────────────────────────────
// 기존 워크스페이스 파일을 KbDocument 로 import. 텍스트 추출은 txt/md/html/json/csv 만 (사이클 O2).
// PDF/DOCX 등 바이너리 포맷은 향후 추가.
router.post('/businesses/:businessId/kb/documents/import-from-file', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const { file_id, category, categories, scope, project_id, client_id, title } = req.body;
    if (!file_id) return errorResponse(res, 'file_id_required', 400);

    const file = await FileModel.findOne({ where: { id: file_id, business_id: businessId } });
    if (!file) return errorResponse(res, 'file_not_found', 404);

    // 텍스트 추출 가능한 mime/extension 만 허용
    const ext = path.extname(file.file_name || '').toLowerCase();
    const textExtensions = ['.txt', '.md', '.markdown', '.html', '.htm', '.json', '.csv', '.log'];
    const textMimes = ['text/plain', 'text/markdown', 'text/html', 'application/json', 'text/csv'];
    if (!textExtensions.includes(ext) && !(file.mime_type && textMimes.some(m => file.mime_type.startsWith(m)))) {
      return errorResponse(res, 'unsupported_file_type_for_import', 400);
    }

    // 파일 본문 읽기 (planq storage 만, 1MB 제한)
    if (file.storage_provider !== 'planq') {
      return errorResponse(res, 'external_storage_not_supported', 400);
    }
    const MAX = 1024 * 1024;
    if (Number(file.file_size) > MAX) return errorResponse(res, 'file_too_large_for_kb_import', 400);

    let text;
    try {
      text = await fs.promises.readFile(file.file_path, 'utf8');
    } catch (e) {
      return errorResponse(res, `read_failed: ${e.message}`, 500);
    }
    // HTML 인 경우 태그 제거 (간단)
    if (ext === '.html' || ext === '.htm') {
      text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!text.trim()) return errorResponse(res, 'empty_file_body', 400);

    // N+64 — 자유 카테고리 (string 40자 cap)
    const sanU = sanitizeCategories(categories) ?? (category ? [String(category).trim().slice(0,40)] : ['manual']);
    const finalCategories = sanU.length > 0 ? sanU : ['manual'];
    const finalCategory = pickLegacyCategoryEnum(finalCategories);
    const allowedScopes = ['private','workspace','project','client'];
    let finalScope = allowedScopes.includes(scope) ? scope : ((project_id ? 'project' : (client_id ? 'client' : 'private')));
    let finalProjectId = null;
    let finalClientId = null;
    if (finalScope === 'project') {
      finalProjectId = parseInt(project_id, 10) || null;
      if (!finalProjectId) return errorResponse(res, 'project_id_required_for_project_scope', 400);
    }
    if (finalScope === 'client') {
      finalClientId = parseInt(client_id, 10) || null;
      if (!finalClientId) return errorResponse(res, 'client_id_required_for_client_scope', 400);
    }

    const doc = await KbDocument.create({
      business_id: businessId,
      title: String(title || file.file_name || `File #${file.id}`).slice(0, 300),
      body: text,
      source_type: 'file',
      source_file_id: file.id,
      file_name: file.file_name,
      file_size: file.file_size,
      category: finalCategory,
      categories: finalCategories,
      scope: finalScope,
      project_id: finalProjectId,
      client_id: finalClientId,
      uploaded_by: req.user.id,
      status: 'pending',
    });

    kbService.indexDocument(doc.id).catch(err => {
      console.error('[kb] file import indexing failed', err.message);
    });

    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'kb.document_import_file',
      targetType: 'KbDocument', targetId: doc.id,
      newValue: { file_id: file.id, file_name: file.file_name, size: text.length },
    });

    return successResponse(res, doc, 'Imported and queued for indexing', 201);
  } catch (err) { next(err); }
});

// ─── 포스트(문서) → Knowledge ingest ──────────────────────────────
// PostsPage 의 "Q knowledge 로 보내기" 메뉴에서 호출.
router.post('/businesses/:businessId/kb/documents/import-from-post', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const { post_id, category, categories, scope, project_id, client_id } = req.body;
    if (!post_id) return errorResponse(res, 'post_id_required', 400);

    const post = await Post.findOne({ where: { id: post_id, business_id: businessId } });
    if (!post) return errorResponse(res, 'post_not_found', 404);

    // post.body_text 우선 (plain), 없으면 body_html → strip
    let text = post.body_text || '';
    if (!text && post.body_html) {
      text = String(post.body_html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!text.trim()) return errorResponse(res, 'empty_post_body', 400);

    // N+64 — 자유 카테고리 (string 40자 cap)
    const sanU = sanitizeCategories(categories) ?? (category ? [String(category).trim().slice(0,40)] : ['manual']);
    const finalCategories = sanU.length > 0 ? sanU : ['manual'];
    const finalCategory = pickLegacyCategoryEnum(finalCategories);
    const allowedScopes = ['private','workspace','project','client'];
    let finalScope = allowedScopes.includes(scope) ? scope : ((project_id ? 'project' : (client_id ? 'client' : 'private')));
    let finalProjectId = null;
    let finalClientId = null;
    if (finalScope === 'project') {
      finalProjectId = parseInt(project_id, 10) || post.project_id || null;
      if (!finalProjectId) return errorResponse(res, 'project_id_required_for_project_scope', 400);
    }
    if (finalScope === 'client') {
      finalClientId = parseInt(client_id, 10) || null;
      if (!finalClientId) return errorResponse(res, 'client_id_required_for_client_scope', 400);
    }

    const doc = await KbDocument.create({
      business_id: businessId,
      title: String(post.title || `Post #${post.id}`).slice(0, 300),
      body: text,
      source_type: 'post',
      source_post_id: post.id,
      category: finalCategory,
      categories: finalCategories,
      scope: finalScope,
      project_id: finalProjectId,
      client_id: finalClientId,
      uploaded_by: req.user.id,
      status: 'pending',
    });

    kbService.indexDocument(doc.id).catch(err => {
      console.error('[kb] post import indexing failed', err.message);
    });

    await createAuditLog({
      userId: req.user.id, businessId,
      action: 'kb.document_import_post',
      targetType: 'KbDocument', targetId: doc.id,
      newValue: { post_id: post.id, title: post.title, size: text.length },
    });

    return successResponse(res, doc, 'Imported and queued for indexing', 201);
  } catch (err) { next(err); }
});

// Get document detail + chunks + 첨부 파일/문서 메타 (사이클 P3)
router.get('/businesses/:businessId/kb/documents/:docId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const doc = await KbDocument.findOne({
      where: { id: req.params.docId, business_id: req.params.businessId },
      include: [{
        model: KbChunk,
        as: 'chunks',
        attributes: ['id', 'chunk_index', 'section_title', 'token_count'],
        required: false,
        order: [['chunk_index', 'ASC']]
      }]
    });
    if (!doc) return errorResponse(res, 'Document not found', 404);

    const result = doc.toJSON();
    // 첨부 파일 메타 (다운로드 가능)
    if (Array.isArray(doc.attached_file_ids) && doc.attached_file_ids.length > 0) {
      const files = await FileModel.findAll({
        where: { id: doc.attached_file_ids, business_id: req.params.businessId },
        attributes: ['id', 'file_name', 'file_size', 'mime_type', 'storage_provider', 'external_url'],
      });
      result.attached_files = files.map(f => f.toJSON());
    } else {
      result.attached_files = [];
    }
    // 첨부 문서 (post) 메타 (열기 가능)
    if (Array.isArray(doc.attached_post_ids) && doc.attached_post_ids.length > 0) {
      const posts = await Post.findAll({
        where: { id: doc.attached_post_ids, business_id: req.params.businessId },
        attributes: ['id', 'title', 'project_id', 'category'],
      });
      result.attached_posts = posts.map(p => p.toJSON());
    } else {
      result.attached_posts = [];
    }
    successResponse(res, result);
  } catch (err) { next(err); }
});

// Delete document
// 인라인 편집 — 부분 수정 (제목·본문·custom_values·custom_columns·read_policy·client_ids·category·scope)
router.put('/businesses/:businessId/kb/documents/:docId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const doc = await KbDocument.findOne({
      where: { id: req.params.docId, business_id: req.params.businessId }
    });
    if (!doc) return errorResponse(res, 'Document not found', 404);

    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).slice(0, 300);
    if (req.body.body !== undefined) patch.body = String(req.body.body || '');
    // N+64 — 자유 카테고리 (40자 cap)
    if (req.body.category !== undefined) {
      const c = String(req.body.category || '').trim().slice(0, 40);
      if (c) patch.category = c;
    }
    if (req.body.categories !== undefined) {
      if (Array.isArray(req.body.categories)) {
        const cleaned = sanitizeCategories(req.body.categories);
        patch.categories = cleaned && cleaned.length > 0 ? cleaned : null;
        if (cleaned && cleaned.length > 0) patch.category = pickLegacyCategoryEnum(cleaned);
        // 마스터에 자동 upsert
        if (cleaned && cleaned.length > 0) upsertKbCategories(doc.business_id, cleaned).catch(() => {});
      } else if (req.body.categories === null) {
        patch.categories = null;
      }
    }
    // N+64 — vlevel 통합 visibility 적용
    const vUpd = resolveVisibility(req.body);
    if (vUpd) {
      patch.vlevel = vUpd.vlevel;
      patch.target_member_ids = vUpd.target_member_ids;
      patch.scope = vUpd.scope;
      patch.read_policy = vUpd.read_policy;
      patch.project_id = vUpd.project_id;
      patch.client_id = vUpd.client_id;
      patch.client_ids = vUpd.client_ids;
    } else {
      // legacy 단일 필드 PATCH (vlevel 없이) — 그대로 받음
      if (req.body.scope !== undefined) {
        const allowedScopes = ['private','workspace','project','client'];
        if (allowedScopes.includes(req.body.scope)) patch.scope = req.body.scope;
      }
      if (req.body.project_id !== undefined) patch.project_id = req.body.project_id ? Number(req.body.project_id) : null;
      if (req.body.client_id !== undefined) patch.client_id = req.body.client_id ? Number(req.body.client_id) : null;
    }
    if (req.body.custom_columns !== undefined) {
      patch.custom_columns = Array.isArray(req.body.custom_columns) ? req.body.custom_columns : null;
    }
    if (req.body.custom_values !== undefined) {
      // 부분 머지 — 단일 column 인라인 편집 시 나머지 값 보존
      if (req.body.custom_values === null) {
        patch.custom_values = null;
      } else if (typeof req.body.custom_values === 'object') {
        const existing = (doc.custom_values && typeof doc.custom_values === 'object') ? doc.custom_values : {};
        patch.custom_values = { ...existing, ...req.body.custom_values };
      }
    }
    if (req.body.read_policy !== undefined && ['all', 'owner'].includes(req.body.read_policy)) {
      patch.read_policy = req.body.read_policy;
    }
    if (req.body.client_ids !== undefined) {
      patch.client_ids = Array.isArray(req.body.client_ids) ? req.body.client_ids.map(Number).filter(Boolean) : null;
    }
    if (req.body.tags !== undefined) {
      patch.tags = Array.isArray(req.body.tags) ? req.body.tags.map(String) : null;
    }
    // 첨부 파일/문서 add·remove — 전체 배열 PUT 으로 갱신 (단순)
    if (req.body.attached_file_ids !== undefined) {
      patch.attached_file_ids = Array.isArray(req.body.attached_file_ids)
        ? req.body.attached_file_ids.map(Number).filter(Boolean) : null;
    }
    if (req.body.attached_post_ids !== undefined) {
      patch.attached_post_ids = Array.isArray(req.body.attached_post_ids)
        ? req.body.attached_post_ids.map(Number).filter(Boolean) : null;
    }
    await doc.update(patch);
    await createAuditLog({
      userId: req.user.id, businessId: req.params.businessId,
      action: 'kb.document_update',
      targetType: 'KbDocument', targetId: doc.id,
      newValue: { fields: Object.keys(patch) }
    });
    broadcastKb(req, doc, 'kb:updated');
    successResponse(res, doc);
  } catch (err) { next(err); }
});

router.delete('/businesses/:businessId/kb/documents/:docId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const doc = await KbDocument.findOne({
      where: { id: req.params.docId, business_id: req.params.businessId }
    });
    if (!doc) return errorResponse(res, 'Document not found', 404);

    await KbChunk.destroy({ where: { kb_document_id: doc.id } });
    const snapForBroadcast = { id: doc.id, business_id: doc.business_id, project_id: doc.project_id };
    await doc.destroy();

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.document_delete',
      targetType: 'KbDocument',
      targetId: doc.id
    });

    broadcastKb(req, snapForBroadcast, 'kb:deleted');
    successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// Reindex
router.post('/businesses/:businessId/kb/documents/:docId/reindex', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const doc = await KbDocument.findOne({
      where: { id: req.params.docId, business_id: req.params.businessId }
    });
    if (!doc) return errorResponse(res, 'Document not found', 404);

    kbService.indexDocument(doc.id).catch(err => {
      console.error('[kb] reindex failed', err.message);
    });

    successResponse(res, { queued: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// KbCategory — 사이클 N+64 (자유 추가/편집 + 중복 감지 마스터)
// ─────────────────────────────────────────────────────────

// GET — 마스터 + KbDocument.categories JSON 안의 자유 카테고리 union
router.get('/businesses/:businessId/kb/categories', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const rows = await KbCategory.findAll({
      where: { business_id: businessId },
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    // KbDocument.categories JSON 안의 자유 string 도 union (마스터에 없는 것은 master_id null 로)
    const docs = await KbDocument.findAll({
      where: { business_id: businessId },
      attributes: ['categories'],
    });
    const used = new Set();
    for (const d of docs) {
      const cats = Array.isArray(d.categories) ? d.categories : [];
      for (const c of cats) if (c) used.add(String(c));
    }
    const masterNames = new Set(rows.map(r => r.name));
    const orphan = [...used].filter(n => !masterNames.has(n)).sort();
    successResponse(res, {
      master: rows.map(r => ({ id: r.id, name: r.name, sort_order: r.sort_order })),
      orphan, // 마스터에 등록 안 된 자유 카테고리 (KbDocument 안에서만 사용 중)
    });
  } catch (err) { next(err); }
});

// POST — 카테고리 마스터 등록 (자유 추가, 같은 이름 중복 차단)
router.post('/businesses/:businessId/kb/categories', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) return errorResponse(res, 'name_required', 400);
    const [row, created] = await KbCategory.findOrCreate({
      where: { business_id: businessId, name },
      defaults: { business_id: businessId, name, sort_order: Number(req.body?.sort_order) || 0 }
    });
    // N+64 — 다른 탭/디바이스 카테고리 즉시 반영 (CLAUDE.md 운영 안정성 16번)
    const io = req.app.get('io');
    if (io && created) io.to(`business:${businessId}`).emit('kb:cat:new', { id: row.id, name: row.name });
    successResponse(res, { id: row.id, name: row.name, sort_order: row.sort_order, created });
  } catch (err) { next(err); }
});

// PUT — 마스터 rename. 기존 KbDocument.categories JSON 안 같은 이름도 일괄 교체.
router.put('/businesses/:businessId/kb/categories/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const row = await KbCategory.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const newName = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 40) : row.name;
    if (!newName) return errorResponse(res, 'name_required', 400);
    if (newName !== row.name) {
      // 같은 워크스페이스에 이미 같은 이름 있으면 차단
      const dup = await KbCategory.findOne({ where: { business_id: businessId, name: newName } });
      if (dup) return errorResponse(res, 'duplicate_name', 409);
      // KbDocument.categories JSON 안 일괄 교체
      const docs = await KbDocument.findAll({ where: { business_id: businessId } });
      for (const d of docs) {
        const cats = Array.isArray(d.categories) ? d.categories : [];
        if (cats.includes(row.name)) {
          const next = cats.map(c => c === row.name ? newName : c);
          await d.update({ categories: next, category: pickLegacyCategoryEnum(next) });
        }
      }
    }
    const patch = { name: newName };
    if (req.body?.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order) || 0;
    await row.update(patch);
    const io = req.app.get('io');
    if (io) io.to(`business:${businessId}`).emit('kb:cat:updated', { id: row.id, name: row.name });
    successResponse(res, { id: row.id, name: row.name, sort_order: row.sort_order });
  } catch (err) { next(err); }
});

// DELETE — 마스터 삭제. 기존 KbDocument.categories JSON 의 같은 이름은 그대로 남김 (사용자 의도 보존).
router.delete('/businesses/:businessId/kb/categories/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const row = await KbCategory.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const snap = { id: row.id, name: row.name };
    await row.destroy();
    const io = req.app.get('io');
    if (io) io.to(`business:${businessId}`).emit('kb:cat:deleted', snap);
    successResponse(res, null, 'deleted');
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────
// Pinned FAQs
// ─────────────────────────────────────────────────────────

// List pinned FAQs
router.get('/businesses/:businessId/kb/pinned', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const faqs = await KbPinnedFaq.findAll({
      where: { business_id: req.params.businessId },
      order: [['updated_at', 'DESC']]
    });
    successResponse(res, faqs.map(f => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      short_answer: f.short_answer,
      keywords: f.keywords,
      category: f.category,
      has_embedding: !!f.embedding,
      created_at: f.created_at,
      updated_at: f.updated_at
    })));
  } catch (err) { next(err); }
});

// Create pinned FAQ
router.post('/businesses/:businessId/kb/pinned', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const { question, answer, short_answer, keywords, category } = req.body;
    if (!question || !answer) return errorResponse(res, 'question and answer required', 400);

    const faq = await KbPinnedFaq.create({
      business_id: req.params.businessId,
      question: String(question),
      answer: String(answer),
      short_answer: short_answer ? String(short_answer).slice(0, 500) : null,
      keywords: Array.isArray(keywords) ? keywords : (keywords ? [String(keywords)] : null),
      category: category ? String(category).slice(0, 100) : null,
      created_by: req.user.id
    });

    // 동기 임베딩 (인덱싱 즉시)
    try {
      await kbService.embedPinnedFaq(faq);
    } catch (e) { /* non-fatal */ }

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.pinned_faq_create',
      targetType: 'KbPinnedFaq',
      targetId: faq.id
    });

    broadcastKb(req, { id: faq.id, business_id: faq.business_id }, 'kb:pinned:new');
    successResponse(res, faq, 'Created', 201);
  } catch (err) { next(err); }
});

// Update pinned FAQ
router.put('/businesses/:businessId/kb/pinned/:faqId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const faq = await KbPinnedFaq.findOne({
      where: { id: req.params.faqId, business_id: req.params.businessId }
    });
    if (!faq) return errorResponse(res, 'FAQ not found', 404);

    const updates = {};
    ['question', 'answer', 'short_answer', 'keywords', 'category'].forEach(k => {
      if (k in req.body) updates[k] = req.body[k];
    });
    await faq.update(updates);

    // 재임베딩
    try { await kbService.embedPinnedFaq(faq); } catch (e) {}

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.pinned_faq_update',
      targetType: 'KbPinnedFaq',
      targetId: faq.id,
      newValue: updates
    });

    broadcastKb(req, { id: faq.id, business_id: faq.business_id }, 'kb:pinned:updated');
    successResponse(res, faq);
  } catch (err) { next(err); }
});

// Delete pinned FAQ
router.delete('/businesses/:businessId/kb/pinned/:faqId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const faq = await KbPinnedFaq.findOne({
      where: { id: req.params.faqId, business_id: req.params.businessId }
    });
    if (!faq) return errorResponse(res, 'FAQ not found', 404);
    const snapForBroadcast = { id: faq.id, business_id: faq.business_id };
    await faq.destroy();
    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.pinned_faq_delete',
      targetType: 'KbPinnedFaq',
      targetId: faq.id
    });
    broadcastKb(req, snapForBroadcast, 'kb:pinned:deleted');
    successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// CSV template download
router.get('/businesses/:businessId/kb/pinned/template.csv', authenticateToken, checkBusinessAccess, async (req, res) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  const csv = '\uFEFFquestion,answer,short_answer,keywords,category\n' +
              '"환불 정책이 어떻게 되나요?","구매 후 7일 이내에 환불을 요청하시면 전액 환불됩니다.","7일 이내 전액 환불","환불;반품;취소","정책"\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pinned-faq-template.csv"');
  res.send(csv);
});

// Hybrid search (test endpoint)
// ═══════════════════════════════════════════════════════════════
// KB AI / CSV Ingest (사이클 KB-Ingest Phase 1 — 2026-05-05)
//   설계: docs/KB_AI_INGEST_DESIGN.md
//   - POST /kb/ai-ingest      : 자유 텍스트/파일 → GPT-4o-mini 분석 → 후보 N 반환 (저장 X)
//   - POST /kb/csv-ingest     : CSV 파일 → 파싱 → 후보 N 반환 (저장 X)
//   - POST /kb/documents/batch: 검수된 후보 N 일괄 저장 (번역·임베딩 백그라운드)
// ═══════════════════════════════════════════════════════════════

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const SYSTEM_PROMPT_INGEST = `너는 PlanQ Knowledge Base 자료 정리 도우미.
사용자가 자유 텍스트를 던지면 KB 항목 후보를 추출해.

지원 입력 유형 (사이클 N+23 — 짧은 자유 정보도 모두 OK):
- 회의록·매뉴얼·이메일·정책 문서 (큰 텍스트)
- 계정·자격증명 정보 (서비스 ID/비밀번호/연락처)
- 연락처·주소·은행 계좌·기관 정보
- 기타 항목별로 정리할 수 있는 모든 자유 텍스트

핵심 원칙 (반드시 지킬 것):
1. 원문 정보만 사용. 새로운 정보·예시·해설을 절대 추가하지 마.
2. 문장은 거의 그대로. 오타·띄어쓰기·줄바꿈만 정리.
3. 토픽이 명확히 다르면 여러 항목으로 분리. 한 서비스의 자격증명 정보처럼 묶음이면 1개 항목.
4. 카테고리 자동 분류: policy(정책)/manual(매뉴얼·자격증명·연락처 포함)/incident(사고)/faq(자주묻는질문)/about(회사소개)/pricing(가격) 중 가장 적합한 1개.
   계정/자격증명/연락처 정보는 'manual' 카테고리 사용.
5. 태그 2~6개 추출 (원문 키워드만). 자격증명이면 ["서비스명","자격증명","연락처"] 같이.
6. title: 원문 첫 줄 또는 핵심 명사구. 50자 이내. 예: "기율법무법인 링크드인 계정" "Mary 전화번호".
7. body: 원문 그대로 (오타/공백만 정리). 줄바꿈 \\n 그대로 유지.

답변 형식 — **반드시 다음 중 하나**:
- 단일 항목이면: { "items": [{ "title": "...", "body": "...", "category": "manual", "tags": [...] }] }
- 다중 항목이면: { "items": [{ ... }, { ... }] }
- 절대 빈 items 반환 금지. 텍스트가 한 줄이라도 의미 있으면 1개 항목으로 추출.
- 다른 설명 X. JSON 만.`;

router.post('/businesses/:businessId/kb/ai-ingest', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const { text, source_language } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return errorResponse(res, 'text_required', 400);
    }
    const cleanText = String(text).trim().slice(0, 50000);

    // 플랜 한도 검사 — kb_analyze 사용량
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(businessId, 'use_cue', { actions: 1 });
    if (!planCan.ok) {
      return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
    }

    if (!OPENAI_API_KEY) {
      return errorResponse(res, 'openai_key_missing', 503);
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_INGEST },
      { role: 'user', content: `[입력 언어 힌트: ${source_language || 'auto'}]\n\n${cleanText}` },
    ];

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.1,    // 원문 보존이 핵심 — 거의 deterministic
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('[kb/ai-ingest] LLM error', r.status, errText.slice(0, 200));
      return errorResponse(res, 'llm_error', 502);
    }
    const j = await r.json();
    const content = (j.choices?.[0]?.message?.content || '').trim();

    // JSON 파싱 — 4 형식 모두 허용:
    //   1) [...]              — 배열
    //   2) { items: [...] }   — wrapper
    //   3) { candidates: [...] } — wrapper
    //   4) { title, body, ... } — 단일 객체 (사용자 입력이 짧을 때 LLM 이 자주 반환. 회귀 fix N+23)
    let candidates = [];
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) candidates = parsed;
      else if (Array.isArray(parsed.items)) candidates = parsed.items;
      else if (Array.isArray(parsed.candidates)) candidates = parsed.candidates;
      else if (parsed && typeof parsed === 'object' && parsed.title && parsed.body) candidates = [parsed];
      else candidates = [];
    } catch {
      console.error('[kb/ai-ingest] JSON parse failed:', content.slice(0, 200));
      return errorResponse(res, 'llm_invalid_response', 502);
    }

    // 후보 정규화 — title/body/category/tags 만 통과
    const ALLOWED_CAT = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];
    const normalized = candidates
      .filter(c => c && typeof c === 'object' && c.title && c.body)
      .map(c => ({
        title: String(c.title).slice(0, 300),
        body: String(c.body).slice(0, 50000),
        category: ALLOWED_CAT.includes(c.category) ? c.category : 'manual',
        tags: Array.isArray(c.tags) ? c.tags.slice(0, 8).map(String) : [],
      }))
      .slice(0, 20);  // 한 번에 최대 20 후보

    // cue_usage 차감
    try { await planEngine.consume(businessId, 'cue', 1); } catch { /* noop */ }

    return successResponse(res, { candidates: normalized, llm_usage: j.usage || null });
  } catch (err) { next(err); }
});

// ─── CSV Ingest — 파싱 후 후보 반환 (저장 X) ───
router.post('/businesses/:businessId/kb/csv-ingest', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string') return errorResponse(res, 'csv_required', 400);

    // 단순 CSV 파서 — 따옴표·쉼표·개행 처리
    const rows = parseCsv(String(csv).trim());
    if (rows.length < 2) return errorResponse(res, 'csv_empty_or_no_header', 400);

    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const ALLOWED_CAT = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];
    const titleIdx = header.indexOf('title');
    const bodyIdx = header.indexOf('body');
    const catIdx = header.indexOf('category');
    const tagsIdx = header.indexOf('tags');
    const langIdx = header.indexOf('source_language');
    const transIdx = header.indexOf('auto_translate');
    if (titleIdx < 0 || bodyIdx < 0) return errorResponse(res, 'csv_missing_required_columns', 400);

    const candidates = rows.slice(1)
      .filter(r => r[titleIdx] && r[bodyIdx])
      .map(r => ({
        title: String(r[titleIdx] || '').slice(0, 300),
        body: String(r[bodyIdx] || '').slice(0, 50000),
        category: ALLOWED_CAT.includes(r[catIdx]) ? r[catIdx] : 'manual',
        tags: r[tagsIdx] ? String(r[tagsIdx]).split(',').map(s => s.trim()).filter(Boolean).slice(0, 8) : [],
        source_language: r[langIdx] === 'en' ? 'en' : 'ko',
        auto_translate: r[transIdx] !== 'false',
      }))
      .slice(0, 500);  // CSV 최대 500 행

    return successResponse(res, { candidates });
  } catch (err) { next(err); }
});

// 단순 CSV 파서 — RFC 4180 따라 따옴표·쉼표·개행 처리
function parseCsv(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (field || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; }
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else field += c;
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

// ─── 일괄 저장 — N 후보를 KbDocument 로 batch insert + 번역 + 임베딩 ───
router.post('/businesses/:businessId/kb/documents/batch', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const { items, scope, project_id, client_id, auto_translate, translation_visibility, source_language } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) return errorResponse(res, 'items_required', 400);
    if (items.length > 500) return errorResponse(res, 'too_many_items', 400);

    const ALLOWED_CAT = ['policy','manual','incident','faq','about','pricing'];
    const ALLOWED_SCOPE = ['private','workspace','project','client'];
    const ALLOWED_VIS = ['translate','show_original','hide_other'];
    const finalScope = ALLOWED_SCOPE.includes(scope) ? scope : (project_id ? 'project' : (client_id ? 'client' : 'private'));
    const finalAutoTranslate = auto_translate !== false;
    const finalVisibility = ALLOWED_VIS.includes(translation_visibility) ? translation_visibility : 'translate';

    const created = [];
    const errors = [];

    // 다중 포스트 분리 식별 — items.length > 1 이면 첫 ID 가 parent_doc_id (자기참조 + 나머지)
    let parentDocId = null;

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      try {
        const cat = ALLOWED_CAT.includes(it.category) ? it.category : 'manual';
        const itemSrcLang = (it.source_language === 'en' || it.source_language === 'ko')
          ? it.source_language
          : (source_language === 'en' ? 'en' : 'ko');
        const itemAutoTrans = it.auto_translate !== undefined ? it.auto_translate !== false : finalAutoTranslate;

        const doc = await KbDocument.create({
          business_id: businessId,
          title: String(it.title).slice(0, 300),
          body: String(it.body).slice(0, 50000),
          source_type: 'manual',
          category: cat,
          categories: [cat],
          tags: Array.isArray(it.tags) ? it.tags.slice(0, 8).map(String) : null,
          scope: finalScope,
          project_id: finalScope === 'project' ? (parseInt(project_id, 10) || null) : null,
          client_id: finalScope === 'client' ? (parseInt(client_id, 10) || null) : null,
          status: 'pending',
          uploaded_by: req.user.id,
          source_language: itemSrcLang,
          auto_translate: itemAutoTrans,
          translation_visibility: finalVisibility,
          parent_doc_id: parentDocId,
        });

        // 첫 번째 = parent. 두 번째부터 parent_doc_id 로 연결
        if (idx === 0 && items.length > 1) parentDocId = doc.id;

        // 임베딩·번역 비동기 트리거 (kbService 가 처리하면 자동)
        try {
          if (kbService.indexDocument) {
            kbService.indexDocument(doc.id).catch((e) => console.warn('[kb-batch] indexDocument failed', doc.id, e.message));
          }
        } catch { /* noop */ }

        created.push({ id: doc.id, title: doc.title, source_language: doc.source_language });
      } catch (e) {
        errors.push({ index: idx, error: e.message });
      }
    }

    return successResponse(res, { created, errors, count: created.length });
  } catch (err) { next(err); }
});

router.post('/businesses/:businessId/kb/search', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { query, limit } = req.body;
    if (!query) return errorResponse(res, 'query required', 400);
    const result = await kbService.hybridSearch(req.params.businessId, query, { limit: limit || 5 });
    successResponse(res, result);
  } catch (err) { next(err); }
});

// ============================================
// 공유 링크 (사이클 N+4 — 통합 공유 시스템 Phase 2)
// POST   /api/kb-documents/:id/share         → token 발급/조회
// DELETE /api/kb-documents/:id/share         → 무효화
// GET    /api/kb-documents/public/by-token/:token        → 공개 메타
// GET    /api/kb-documents/public/by-token/:token/auth-check → Smart Routing
// ============================================
router.post('/kb-documents/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const doc = await KbDocument.findByPk(req.params.id);
    if (!doc) return errorResponse(res, 'kb_document_not_found', 404);
    const scope = await getUserScope(req.user.id, doc.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);

    const { applyShareUpdate } = require('../services/share_helper');
    const r = await applyShareUpdate(doc, req.body || {});
    const url = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/kb/${r.token}`;
    return successResponse(res, {
      share_token: r.token,
      share_url: url,
      shared_at: r.shared_at,
      share_expires_at: r.share_expires_at,
      password_set: r.password_set,
    });
  } catch (err) { next(err); }
});

router.delete('/kb-documents/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const doc = await KbDocument.findByPk(req.params.id);
    if (!doc) return errorResponse(res, 'kb_document_not_found', 404);
    const scope = await getUserScope(req.user.id, doc.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    await doc.update({
      share_token: null,
      shared_at: null,
      share_password_hash: null,
      share_expires_at: null,
    });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

router.get('/kb-documents/public/by-token/:token', async (req, res, next) => {
  try {
    // N+44 — 410 통일
    const doc = await KbDocument.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'], required: false },
        { model: Business, attributes: ['id', 'name', 'brand_name'], required: false },
      ],
      attributes: ['id', 'title', 'body', 'source_type', 'shared_at', 'share_expires_at',
        'share_password_hash', 'business_id', 'created_at', 'file_name', 'mime_type'],
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    const { verifySharePassword, checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(doc, res)) return;
    const v = await verifySharePassword(doc, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    return successResponse(res, {
      id: doc.id,
      title: doc.title,
      body: doc.body,
      source_type: doc.source_type,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      uploader: doc.uploader ? { id: doc.uploader.id, name: doc.uploader.name } : null,
      workspace: doc.Business ? { id: doc.Business.id, name: doc.Business.brand_name || doc.Business.name } : null,
      shared_at: doc.shared_at,
      created_at: doc.created_at,
    });
  } catch (err) { next(err); }
});

router.get('/kb-documents/public/by-token/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    // N+44 — 410 통일
    const doc = await KbDocument.findOne({ where: { share_token: req.params.token } });
    if (!doc) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(doc, res)) return;
    const scope = await getUserScope(req.user.id, doc.business_id, req.user.platform_role);
    const canAccess = isMemberOrAbove(scope);
    return successResponse(res, {
      canAccess,
      appUrl: canAccess ? `/talk?kb=${doc.id}` : null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
