// 개인 보관함 (Personal Vault) 라우트 — 사이클 N+9 (PERSONAL_VAULT_DESIGN.md)
//
// 본인의 L1 자산 (visibility/vlevel='L1' OR scope='private') 만 노출.
// 옵션 A 정책 — 다른 멤버는 접근 불가. owner 도 본인 외엔 안 보임 (platform_admin 만 AuditLog 강제).
//
// 라우트:
//   GET  /api/personal-vault/:businessId/summary      — 4 자산 통합 카운트 + 최근 항목
//   GET  /api/personal-vault/:businessId/files        — 본인 L1 파일
//   GET  /api/personal-vault/:businessId/posts        — 본인 L1 문서
//   GET  /api/personal-vault/:businessId/kb-documents — 본인 private 지식

const express = require('express');
const path = require('path');
const { Op } = require('sequelize');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope, isMemberOrAbove } = require('../middleware/access_scope');
const { File, Post, KbDocument } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// ── 공통 filter — 본인 L1/private 만 ──
function vaultFilesWhere(scope) {
  return {
    business_id: scope.businessId,
    uploader_id: scope.userId,
    visibility: 'L1',
    deleted_at: null,
  };
}
function vaultPostsWhere(scope) {
  return {
    business_id: scope.businessId,
    author_id: scope.userId,
    vlevel: 'L1',
  };
}
function vaultKbDocsWhere(scope) {
  return {
    business_id: scope.businessId,
    uploaded_by: scope.userId,
    scope: 'private',
  };
}

// ============================================
// GET /summary — 4 자산 카운트 + 각 최근 5
// ============================================
router.get('/:businessId/summary', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const scope = req.scope;
    if (!isMemberOrAbove(scope)) {
      return errorResponse(res, 'member_only', 403);
    }
    const businessId = Number(req.params.businessId);
    const [
      fileCount, postCount, kbCount,
      recentFiles, recentPosts, recentKb,
    ] = await Promise.all([
      File.count({ where: vaultFilesWhere(scope) }),
      Post.count({ where: vaultPostsWhere(scope) }),
      KbDocument.count({ where: vaultKbDocsWhere(scope) }),
      File.findAll({
        where: vaultFilesWhere(scope),
        attributes: ['id', 'file_name', 'mime_type', 'file_size', 'created_at'],
        order: [['created_at', 'DESC']], limit: 5,
      }),
      Post.findAll({
        where: vaultPostsWhere(scope),
        attributes: ['id', 'title', 'category', 'kind', 'created_at'],
        order: [['created_at', 'DESC']], limit: 5,
      }),
      KbDocument.findAll({
        where: vaultKbDocsWhere(scope),
        attributes: ['id', 'title', 'source_type', 'created_at'],
        order: [['created_at', 'DESC']], limit: 5,
      }),
    ]);

    // 노트(Q Note 세션) 수 — 별도 FastAPI 라 프록시로 센다. 실패해도 요약은 준다.
    let noteCount = null;
    try {
      const qnoteBase = process.env.QNOTE_INTERNAL_URL || process.env.QNOTE_URL || 'http://localhost:8000';
      const rq = await fetch(qnoteBase + '/api/sessions?business_id=' + businessId + '&scope=mine&visibility=L1&limit=1&page=1', {
        headers: { Authorization: req.headers.authorization || '' },
        signal: AbortSignal.timeout(3000),
      });
      if (rq.ok) {
        // q-note 응답: { success, data: [...], pagination: { page, limit, total } }
        const jq = await rq.json();
        const total = jq && jq.pagination && jq.pagination.total;
        noteCount = Number(total != null ? total : (Array.isArray(jq && jq.data) ? jq.data.length : 0)) || 0;
      }
    } catch (e) { /* Q Note 가 내려가 있어도 보관함 요약은 뜬다 */ }

    const countsOut = { files: fileCount, posts: postCount, kb_documents: kbCount };
    if (noteCount !== null) countsOut.notes = noteCount;

    successResponse(res, {
      counts: countsOut,
      recent: {
        files: recentFiles,
        posts: recentPosts,
        kb_documents: recentKb,
      },
    });
  } catch (err) { next(err); }
});

