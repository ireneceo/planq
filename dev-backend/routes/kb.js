// Q Talk 대화 자료 (KB) 라우터
// 내부 명칭 kb_*, 사용자 표기 "대화 자료"

const express = require('express');
const router = express.Router();
const { KbDocument, KbChunk, KbPinnedFaq, File: FileModel, Post } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const kbService = require('../services/kb_service');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

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

// ─────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────

// List documents
router.get('/businesses/:businessId/kb/documents', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    // 사이클 G — 카테고리/스코프 필터 (옵션)
    const where = { business_id: req.params.businessId };
    if (req.query.category && ['policy','manual','incident','faq','about','pricing'].includes(req.query.category)) {
      where.category = req.query.category;
    }
    if (req.query.scope && ['workspace','project','client'].includes(req.query.scope)) {
      where.scope = req.query.scope;
    }
    if (req.query.project_id) where.project_id = parseInt(req.query.project_id, 10) || null;
    if (req.query.client_id) where.client_id = parseInt(req.query.client_id, 10) || null;
    if (req.query.q) where.title = { [require('sequelize').Op.like]: `%${String(req.query.q).slice(0,80)}%` };

    let docs = await KbDocument.findAll({
      where,
      attributes: ['id', 'title', 'source_type', 'category', 'scope', 'project_id', 'client_id', 'file_name', 'file_size', 'version', 'status', 'chunk_count', 'uploaded_by', 'tags', 'attached_file_ids', 'attached_post_ids', 'created_at', 'updated_at'],
      order: [['updated_at', 'DESC']]
    });
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
      title, body, source_type, category, scope, project_id, client_id,
      attached_file_ids, attached_post_ids,
    } = req.body;
    if (!title) return errorResponse(res, 'title required', 400);

    // 본문 또는 첨부 중 하나는 필수
    const fileIds = Array.isArray(attached_file_ids) ? attached_file_ids.map(Number).filter(Boolean) : [];
    const postIds = Array.isArray(attached_post_ids) ? attached_post_ids.map(Number).filter(Boolean) : [];
    if (!body && fileIds.length === 0 && postIds.length === 0) {
      return errorResponse(res, 'body_or_attachments_required', 400);
    }

    const allowedCategories = ['policy','manual','incident','faq','about','pricing'];
    const allowedScopes = ['workspace','project','client'];
    const finalCategory = allowedCategories.includes(category) ? category : 'manual';
    let finalScope = allowedScopes.includes(scope) ? scope : 'workspace';
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
      scope: finalScope,
      project_id: finalProjectId,
      client_id: finalClientId,
      attached_file_ids: fileIds.length > 0 ? fileIds : null,
      attached_post_ids: postIds.length > 0 ? postIds : null,
      uploaded_by: req.user.id,
      status: 'pending',
    });

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

      const allowedCategories = ['policy','manual','incident','faq','about','pricing'];
      const allowedScopes = ['workspace','project','client'];
      const finalCategory = allowedCategories.includes(req.body.category) ? req.body.category : 'manual';
      let finalScope = allowedScopes.includes(req.body.scope) ? req.body.scope : 'workspace';
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

      const doc = await KbDocument.create({
        business_id: businessId,
        title: String(req.body.title || req.file.originalname).slice(0, 300),
        body: text,
        source_type: 'file',
        file_name: req.file.originalname,
        file_path: path.relative(path.join(__dirname, '..'), req.file.path),
        file_size: req.file.size,
        mime_type: req.file.mimetype || null,
        category: finalCategory,
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
        newValue: { file_name: req.file.originalname, size: text.length },
      });

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
    const { file_id, category, scope, project_id, client_id, title } = req.body;
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

    const allowedCategories = ['policy','manual','incident','faq','about','pricing'];
    const allowedScopes = ['workspace','project','client'];
    const finalCategory = allowedCategories.includes(category) ? category : 'manual';
    let finalScope = allowedScopes.includes(scope) ? scope : 'workspace';
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
    const { post_id, category, scope, project_id, client_id } = req.body;
    if (!post_id) return errorResponse(res, 'post_id_required', 400);

    const post = await Post.findOne({ where: { id: post_id, business_id: businessId } });
    if (!post) return errorResponse(res, 'post_not_found', 404);

    // post.body_text 우선 (plain), 없으면 body_html → strip
    let text = post.body_text || '';
    if (!text && post.body_html) {
      text = String(post.body_html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!text.trim()) return errorResponse(res, 'empty_post_body', 400);

    const allowedCategories = ['policy','manual','incident','faq','about','pricing'];
    const allowedScopes = ['workspace','project','client'];
    const finalCategory = allowedCategories.includes(category) ? category : 'manual';
    let finalScope = allowedScopes.includes(scope) ? scope : 'workspace';
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
router.delete('/businesses/:businessId/kb/documents/:docId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const doc = await KbDocument.findOne({
      where: { id: req.params.docId, business_id: req.params.businessId }
    });
    if (!doc) return errorResponse(res, 'Document not found', 404);

    await KbChunk.destroy({ where: { kb_document_id: doc.id } });
    await doc.destroy();

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.document_delete',
      targetType: 'KbDocument',
      targetId: doc.id
    });

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
// Pinned FAQs
// ─────────────────────────────────────────────────────────

// List pinned FAQs
router.get('/businesses/:businessId/kb/pinned', authenticateToken, checkBusinessAccess, async (req, res, next) => {
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
    await faq.destroy();
    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.pinned_faq_delete',
      targetType: 'KbPinnedFaq',
      targetId: faq.id
    });
    successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// CSV template download
router.get('/businesses/:businessId/kb/pinned/template.csv', authenticateToken, checkBusinessAccess, async (req, res) => {
  const csv = '\uFEFFquestion,answer,short_answer,keywords,category\n' +
              '"환불 정책이 어떻게 되나요?","구매 후 7일 이내에 환불을 요청하시면 전액 환불됩니다.","7일 이내 전액 환불","환불;반품;취소","정책"\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="pinned-faq-template.csv"');
  res.send(csv);
});

// Hybrid search (test endpoint)
router.post('/businesses/:businessId/kb/search', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { query, limit } = req.body;
    if (!query) return errorResponse(res, 'query required', 400);
    const result = await kbService.hybridSearch(req.params.businessId, query, { limit: limit || 5 });
    successResponse(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
