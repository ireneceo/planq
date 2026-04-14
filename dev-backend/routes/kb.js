// Q Talk 대화 자료 (KB) 라우터
// 내부 명칭 kb_*, 사용자 표기 "대화 자료"

const express = require('express');
const router = express.Router();
const { KbDocument, KbChunk, KbPinnedFaq } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const kbService = require('../services/kb_service');

const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner';

// ─────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────

// List documents
router.get('/businesses/:businessId/kb/documents', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const docs = await KbDocument.findAll({
      where: { business_id: req.params.businessId },
      attributes: ['id', 'title', 'source_type', 'file_name', 'file_size', 'version', 'status', 'chunk_count', 'uploaded_by', 'created_at', 'updated_at'],
      order: [['updated_at', 'DESC']]
    });
    successResponse(res, docs);
  } catch (err) { next(err); }
});

// Create document (text body) — 파일 업로드는 Phase 5.1 확장에서 multer 연결
router.post('/businesses/:businessId/kb/documents', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'Admin permission required', 403);
    const { title, body, source_type } = req.body;
    if (!title || !body) return errorResponse(res, 'title and body required', 400);

    const doc = await KbDocument.create({
      business_id: req.params.businessId,
      title: String(title).slice(0, 300),
      body: String(body),
      source_type: ['manual', 'faq', 'policy', 'pricing', 'other'].includes(source_type) ? source_type : 'manual',
      uploaded_by: req.user.id,
      status: 'pending'
    });

    // 비동기 인덱싱
    kbService.indexDocument(doc.id).catch(err => {
      console.error('[kb] indexing failed', err.message);
    });

    await createAuditLog({
      userId: req.user.id,
      businessId: req.params.businessId,
      action: 'kb.document_upload',
      targetType: 'KbDocument',
      targetId: doc.id,
      newValue: { title: doc.title, size: (body || '').length }
    });

    successResponse(res, doc, 'Document created and queued for indexing', 201);
  } catch (err) { next(err); }
});

// Get document detail + chunks
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
    successResponse(res, doc);
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