// ============================================
// GET /files — 본인 L1 파일 list
// ============================================
router.get('/:businessId/files', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const scope = req.scope;
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'member_only', 403);

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const q = (req.query.q || '').trim();

    const where = vaultFilesWhere(scope);
    if (q) where.file_name = { [Op.like]: `%${q}%` };

    const { count, rows } = await File.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit, offset,
    });
    // 이미지면 public-image 썸네일 URL 동봉 (projects all-files 와 동일 규칙).
    // 없으면 보관함 카드가 빈 채로 렌더된다. 비이미지·외부저장(gdrive)은 생략.
    const data = rows.map((f) => {
      const isImage = f.mime_type && f.mime_type.startsWith('image/');
      const isPlanQ = f.storage_provider === 'planq' || !f.storage_provider;
      return {
        ...f.toJSON(),
        preview_url: (isImage && isPlanQ && f.file_path)
          ? `/api/files/public-image/${path.basename(f.file_path)}`
          : undefined,
      };
    });
    res.json({ success: true, data, pagination: { total: count, limit, offset } });
  } catch (err) { next(err); }
});

// ============================================
// GET /posts — 본인 L1 문서 list
// ============================================
router.get('/:businessId/posts', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const scope = req.scope;
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'member_only', 403);

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const kind = req.query.kind;

    const where = vaultPostsWhere(scope);
    if (q) where[Op.or] = [{ title: { [Op.like]: `%${q}%` } }, { content_text: { [Op.like]: `%${q}%` } }];
    if (kind && ['doc', 'table', 'brief', 'template'].includes(kind)) where.kind = kind;

    const { count, rows } = await Post.findAndCountAll({
      where,
      attributes: ['id', 'title', 'category', 'kind', 'status', 'is_pinned', 'created_at', 'updated_at', 'vlevel'],
      order: [['updated_at', 'DESC']],
      limit, offset,
    });
    res.json({ success: true, data: rows, pagination: { total: count, limit, offset } });
  } catch (err) { next(err); }
});

// ============================================
// GET /kb-documents — 본인 private 지식 list
// ============================================
router.get('/:businessId/kb-documents', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const scope = req.scope;
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'member_only', 403);

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const { count, rows } = await KbDocument.findAndCountAll({
      where: vaultKbDocsWhere(scope),
      attributes: ['id', 'title', 'source_type', 'body', 'created_at', 'updated_at'],
      order: [['updated_at', 'DESC']],
      limit, offset,
    });
    res.json({ success: true, data: rows, pagination: { total: count, limit, offset } });
  } catch (err) { next(err); }
});

// ============================================
// GET /sessions — 본인 L1 Q Note session list (사이클 N+14)
// Q Note 는 별도 SQLite. Python backend (port 8000) proxy.
// ============================================
router.get('/:businessId/sessions', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const scope = req.scope;
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'member_only', 403);

    const businessId = Number(req.params.businessId);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const page = Math.max(1, Math.ceil(((Number(req.query.offset) || 0) / limit) + 1));
    const qnoteBase = process.env.QNOTE_URL || 'http://localhost:8000';
    const authHeader = req.headers.authorization;
    if (!authHeader) return errorResponse(res, 'missing_token', 401);

    try {
      const r = await fetch(
        `${qnoteBase}/api/sessions?business_id=${businessId}&scope=mine&visibility=L1&limit=${limit}&page=${page}`,
        { headers: { Authorization: authHeader } }
      );
      if (!r.ok) {
        return successResponse(res, [], { offset: 0, limit, total: 0 });
      }
      const j = await r.json();
      return res.json({
        success: true,
        data: j.data || [],
        pagination: {
          total: j.pagination?.total || 0,
          limit, offset: (page - 1) * limit,
        },
      });
    } catch (e) {
      console.warn('[personal_vault sessions proxy]', e.message);
      return successResponse(res, [], { offset: 0, limit, total: 0 });
    }
  } catch (err) { next(err); }
});

module.exports = router;
