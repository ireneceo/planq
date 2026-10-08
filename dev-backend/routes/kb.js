// Q Talk 대화 자료 (KB) 라우터
// 내부 명칭 kb_*, 사용자 표기 "대화 자료"

const express = require('express');
const router = express.Router();

// 원본 자료 읽기 권한 — Q info 가 파일·문서를 **첨부하거나 본문을 복사해 올 때**, 그리고 첨부를 **보여 줄 때**
//   같은 술어를 쓴다(2026-09-27 점검: 남의 «나만 보기» 파일·문서 본문을 Q info 로 복사해 팀에 공개할 수 있었고,
//   상세 화면은 첨부 제목·파일명을 보는 사람 권한과 무관하게 내보냈다). 파일은 imageViewer.canUserSeeFile,
//   문서는 services/postAccess.canReadPost — 각 원본의 읽기 술어 한 벌.
const canSeeSourceFile = (req, f) => require('../middleware/imageViewer').canUserSeeFile(req.user.id, req.user.platform_role, f);
const canSeeSourcePost = (req, p) => require('../services/postAccess').canReadPost(req.user, p);
const { KbDocument, KbChunk, KbPinnedFaq, KbCategory, File: FileModel, Post, KbShareBundle } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { isMemberOrAbove, getUserScope, canAccessKbDocumentByLevel, kbDocumentsListWhereByLevel } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { isValidLevel, blocksExternalShare } = require('../services/securityLevel');
const { applyMemberDisplayNameOne, getMemberDisplayName } = require('../services/displayName');

// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
function broadcastKb(req, doc, event = 'kb:updated') {
  const io = req.app.get('io');
  if (!io) return;
  // 신호만(id·소속) — 행 전체를 뿌리면 «나만 보기» 문서 본문이 멤버 전원·프로젝트 고객에게 갔다(2026-09-27 점검).
  //   받는 화면(KnowledgePage)은 id 도 안 보고 다시 읽는다.
  const data = { id: doc.id, business_id: doc.business_id, project_id: doc.project_id || null };
  if (doc.business_id) io.to(`business:${doc.business_id}`).emit(event, data);
  if (doc.project_id) io.to(`project:${doc.project_id}`).emit(event, data);
}
const { decodeOriginalName } = require('../services/filename');
const { createAuditLog } = require('../middleware/audit');
const { logAudit, auditDiff } = require('../services/auditService');
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

// N+93 — admin businessRole 포함 (옛 코드는 owner 만 봐서 워크스페이스 admin 이 삭제/reindex/pinned 차단됨).
const isAdmin = (req) =>
  req.user?.platform_role === 'platform_admin' || req.businessRole === 'owner' || req.businessRole === 'admin';

// 입력 정규화 헬퍼 — services/kbFields 한 벌(행동 계층 kb_actions 와 같이 쓴다)
const {
  sanitizeCategories, pickLegacyCategoryEnum,
  normalizeCandidateFields, synthesizeBodyFromColumns, upsertKbCategories, resolveVisibility,
} = require('../services/kbFields');

// ─────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────

// List documents
router.get('/businesses/:businessId/kb/documents', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const { Op } = require('sequelize');
    const { sequelize } = require('../config/database');
    const { ProjectMember } = require('../models');
    const businessId = parseInt(req.params.businessId, 10);
    // 사이클 G — 카테고리/스코프 필터 (옵션)
    const where = { business_id: businessId };
    const allowedCats = ['policy','manual','incident','faq','about','pricing'];
    if (req.query.category && allowedCats.includes(req.query.category)) {
      where.category = req.query.category;
    }
    if (req.query.scope && ['private','workspace','project','client'].includes(req.query.scope)) {
      where.scope = req.query.scope;
    }
    if (req.query.project_id) where.project_id = parseInt(req.query.project_id, 10) || null;
    if (req.query.client_id) where.client_id = parseInt(req.query.client_id, 10) || null;
    // #364 — 검색어 조합형 통일 (저장측 NFC 와 같은 축)
    if (req.query.q) where.title = { [Op.like]: `%${String(req.query.q).normalize('NFC').slice(0, 80)}%` };

    // 권한 — 읽기 술어 **한 벌**(access_scope.kbDocumentsListWhereByLevel). 상세·공유·검색·Cue 가 같은 함수를 쓴다.
    //   (2026-09-27 전에는 여기 인라인·상세 인라인·access_scope 세 벌이 서로 달랐다.)
    {
      const kbScope = await getUserScope(req.user.id, Number(req.params.businessId), req.user.platform_role);
      where[Op.and] = [...(where[Op.and] || []), kbDocumentsListWhereByLevel(kbScope)];
    }

    // 자동 색인된 파일 본문은 **목록에 넣지 않는다.** Cue 가 내용으로 찾으라고 넣어 둔 것이지
    //   사람이 관리할 자료가 아니다 — 섞으면 Q info 가 파일 수백 건으로 도배된다.
    //   사람이 직접 보낸 "파일 → Q info" 는 이 표식이 없으므로 그대로 보인다.
    //   보고 싶으면 ?include_auto=1.
    if (String(req.query.include_auto || '') !== '1') {
      const hideAuto = sequelize.literal("(JSON_EXTRACT(custom_values, '$.auto_indexed') IS NULL OR JSON_EXTRACT(custom_values, '$.auto_indexed') <> true)");
      if (Array.isArray(where[Op.and])) where[Op.and].push(hideAuto);
      else where[Op.and] = [hideAuto];
    }

    // 사이클 N+50 — SaaS readiness cap
    const rawLimit = Number(req.query.limit);
    const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : 1000;
    let docs = await KbDocument.findAll({
      where,
      attributes: ['id', 'title', 'source_type', 'category', 'categories', 'scope', 'project_id', 'client_id', 'file_name', 'file_size', 'version', 'status', 'chunk_count', 'uploaded_by', 'tags', 'attached_file_ids', 'attached_post_ids', 'custom_columns', 'custom_values', 'read_policy', 'client_ids', 'vlevel', 'target_member_ids', 'security_level', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],   // 작성일 순(2026-10-06) — 캡(limit)에 걸려도 «최근에 고친 옛 글» 이 새 글을 밀어내지 않게
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
  // audit-exempt: 감사는 행동 계층이 쓴다(kb.document_create)
  // 규칙은 행동 계층 한 곳(services/actions/kb_actions.createDocument) — AI 에이전트 create_knowledge_item 과 같은 함수.
  //   감사(kb.document_create)·실시간(kb:new)·색인도 그 함수가 한다. 라우트는 파싱·응답만.
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const { createDocument } = require('../services/actions/kb_actions');
    const r = await createDocument({ kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req },
      { businessId: parseInt(req.params.businessId, 10), input: req.body || {} });
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);
    successResponse(res, r.data, 'Document created and queued for indexing', 201);
  } catch (err) { next(err); }
});

// ─── 파일 직접 업로드 → Knowledge ingest ──────────────────────────────
// "새 지식 등록 → 파일 업로드" 탭. multipart 로 파일 1개 받아 텍스트 추출 + 즉시 인덱싱.
// 사이클 P1 (재구성).
router.post('/businesses/:businessId/kb/documents/upload', // audit-exempt: 감사는 아래 본 핸들러의 createAuditLog(kb.document_upload) 가 쓴다 — 첫 화살표는 업로드 미들웨어
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
    if (!(await canSeeSourceFile(req, file))) return errorResponse(res, 'file_not_found', 404);

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
// PostsPage 의 "Q info 로 보내기" 메뉴에서 호출.
router.post('/businesses/:businessId/kb/documents/import-from-post', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const { post_id, category, categories, scope, project_id, client_id } = req.body;
    if (!post_id) return errorResponse(res, 'post_id_required', 400);

    const post = await Post.findOne({ where: { id: post_id, business_id: businessId } });
    if (!post) return errorResponse(res, 'post_not_found', 404);
    if (!(await canSeeSourcePost(req, post))) return errorResponse(res, 'post_not_found', 404);

    // N+72-7 fix — 실제 컬럼명 `content_text` / `content_json` 사용 (옛: body_text/body_html 오참조 → 항상 empty_post_body 회귀).
    // ★ #234 — **content_json 을 먼저 본다.** posts.js 가 저장하는 `content_text` 는 검색/프리뷰용이라
    //   블록을 ' ' 로 잇고 `\s+ → ' '` 로 평탄화한 물건이다. 그걸 우선 쓰던 탓에 인포로 보낸 문서가
    //   한 문단으로 "다닥다닥 붙어" 보였다(개행이 애초에 남아있지 않았다).
    //   구조가 살아있는 content_json 에서 문단을 복원하고, 없을 때만 content_text 로 물러선다.
    // 문단·제목·인용·코드블록은 문단 경계(빈 줄), 리스트 항목은 줄바꿈 하나.
    // 아래 HTML 변환이 빈 줄을 <p> 분리로, 단일 개행을 <br/> 로 옮긴다.
    const PARA = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock']);
    const LINE = new Set(['listItem', 'taskItem']);
    const extractText = (node) => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (Array.isArray(node)) return node.map(extractText).join('');
      if (node.type === 'hardBreak') return '\n';
      if (node.text) return node.text;
      const inner = Array.isArray(node.content) ? node.content.map(extractText).join('') : '';
      if (PARA.has(node.type)) return `${inner}\n\n`;
      if (LINE.has(node.type)) return `${inner}\n`;
      return inner;
    };
    let text = '';
    if (post.content_json) {
      try {
        const json = typeof post.content_json === 'string' ? JSON.parse(post.content_json) : post.content_json;
        text = extractText(json).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      } catch { /* JSON parse fail — content_text 로 폴백 */ }
    }
    if (!text) text = (post.content_text || '').trim();
    if (!text) return errorResponse(res, '본문이 비어있어 Q info 에 보낼 수 없습니다.', 400);

    // #284 — AI 항목 분리로 보내려면 프론트가 **본문 평문**을 알아야 한다.
    //   그 추출 규칙(content_json → 문단 복원)은 위에 한 벌뿐이고, 프론트에 베끼면 반드시 갈라진다
    //   (#234 가 정확히 그 계열의 사고였다). 그래서 같은 자리에서 텍스트만 돌려주는 문을 낸다.
    //   저장은 하지 않는다 — 사용자가 AI 추출 결과를 확인한 뒤 batch 로 저장한다.
    if (req.body.extract_only) {
      return successResponse(res, { text, title: post.title || '', project_id: post.project_id || null });
    }

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

    // ★ #234 — KbDocument.body 는 프론트에서 **RichEditor(HTML)** 로 렌더된다. 평문을 그대로 넣으면
    //   Tiptap 이 개행을 무시하고 한 문단으로 합쳐 "내용이 다닥다닥 붙는다"(사용자 보고).
    //   빈 줄 = 문단 분리, 단일 개행 = <br> 로 옮겨 원문의 줄 구조를 보존한다.
    const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bodyHtml = /<[a-z][\s\S]*>/i.test(text)
      ? text
      : text.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br/>')}</p>`).join('');

    const doc = await KbDocument.create({
      business_id: businessId,
      title: String(post.title || `Post #${post.id}`).slice(0, 300),
      body: bodyHtml,
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
    // 권한 — 목록과 **같은 함수**(access_scope.canAccessKbDocumentByLevel).
    {
      const kbScope = await getUserScope(req.user.id, doc.business_id, req.user.platform_role);
      if (!(await canAccessKbDocumentByLevel(req.user.id, doc, kbScope))) return errorResponse(res, 'forbidden', 403);
    }

    const result = doc.toJSON();
    // 첨부 파일 메타 (다운로드 가능)
    if (Array.isArray(doc.attached_file_ids) && doc.attached_file_ids.length > 0) {
      const files = await FileModel.findAll({ where: { id: doc.attached_file_ids, business_id: req.params.businessId } });
      // 보는 사람 기준 — 못 보는 파일은 이름도 내지 않는다(2026-09-27 점검)
      const pick = (f) => ({ id: f.id, file_name: f.file_name, file_size: f.file_size, mime_type: f.mime_type, storage_provider: f.storage_provider, external_url: f.external_url });
      result.attached_files = [];
      for (const f of files) if (await canSeeSourceFile(req, f)) result.attached_files.push(pick(f));
    } else {
      result.attached_files = [];
    }
    // 첨부 문서 (post) 메타 (열기 가능)
    if (Array.isArray(doc.attached_post_ids) && doc.attached_post_ids.length > 0) {
      const posts = await Post.findAll({ where: { id: doc.attached_post_ids, business_id: req.params.businessId } });
      result.attached_posts = [];
      for (const p of posts) if (await canSeeSourcePost(req, p)) result.attached_posts.push({ id: p.id, title: p.title, project_id: p.project_id, category: p.category });
    } else {
      result.attached_posts = [];
    }

    // #284 ⑤ — "연결된 자료나 문서들도 오픈해서 보기 수월하고".
    //   출처(source_post_id/source_file_id)는 batch 인제스트(:1444)가 **기록만** 하고
    //   화면이 한 번도 읽은 적이 없었다. id 만으로는 제목을 못 그려 열 수도 없다 —
    //   첨부와 같은 방식으로 메타를 같이 내려 "어디서 왔는지" 를 눌러서 열 수 있게 한다.
    //   ★ business_id 를 같이 걸어 다른 워크스페이스 출처가 새지 않게 한다(기록 시점 검증과 이중).
    result.source_post = null;
    result.source_file = null;
    if (doc.source_post_id) {
      const sp = await Post.findOne({ where: { id: doc.source_post_id, business_id: req.params.businessId } });
      result.source_post = sp && await canSeeSourcePost(req, sp) ? { id: sp.id, title: sp.title, project_id: sp.project_id, category: sp.category } : null;
    }
    if (doc.source_file_id) {
      const sf = await FileModel.findOne({ where: { id: doc.source_file_id, business_id: req.params.businessId, deleted_at: null } });
      result.source_file = sf && await canSeeSourceFile(req, sf)
        ? { id: sf.id, file_name: sf.file_name, file_size: sf.file_size, mime_type: sf.mime_type, storage_provider: sf.storage_provider, external_url: sf.external_url }
        : null;
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
    // 못 보는 문서는 고치지도 못한다 — 멤버가 남의 «나만 보기»(L1) 문서를 L3 로 넓힐 수 있었다(2026-09-27 점검).
    {
      const kbScope = await getUserScope(req.user.id, doc.business_id, req.user.platform_role);
      if (!(await canAccessKbDocumentByLevel(req.user.id, doc, kbScope))) return errorResponse(res, 'Document not found', 404);
    }

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
      if (vUpd.vlevel === 'L4' && blocksExternalShare(doc)) {
        return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
      }
      // 좁히면(L1·L2) 이미 나간 링크를 끊는다 — 달력과 같은 규칙(services/share_helper.shareOffPatch).
      {
        const sh = require('../services/share_helper');
        if (sh.narrowsShare(vUpd.vlevel)) Object.assign(patch, sh.shareOffPatch(doc));
      }
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
    // #408 — **지우려면 지우라고 말해야 한다.**
    //   위가 머지라서 키를 빼고 보내는 것으로는 값이 안 지워진다. 그 성질 덕분에 실수로
    //   지운 값이 살아남아 복구할 수 있었지만(운영 doc#36), 반대로 "완전 삭제" 를 표현할
    //   방법이 아예 없었다. 지울 키를 명시적으로 받는다.
    if (Array.isArray(req.body.custom_values_unset) && req.body.custom_values_unset.length) {
      const base = (patch.custom_values && typeof patch.custom_values === 'object')
        ? { ...patch.custom_values }
        : ((doc.custom_values && typeof doc.custom_values === 'object') ? { ...doc.custom_values } : {});
      for (const key of req.body.custom_values_unset.slice(0, 50)) {
        if (typeof key === 'string') delete base[key];
      }
      patch.custom_values = base;
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
      // 새로 붙이는 파일은 붙이는 사람이 볼 수 있어야 한다(이미 붙어 있던 것은 그대로 둔다).
      const prevF = new Set((doc.attached_file_ids || []).map(Number));
      const addF = (patch.attached_file_ids || []).filter((id) => !prevF.has(id));
      for (const f of (addF.length ? await FileModel.findAll({ where: { id: addF, business_id: doc.business_id } }) : [])) {
        if (!(await canSeeSourceFile(req, f))) return errorResponse(res, 'file_not_found', 404);
      }
    }
    if (req.body.attached_post_ids !== undefined) {
      patch.attached_post_ids = Array.isArray(req.body.attached_post_ids)
        ? req.body.attached_post_ids.map(Number).filter(Boolean) : null;
      const prevP = new Set((doc.attached_post_ids || []).map(Number));
      const addP = (patch.attached_post_ids || []).filter((id) => !prevP.has(id));
      for (const p of (addP.length ? await Post.findAll({ where: { id: addP, business_id: doc.business_id } }) : [])) {
        if (!(await canSeeSourcePost(req, p))) return errorResponse(res, 'post_not_found', 404);
      }
    }
    // #408 — 항목을 지웠는데 **그 값이 본문에 남아 있었다.**
    //   생성 때 본문이 비어 있으면 서버가 항목들로 본문을 합성해 둔다(#332). 그 본문은
    //   공개 공유 응답과 검색 색인으로 나가므로, 항목만 지우면 화면에서는 사라지는데
    //   본문에는 그대로 남아 계속 노출된다(2026-09-09 실측 — 공개 응답 body 에서 확인).
    //   ★ 사용자가 직접 고친 본문은 건드리지 않는다. **지금 본문이 옛 항목들의 합성 결과와
    //     글자까지 같을 때만** = 기계가 만들고 아무도 손대지 않았을 때만 다시 계산한다.
    //   ★ 본문이 바뀌면 색인도 다시 만든다 — 안 그러면 검색에는 지운 값이 계속 산다.
    let bodyResynced = false;
    if (patch.body === undefined
        && (patch.custom_columns !== undefined || patch.custom_values !== undefined)) {
      const prevSynth = synthesizeBodyFromColumns(doc.title, doc.custom_columns, doc.custom_values);
      if (prevSynth && String(doc.body || '') === prevSynth) {
        const nextTitle = (patch.title !== undefined) ? patch.title : doc.title;
        const nextCols = (patch.custom_columns !== undefined) ? patch.custom_columns : doc.custom_columns;
        const nextVals = (patch.custom_values !== undefined) ? patch.custom_values : doc.custom_values;
        // 항목이 다 지워졌으면 제목만 남긴다 — 본문을 빈 값으로 만들면 색인할 것이 사라진다.
        const nextBody = synthesizeBodyFromColumns(nextTitle, nextCols, nextVals) || String(nextTitle || '').trim();
        if (nextBody && nextBody !== String(doc.body || '')) { patch.body = nextBody; bodyResynced = true; }
      }
    }
    await doc.update(patch);
    if (bodyResynced) {
      kbService.indexDocument(doc.id).catch(err => {
        console.error('[kb] resync reindex failed', doc.id, err.message);
      });
    }
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
    const doc = await KbDocument.findOne({
      where: { id: req.params.docId, business_id: req.params.businessId }
    });
    if (!doc) return errorResponse(res, 'Document not found', 404);
    // N+93 — owner/admin 은 항상, 일반 멤버는 본인이 올린 문서만 삭제 가능 (작성자 정정용).
    if (!isAdmin(req) && doc.uploaded_by !== req.user.id) {
      return errorResponse(res, 'forbidden_delete — owner/admin 또는 작성자만 삭제할 수 있습니다.', 403);
    }

    // ★ 청크는 여기서 지우지 않는다. 여긴 **휴지통행**이지 영구삭제가 아니다.
    //   지워 버리면 복원해도 검색에 안 걸리는 껍데기 문서가 된다 — 사용자에게는 복원이 실패한 것과 같다.
    //   휴지통에 있는 동안 검색에 새지도 않는다: 청크 조회가 KbDocument(paranoid)를
    //   `required: true` 로 조인하므로 soft delete 된 문서의 청크는 자동으로 빠진다
    //   (services/kb_service.js). 실제 제거는 영구삭제 경로(routes/content_trash.js)가 한다.
    // 휴지통 보관 만료일을 삭제 시점에 박는다 — 화면이 이 날짜를 보여주므로 나중에
    //   플랜이 낮아져도 앞당기지 않는다(retentionPolicy 래칫 업). 못 읽으면 NULL.
    try {
      const { stampFor } = require('../services/retentionPolicy');
      const pa = await stampFor(doc.business_id, 'trash');
      if (pa) await doc.update({ purge_after: pa });
    } catch { /* 스탬프 실패가 삭제를 막지 않는다 */ }
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
router.post('/businesses/:businessId/kb/documents/:docId/reindex', authenticateToken, checkBusinessAccess, async (req, res, next) => { // audit-exempt: 검색 색인(파생값) 재생성 — 문서 내용은 바뀌지 않는다
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
    if (created) logAudit(req, { businessId, action: 'kb.category_create', targetType: 'kb_category', targetId: row.id, newValue: { name: row.name } });
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
    const catBefore = row.get({ plain: true, clone: true });
    await row.update(patch);
    const catDiff = auditDiff(catBefore, row.get({ plain: true }), Object.keys(patch));
    if (catDiff) logAudit(req, { businessId, action: 'kb.category_update', targetType: 'kb_category', targetId: row.id, ...catDiff });
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
    logAudit(req, { businessId, action: 'kb.category_delete', targetType: 'kb_category', targetId: row.id, oldValue: { name: snap.name } });
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

// LLM 호출은 게이트웨이 단일 지점을 지난다 (services/llm.js).
const { callLLM, isEnabled } = require('../services/llm');

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
4. 카테고리: **아래 '사용 가능한 카테고리' 목록에서만 고른다.** 목록에 없는 이름을 지어내지 말 것.
   애매하면 목록 중 가장 가까운 것을 고르고, 정말 아무것도 안 맞을 때만 목록의 첫 번째를 쓴다.
   ★ categories 는 **반드시 채운다.** 비우거나 생략하면 화면에 분류가 안 뜬다.
5. 태그 2~6개 추출 (원문 키워드만). 자격증명이면 ["서비스명","자격증명","연락처"] 같이.
6. title: 원문 첫 줄 또는 핵심 명사구. 50자 이내. 예: "기율법무법인 링크드인 계정" "Mary 전화번호".
7. body: 원문 그대로 (오타/공백만 정리). 줄바꿈 \\n 그대로 유지.

8. **뒤에 다시 찾아 쓸 값은 body 에 묻지 말고 반드시 fields 로 뺀다** (운영 신고 2026-09-03 · 2026-09-07).
   Q info 는 읽는 글이 아니라 **찾아 쓰는 DB** 다. 값이 문장 속에 있으면 나중에 못 찾는다.
   fields 로 빼야 하는 것 — 원문에 있는 것만:
     · 연락 수단: URL·이메일·전화번호·주소·담당자·계정 ID
     · **금액·단가·비용** ("RM 350", "1,200,000원", "페이지당 30"), 통화 기호·단위 그대로
     · **수량·규격·기간** ("3~5년", "최근 6~12개월", "A4 10페이지", "2일 이내")
     · **기한·날짜·조건** ("7일 이내 전액 환불", "매월 15일")
   이름은 원문에 쓰인 말 그대로 쓴다("블로그", "대표번호", "담당자", "가격", "기간", "환불 기한").
   예: {"fields": {"블로그": "https://blog.naver.com/kalis001"}}
   예: {"title": "Vin Design 회사소개서 디자인", "fields": {"가격": "RM 1,500", "분량": "12페이지"}}
   ★ **fields 가 하나도 없는 항목은 의심하라.** 가격표·체크리스트·연락처처럼 값이 있는 원문인데
     fields 가 비어 있으면 값을 body 에 묻은 것이다. 값이 정말 없을 때만 fields 를 비운다.
     (2026-09-07 실측 사고: 서비스 가격표 14항목을 뽑았는데 **fields 가 전부 0개** 라 가격이
      전부 문장 속에 묻혔다. 나중에 "그 디자인 얼마였지" 를 못 찾는다.)

9. **한 줄에 하나씩 나열된 목록은 줄마다 다른 항목이다.**
   "-A 블로그: https://... / -B 블로그: https://..." 처럼 **서로 다른 대상**이 각자의 값을 갖고
   나열되면 **대상 수만큼 항목을 만든다.** 하나로 합치고 링크 두 개를 body 에 넣는 것은 오답이다.
   (실제 사고: 변호사 두 곳의 블로그 주소를 한 항목으로 뭉쳐 링크가 본문에 묻혔다.)
   반대로 **같은 대상의 여러 속성**(한 서비스의 ID·비밀번호·URL)은 1개 항목 + fields 여러 개다.
   기준은 "나중에 이걸 따로 찾을 일이 있는가" — 따로 찾을 것이면 따로 만든다.

9-1. **한 항목의 body 안에 같은 종류의 값이 2개 이상 있으면 그것은 여러 항목이다.**
   가격이 두 개 이상, 전화번호가 두 개 이상, 주소가 두 개 이상 — 전부 쪼개라.
   특히 **가격표·요금표**는 줄(또는 규격)마다 한 항목이다. 업체·규격·옵션이 다르면 다른 항목이다.
   (2026-09-07 실측 사고: "인쇄물 디자인 – 페이지당 가격 정리" 한 항목에 업체 3곳 · 가격 10개 이상이
    669자 body 로 뭉쳐 들어갔다. 그 안의 "A4 8페이지 RM 500" 을 나중에 찾을 방법이 없다.
    올바른 결과는 업체×규격마다 항목 1개 + fields{가격, 규격, 업체} 다.)
   ★ **규격·옵션마다 가격이 따로면 규격마다 항목이다.** "A4 4페이지 RM 350 / A4 8페이지 RM 500"
     은 두 항목이다(제목에 업체와 규격을 같이 적어 구별한다: "Vin Design 회사소개서 A4 8페이지",
     fields{가격: "RM 500", 규격: "A4 8페이지", 업체: "Vin Design"}).
     한 항목의 body 에 "RM" 이 두 번 이상 보이면 아직 덜 쪼갠 것이다.
   ★ **실패 예시 그대로 보여준다** (2026-09-07 실측). 원문:
       "Vin Design – 회사소개서 디자인
        A4/A5 4페이지: 디자인 RM 350 → RM 87.5/페이지
        A4 8페이지: RM 500 → RM 62.5/페이지
        A3 롱(6페이지): RM 500 → RM 83.3/페이지"
     ✗ 틀린 결과 — 1개 항목 {title:"Vin Design 회사소개서 디자인", body:"…RM 350…RM 500…RM 500…"}
     ✓ 맞는 결과 — 3개 항목:
       {title:"Vin Design 회사소개서 A4/A5 4페이지", fields:{업체:"Vin Design", 규격:"A4/A5 4페이지", 가격:"RM 350", 페이지당:"RM 87.5"}}
       {title:"Vin Design 회사소개서 A4 8페이지",   fields:{업체:"Vin Design", 규격:"A4 8페이지",   가격:"RM 500", 페이지당:"RM 62.5"}}
       {title:"Vin Design 회사소개서 A3 롱(6페이지)", fields:{업체:"Vin Design", 규격:"A3 롱(6페이지)", 가격:"RM 500", 페이지당:"RM 83.3"}}
   ★ 소제목("🖨 인쇄물 디자인 – 페이지당 가격 정리")은 **항목이 아니라 묶음 이름**이다.
     소제목만으로 항목을 만들지 말고, 그 아래 각 줄로 항목을 만들되 제목에 묶음 이름을 붙여
     구별되게 한다(예: "Vin Design 회사소개서 A4 8페이지").

답변 형식 — **반드시 다음 중 하나**:
- 단일 항목이면: { "items": [{ "title": "...", "body": "...", "categories": ["manual"], "tags": [...], "fields": { "블로그": "https://..." } }] }
- 다중 항목이면: { "items": [{ ... }, { ... }] }
- 절대 빈 items 반환 금지. 텍스트가 한 줄이라도 의미 있으면 1개 항목으로 추출.
- 다른 설명 X. JSON 만.`;

// 워크스페이스에 등록된 카테고리를 프롬프트에 실어 준다.
//   ★ 여태 legacy 6종을 프롬프트에 박아 놨다 — 사용자가 만든 카테고리를 AI 가 알 길이 없어
//     "카테고리 등록된대로 안 떠" 가 났다(Irene 2026-09-03). 마스터를 읽어 넣는다.
const LEGACY_KB_CATEGORIES = ['policy', 'manual', 'incident', 'faq', 'about', 'pricing'];
async function buildIngestPrompt(businessId) {
  let names = [];
  try {
    const rows = await KbCategory.findAll({
      where: { business_id: businessId },
      attributes: ['name'], order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    names = rows.map((r) => r.name).filter(Boolean);
  } catch (e) { console.warn('[kb/ai-ingest] 카테고리 마스터 조회 실패', e.message); }
  if (!names.length) names = LEGACY_KB_CATEGORIES;   // 아직 하나도 안 만들었으면 기본 6종
  return `${SYSTEM_PROMPT_INGEST}

## 사용 가능한 카테고리 (이 목록에서만 고를 것)
${names.map((n) => `- ${n}`).join('\n')}`;
}

router.post('/businesses/:businessId/kb/ai-ingest', authenticateToken, checkBusinessAccess, async (req, res, next) => { // audit-exempt: 후보만 돌려주고 저장하지 않는다(저장은 documents/batch 가 기록 · 사용량은 cue_usage)
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const { text, source_language, source_title } = req.body || {};
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

    if (!isEnabled()) {
      return errorResponse(res, 'openai_key_missing', 503);
    }

    // ★ 2026-09-07 — 출처 문서의 **제목을 맥락으로 준다** (Irene: "문서 상세를 보고 인포 만들어야지").
    //   프론트가 서버가 돌려준 title 을 버리고 본문만 보내고 있었다. 제목은 그 글이 무엇에 관한
    //   것인지 말하는 가장 짧은 단서라, 없으면 분류·항목명이 헛나간다.
    //   ★ 제목을 **본문으로 쓰지 않는다** — 원문 보존 원칙(규칙 1)을 지키려면 맥락과 내용을 가른다.
    const titleHint = String(source_title || '').trim().slice(0, 200);
    const messages = [
      { role: 'system', content: await buildIngestPrompt(businessId) },
      {
        role: 'user',
        content: `[입력 언어 힌트: ${source_language || 'auto'}]`
          + (titleHint ? `\n[출처 문서 제목: ${titleHint}] — 분류·항목명을 정할 때 참고만 하고, 본문에 없는 내용을 만들지 마.` : '')
          + `\n\n${cleanText}`,
      },
    ];

    // kb_extract — 원문 보존이 핵심이라 temperature 0.1 (레지스트리 값). 옛 호출부엔 타임아웃이
    //   아예 없었다 → 게이트웨이가 45s 를 건다 (OpenAI hang 시 요청이 영영 안 끝나던 구멍).
    const { content: raw, fallback, input_tokens, output_tokens } = await callLLM({
      purpose: 'kb_extract',
      messages,
      json: true,
      fallback: '',
    });
    if (fallback) return errorResponse(res, 'llm_error', 502);
    const content = (raw || '').trim();
    const llmUsage = { prompt_tokens: input_tokens, completion_tokens: output_tokens };

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

    // 후보 정규화.
    //   #316 — **항목(custom_columns/custom_values)을 통과시킨다.** 여태 title/body/category/tags 4개만
    //          남겨서, 표형 자료를 넣어도 항목이 만들어지지 않고 body 덩어리로 뭉쳤다.
    //   #320 — 카테고리를 legacy ENUM 6종으로 강제하지 않는다(자유 문자열 40자). 저장 시 마스터 upsert.
    // ★ 2026-09-07 — 20 → 60. 가격표·체크리스트를 **줄 단위로 쪼개라** 고 프롬프트를 조인 결과
    //   한 문서에서 나오는 항목 수가 늘었다. 상한이 20 이면 조인 만큼 조용히 잘린다
    //   (잘린 사실은 truncated 로 알리지만, 사용자는 "왜 일부만 들어왔지" 를 겪는다).
    //   60 은 화면 검수(사용자가 하나씩 확인)로도 감당되는 상한이고, 저장은 batch 한 번이다.
    const AI_MAX = 60;
    const parsedTotal = candidates.filter(c => c && typeof c === 'object' && c.title).length;
    const normalized = candidates
      // body 없이 항목만 있는 후보도 살린다 (#332 와 같은 이유 — 항목 위주 자료가 핵심 용도)
      .filter(c => c && typeof c === 'object' && c.title && (c.body || c.custom_values || c.fields))
      .map(c => {
        const { columns, values } = normalizeCandidateFields(c);
        return {
          title: String(c.title).slice(0, 300),
          body: c.body ? String(c.body).slice(0, 50000) : '',
          categories: sanitizeCategories(c.categories) ?? (c.category ? [String(c.category).trim().slice(0, 40)] : []),
          tags: Array.isArray(c.tags) ? c.tags.slice(0, 8).map(String) : [],
          custom_columns: columns.length ? columns : null,
          custom_values: columns.length ? values : null,
        };
      })
      .slice(0, AI_MAX);

    // cue_usage 차감
    try { await planEngine.consume(businessId, 'cue', 1); } catch { /* noop */ }

    // #322 — 잘렸으면 **잘렸다고 알린다.** 여태 조용히 slice 해서 사용자가 나중에 발견했다.
    return successResponse(res, {
      candidates: normalized,
      total_parsed: parsedTotal,
      returned: normalized.length,
      truncated: parsedTotal > normalized.length,
      limit: AI_MAX,
      llm_usage: llmUsage,
    });
  } catch (err) { next(err); }
});

// ─── CSV Ingest — 파싱 후 후보 반환 (저장 X) ───
router.post('/businesses/:businessId/kb/csv-ingest', authenticateToken, checkBusinessAccess, async (req, res, next) => { // audit-exempt: 파싱한 후보만 돌려주고 저장하지 않는다(저장은 documents/batch 가 기록)
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string') return errorResponse(res, 'csv_required', 400);

    // 단순 CSV 파서 — 따옴표·쉼표·개행 처리
    const rows = parseCsv(String(csv).trim());
    if (rows.length < 2) return errorResponse(res, 'csv_empty_or_no_header', 400);

    const rawHeader = rows[0].map(h => String(h == null ? '' : h).trim());
    const header = rawHeader.map(h => h.toLowerCase());

    // #319 — 예약 열(title/body/category/tags/…) 외의 **남은 열은 전부 항목(custom_columns)** 이 된다.
    //   여태 title·body 두 열만 읽고 나머지를 조용히 버려서,
    //   "서비스명, 링크, 아이디, 비밀번호, 분류, 라이선스, 비고" 같은 실제 업무 CSV 를 못 올렸다.
    //   필수 열도 **title 하나로 완화**한다(없으면 첫 열을 제목으로). body 는 선택.
    const RESERVED = new Set(['title', 'body', 'category', 'categories', 'tags', 'source_language', 'auto_translate']);
    let titleIdx = header.indexOf('title');
    if (titleIdx < 0) titleIdx = 0;                       // 제목 열이 없으면 첫 열을 제목으로
    const bodyIdx = header.indexOf('body');
    const catIdx = header.indexOf('category');
    const catsIdx = header.indexOf('categories');
    const tagsIdx = header.indexOf('tags');
    const langIdx = header.indexOf('source_language');
    const transIdx = header.indexOf('auto_translate');
    const fieldIdxs = header
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => i !== titleIdx && !RESERVED.has(h) && rawHeader[i])
      .slice(0, 30);

    const CSV_MAX = 500;
    const dataRows = rows.slice(1).filter(r => r && String(r[titleIdx] || '').trim());
    const candidates = dataRows
      .slice(0, CSV_MAX)
      .map(r => {
        const fields = {};
        for (const { i } of fieldIdxs) {
          const v = r[i];
          if (v == null || String(v).trim() === '') continue;
          fields[rawHeader[i]] = String(v);
        }
        const { columns, values } = normalizeCandidateFields({ fields });
        const catCell = catsIdx >= 0 ? r[catsIdx] : (catIdx >= 0 ? r[catIdx] : null);
        return {
          title: String(r[titleIdx] || '').slice(0, 300),
          body: bodyIdx >= 0 ? String(r[bodyIdx] || '').slice(0, 50000) : '',
          // #320 — legacy ENUM 강제 폐기. 사용자 카테고리를 그대로 살린다(쉼표 다중 허용).
          categories: sanitizeCategories(
            catCell ? String(catCell).split(',').map(x => x.trim()).filter(Boolean) : null,
          ) ?? [],
          tags: r[tagsIdx] ? String(r[tagsIdx]).split(',').map(s => s.trim()).filter(Boolean).slice(0, 8) : [],
          source_language: r[langIdx] === 'en' ? 'en' : 'ko',
          auto_translate: r[transIdx] !== 'false',
          custom_columns: columns.length ? columns : null,
          custom_values: columns.length ? values : null,
        };
      });

    // #322 — 잘렸으면 알린다.
    return successResponse(res, {
      candidates,
      total_parsed: dataRows.length,
      returned: candidates.length,
      truncated: dataRows.length > candidates.length,
      limit: CSV_MAX,
      field_columns: fieldIdxs.map(({ i }) => rawHeader[i]),   // 미리보기에서 "이 열들이 항목이 됩니다" 안내용
    });
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

    // #284 — "문서나 다른 곳에서 info로 보내면 해당 문서나 파일 자료들이 연결되어 있으면 좋겠는데
    //   서로 관련된 자료인걸 알고 참고하게." 출처를 항목마다 남긴다.
    //   ★ 남의 워크스페이스 글/파일을 출처로 위조할 수 없게 **소유권을 먼저 확인**한다 —
    //     확인 없이 body 값을 그대로 쓰면 다른 워크스페이스 id 가 그대로 박힌다.
    let srcPostId = null;
    let srcFileId = null;
    if (req.body?.source_post_id) {
      const p = await Post.findOne({
        where: { id: parseInt(req.body.source_post_id, 10) || 0, business_id: businessId },
        attributes: ['id'],
      });
      srcPostId = p ? p.id : null;
    }
    if (req.body?.source_file_id) {
      const f = await FileModel.findOne({
        where: { id: parseInt(req.body.source_file_id, 10) || 0, business_id: businessId, deleted_at: null },
        attributes: ['id'],
      });
      srcFileId = f ? f.id : null;
    }
    if (items.length > 500) return errorResponse(res, 'too_many_items', 400);

    const ALLOWED_SCOPE = ['private','workspace','project','client'];
    const ALLOWED_VIS = ['translate','show_original','hide_other'];
    const finalScope = ALLOWED_SCOPE.includes(scope) ? scope : (project_id ? 'project' : (client_id ? 'client' : 'private'));
    const finalAutoTranslate = auto_translate !== false;
    const finalVisibility = ALLOWED_VIS.includes(translation_visibility) ? translation_visibility : 'translate';

    // #321 — 중복 검사. 여태 무조건 create 라 같은 CSV 를 두 번 올리면 그대로 2배가 됐다.
    //   기본 키는 **제목**(+ 같은 워크스페이스). on_duplicate: 'create'(기본·종전동작) | 'skip' | 'update'
    const DUP_MODES = ['create', 'skip', 'update'];
    const dupMode = DUP_MODES.includes(req.body?.on_duplicate) ? req.body.on_duplicate : 'create';
    let existingByTitle = new Map();
    if (dupMode !== 'create') {
      const titles = items.map(it => String(it?.title || '').slice(0, 300)).filter(Boolean);
      if (titles.length) {
        const rows = await KbDocument.findAll({
          where: { business_id: businessId, title: titles },
          attributes: ['id', 'title'],
        });
        existingByTitle = new Map(rows.map(r => [r.title, r.id]));
      }
    }

    const created = [];
    const skipped = [];
    const updated = [];
    const errors = [];

    // 다중 포스트 분리 식별 — items.length > 1 이면 첫 ID 가 parent_doc_id (자기참조 + 나머지)
    let parentDocId = null;

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      try {
        const title = String(it.title || '').slice(0, 300);
        if (!title) { errors.push({ index: idx, error: 'title_required' }); continue; }

        // #321 — 중복 처리
        const dupId = existingByTitle.get(title);
        if (dupId && dupMode === 'skip') { skipped.push({ index: idx, title, existing_id: dupId }); continue; }

        // #320 — 사용자 카테고리를 살린다. 여태 legacy ENUM 6종으로 뭉개 사실상 전부 'manual' 이 됐다.
        const itemCats = sanitizeCategories(it.categories)
          ?? (it.category ? [String(it.category).trim().slice(0, 40)] : []);
        const finalCategories = itemCats.length > 0 ? itemCats : ['manual'];
        const cat = pickLegacyCategoryEnum(finalCategories);

        const itemSrcLang = (it.source_language === 'en' || it.source_language === 'ko')
          ? it.source_language
          : (source_language === 'en' ? 'en' : 'ko');
        const itemAutoTrans = it.auto_translate !== undefined ? it.auto_translate !== false : finalAutoTranslate;

        // #316 — 항목(custom_columns/values) 저장. 없으면 종전대로 null.
        const cols = Array.isArray(it.custom_columns) ? it.custom_columns.slice(0, 30) : null;
        const vals = (it.custom_values && typeof it.custom_values === 'object') ? it.custom_values : null;

        // 색인 본문 — 본문이 없으면 항목에서 합성한다(문서 생성 경로와 같은 규칙).
        //   ★ secret 항목은 라벨만, 값은 제외 (색인·번역은 외부 API 로 나간다).
        let indexBody = String(it.body || '').slice(0, 50000);
        if (!indexBody.trim() && cols && vals) {
          const lines = [];
          for (const c of cols) {
            if (!c || !c.id) continue;
            const raw = vals[c.id];
            if (raw == null || String(raw).trim() === '') continue;
            const label = String(c.name || c.id).trim();
            lines.push(c.type === 'secret' ? label : `${label}: ${String(raw).trim()}`);
          }
          if (lines.length) indexBody = `${title}\n${lines.join('\n')}`;
        }
        if (!indexBody.trim()) { errors.push({ index: idx, error: 'no_indexable_content' }); continue; }

        const payload = {
          business_id: businessId,
          title,
          body: indexBody,
          // 출처가 있으면 source_type 도 그것으로 — 상세 화면이 이 값으로 "어디서 왔는지" 를 그린다.
          source_type: srcPostId ? 'post' : (srcFileId ? 'file' : 'manual'),
          source_post_id: srcPostId,
          source_file_id: srcFileId,
          category: cat,
          categories: finalCategories,
          tags: Array.isArray(it.tags) ? it.tags.slice(0, 8).map(String) : null,
          custom_columns: cols,
          custom_values: vals,
          scope: finalScope,
          project_id: finalScope === 'project' ? (parseInt(project_id, 10) || null) : null,
          client_id: finalScope === 'client' ? (parseInt(client_id, 10) || null) : null,
          status: 'pending',
          uploaded_by: req.user.id,
          source_language: itemSrcLang,
          auto_translate: itemAutoTrans,
          translation_visibility: finalVisibility,
          parent_doc_id: parentDocId,
        };

        // 자유 카테고리를 마스터에 등록 — 단건 생성 경로와 같은 헬퍼. 안 하면 칩·필터에서 사라진다.
        upsertKbCategories(businessId, finalCategories).catch(() => {});

        let doc;
        if (dupId && dupMode === 'update') {
          doc = await KbDocument.findByPk(dupId);
          if (!doc) { errors.push({ index: idx, error: 'existing_not_found' }); continue; }
          const { business_id: _b, parent_doc_id: _p, uploaded_by: _u, ...updatable } = payload;
          await doc.update(updatable);
          updated.push({ id: doc.id, title: doc.title });
        } else {
          doc = await KbDocument.create(payload);
        }

        // 첫 번째 = parent. 두 번째부터 parent_doc_id 로 연결
        if (idx === 0 && items.length > 1) parentDocId = doc.id;

        // 임베딩·번역 비동기 트리거 (kbService 가 처리하면 자동)
        try {
          if (kbService.indexDocument) {
            kbService.indexDocument(doc.id).catch((e) => console.warn('[kb-batch] indexDocument failed', doc.id, e.message));
          }
        } catch { /* noop */ }

        if (!(dupId && dupMode === 'update')) {
          created.push({ id: doc.id, title: doc.title, source_language: doc.source_language });
        }
      } catch (e) {
        errors.push({ index: idx, error: e.message });
      }
    }

    if (created.length || updated.length) logAudit(req, { businessId, action: 'kb.document_batch', targetType: 'KbDocument', targetId: null, newValue: { created_count: created.length, updated_count: updated.length, skipped_count: skipped.length, created_ids: created.slice(0, 50).map((c) => c.id), updated_ids: updated.slice(0, 50).map((u) => u.id), scope: scope || null } });
    return successResponse(res, {
      created, updated, skipped, errors,
      count: created.length,
      on_duplicate: dupMode,
    });
  } catch (err) { next(err); }
});

router.post('/businesses/:businessId/kb/search', authenticateToken, checkBusinessAccess, async (req, res, next) => { // audit-exempt: 읽기(검색) — 바꾸는 것이 없다
  // 목록과 같은 문 — 고객은 Q info 를 보지 않는다(0-C C-3)
  if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
  try {
    const { query, limit } = req.body;
    if (!query) return errorResponse(res, 'query required', 400);
    // 권한 — 부른 사람이 볼 수 있는 문서 안에서만 찾는다(전에는 워크스페이스 전체였다).
    const kbScope = await getUserScope(req.user.id, Number(req.params.businessId), req.user.platform_role);
    const result = await kbService.hybridSearch(req.params.businessId, query, { limit: limit || 5, docWhere: kbDocumentsListWhereByLevel(kbScope) });
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
    // 볼 수 있는 사람만 밖으로 내보낸다(읽기와 같은 술어).
    if (!(await canAccessKbDocumentByLevel(req.user.id, doc, scope))) return errorResponse(res, 'forbidden', 403);
    // D4 #62 — 보안등급 게이트: 일반 외 자료는 외부 공유 차단
    if (blocksExternalShare(doc)) {
      return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
    }

    const { applyShareUpdate } = require('../services/share_helper');
    const r = await applyShareUpdate(doc, req.body || {});
    const url = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/kb/${r.token}`;
    // 감사 — 외부 노출을 연다(AUDIT_GAPS 1순위). 토큰 원문은 싣지 않는다(기록이 곧 유출이 된다).
    require('../services/auditService').logAudit(req, { action: 'kb.share_create', targetType: 'kb', targetId: doc.id, businessId: doc.business_id,
      newValue: { access_locked: !!doc.share_password_hash, expires_at: doc.share_expires_at || null } });
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
    // 볼 수 있는 사람만 — 공유 발급과 같은 술어(0-C C-3). 남의 L1 등급 변경·공유 해제 차단.
    if (!(await canAccessKbDocumentByLevel(req.user.id, doc, scope))) return errorResponse(res, 'forbidden', 403);
    await doc.update({
      share_token: null,
      shared_at: null,
      share_password_hash: null,
      share_expires_at: null,
    });
    require('../services/auditService').logAudit(req, { action: 'kb.share_revoke', targetType: 'kb', targetId: doc.id, businessId: doc.business_id });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

// ─── D4 #62 — 보안등급 변경 ───
// PUT /api/kb-documents/:id/security-level  body: { level: 'general'|'internal'|'confidential' }
//   권한: member 이상. 일반 외로 상향 시 외부 공유 링크 즉시 무효화.
router.put('/kb-documents/:id/security-level', authenticateToken, async (req, res, next) => {
  try {
    const level = String(req.body?.level || '');
    if (!isValidLevel(level)) return errorResponse(res, 'invalid_level', 400);
    const doc = await KbDocument.findByPk(req.params.id);
    if (!doc) return errorResponse(res, 'kb_document_not_found', 404);
    const scope = await getUserScope(req.user.id, doc.business_id, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);
    // 볼 수 있는 사람만 — 공유 발급과 같은 술어(0-C C-3). 남의 L1 등급 변경·공유 해제 차단.
    if (!(await canAccessKbDocumentByLevel(req.user.id, doc, scope))) return errorResponse(res, 'forbidden', 403);
    const prev = doc.security_level;
    const patch = { security_level: level };
    let revokedShare = false;
    if (level !== 'general' && doc.share_token) {
      patch.share_token = null; patch.shared_at = null; patch.share_password_hash = null; patch.share_expires_at = null;
      revokedShare = true;
    }
    await doc.update(patch);
    broadcastKb(req, doc, 'kb:updated');
    await createAuditLog({
      userId: req.user.id, businessId: doc.business_id,
      action: 'kb.security_level_change', targetType: 'KbDocument', targetId: doc.id,
      oldValue: { security_level: prev }, newValue: { security_level: level, revoked_share: revokedShare },
    });
    return successResponse(res, { id: doc.id, security_level: level, revoked_share: revokedShare });
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
        'share_password_hash', 'business_id', 'createdAt', 'updatedAt', 'file_name', 'mime_type',
        'custom_columns', 'custom_values'],
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    const { verifySharePassword, checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(doc, res)) return;
    const v = await verifySharePassword(doc, req);
    if (!v.ok) return res.status(v.status).json({ success: false, message: v.error, requires_password: v.requires_password });
    // #408 — 공개(무인증) 응답에는 **살아 있는 항목의 값만** 싣는다.
    //   custom_values 는 머지 저장이라 지운 항목의 값이 그대로 남아 있다(운영 doc#36 실측).
    //   통째로 내보내면 화면에 안 그려질 뿐 **응답 JSON 에는 지운 값이 실려 나간다** —
    //   보이지 않는 것과 나가지 않는 것은 다르다.
    //   ★ 가릴 때는 지울 것을 열거하지 말고 남길 것만 남긴다(화이트리스트).
    //     예약키(auto_indexed 등)와 고아 값이 자동으로 빠진다.
    const pubCols = Array.isArray(doc.custom_columns) ? doc.custom_columns : [];
    const rawVals = (doc.custom_values && typeof doc.custom_values === 'object') ? doc.custom_values : {};
    const pubVals = {};
    for (const c of pubCols) {
      if (c && c.id && Object.prototype.hasOwnProperty.call(rawVals, c.id)) pubVals[c.id] = rawVals[c.id];
    }
    const payload = {
      id: doc.id,
      title: doc.title,
      body: doc.body,
      source_type: doc.source_type,
      file_name: doc.file_name,
      mime_type: doc.mime_type,
      uploader: doc.uploader ? { id: doc.uploader.id, name: doc.uploader.name } : null,
      workspace: doc.Business ? { id: doc.Business.id, name: doc.Business.brand_name || doc.Business.name } : null,
      shared_at: doc.shared_at,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
      custom_columns: pubCols,
      custom_values: pubVals,
    };
    await applyMemberDisplayNameOne(payload, doc.business_id, ['uploader']);
    // PDF 주소 — 비밀번호 걸린 문서는 서명을 붙여 준다(window.open 은 헤더를 못 싣는다).
    payload.pdf_url = `/api/kb-documents/public/by-token/${req.params.token}/pdf${require('../services/share_helper').shareSubQuery(doc, req.params.token, 'pdf')}`;
    return successResponse(res, payload);
  } catch (err) { next(err); }
});

// PDF 다운로드 (익명 — share_token). 문서(post) PDF 템플릿 재사용 (KB body 는 HTML 문자열).
router.get('/kb-documents/public/by-token/:token/pdf', async (req, res, next) => {
  try {
    const doc = await KbDocument.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: User, as: 'uploader', attributes: ['id', 'name'], required: false },
        { model: Business, attributes: ['id', 'name', 'brand_name', 'legal_name'], required: false },
      ],
      attributes: ['id', 'title', 'body', 'source_type', 'shared_at', 'share_expires_at',
        'share_password_hash', 'business_id', 'created_at'],
    });
    if (!doc) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry, verifyShareSub } = require('../services/share_helper');
    if (checkShareExpiry(doc, res)) return;
    // 비밀번호 — 본문 GET 과 같은 자격(서명 또는 헤더). 전에는 없어 주소만 알면 PDF 가 받아졌다.
    if (!(await verifyShareSub(doc, req, req.params.token, 'pdf'))) {
      return res.status(401).json({ success: false, message: 'password_required', requires_password: true });
    }
    const { postPdfHtml } = require('../services/pdfTemplates');
    const { renderPdfFromHtml } = require('../services/pdfService');
    // KB body(HTML) → post 형태로 매핑해 동일 PDF 템플릿 재사용
    const pseudoPost = {
      title: doc.title, content_json: null, content_html: doc.body || '',
      category: doc.source_type || 'INFO', shared_at: doc.shared_at, created_at: doc.created_at,
    };
    let author = doc.uploader ? { id: doc.uploader.id, name: doc.uploader.name } : null;
    if (author) {
      const dn = await getMemberDisplayName(doc.business_id, author.id, author.name);
      author = { ...author, name: dn.name || author.name };
    }
    const html = postPdfHtml(pseudoPost, author, doc.Business ? doc.Business.toJSON() : {});
    const pdf = await renderPdfFromHtml(html);
    res.setHeader('Content-Type', 'application/pdf');
    const asciiName = (doc.title || 'document').replace(/[^\w-]/g, '_').slice(0, 80) || 'document';
    const utf8Name = encodeURIComponent(`${doc.title || 'document'}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.pdf"; filename*=UTF-8''${utf8Name}`);
    res.send(pdf);
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

// ─────────────────────────────────────────────────────────
// KB 공유 번들 (#6, N+93) — 다건/카테고리 묶음 공유 + 문서식 공개 미리보기
// ─────────────────────────────────────────────────────────

// 공개 뷰용 KB doc serialize (단건 공개뷰와 동일 필드)
function serializePublicKbDoc(doc) {
  return {
    id: doc.id,
    title: doc.title,
    body: doc.body,
    source_type: doc.source_type,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
    categories: Array.isArray(doc.categories) ? doc.categories : (doc.category ? [doc.category] : []),
    created_at: doc.created_at,
  };
}

// POST 번들 생성 — kind='selection'(doc_ids) | 'category'(category)
router.post('/businesses/:businessId/kb/share-bundle', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    const businessId = parseInt(req.params.businessId, 10);
    const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
    if (!isMemberOrAbove(scope)) return errorResponse(res, 'forbidden', 403);

    const { kind, doc_ids, category, title, expires_in_days } = req.body || {};
    if (!['selection', 'category'].includes(kind)) return errorResponse(res, 'invalid_kind', 400);

    let docIds = null;
    if (kind === 'selection') {
      docIds = Array.isArray(doc_ids) ? [...new Set(doc_ids.map(Number).filter(Boolean))] : [];
      if (!docIds.length) return errorResponse(res, 'no_documents', 400);
      // tenant 격리 — 전부 이 워크스페이스 문서인지 검증
      const cnt = await KbDocument.count({ where: { id: docIds, business_id: businessId } });
      if (cnt !== docIds.length) return errorResponse(res, 'invalid_documents', 400);
      // D4 #62 — 보안등급 게이트: 일반 외 자료가 하나라도 있으면 번들 생성 차단
      const blocked = await KbDocument.count({ where: { id: docIds, business_id: businessId, security_level: { [Op.ne]: 'general' } } });
      if (blocked > 0) return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
      // 볼 수 있는 문서만 묶는다 — 남의 «나만 보기» 문서 id 를 넣어 공개할 수 있었다(2026-09-27 점검).
      const picked = await KbDocument.findAll({ where: { id: docIds, business_id: businessId } });
      for (const d of picked) {
        if (!(await canAccessKbDocumentByLevel(req.user.id, d, scope))) return errorResponse(res, 'invalid_documents', 400);
      }
    } else {
      if (!category || !String(category).trim()) return errorResponse(res, 'category_required', 400);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = expires_in_days ? new Date(Date.now() + Number(expires_in_days) * 86400 * 1000) : null;
    const bundle = await KbShareBundle.create({
      business_id: businessId, token, kind,
      doc_ids: kind === 'selection' ? docIds : null,
      category: kind === 'category' ? String(category).trim().slice(0, 80) : null,
      title: title ? String(title).slice(0, 200) : null,
      created_by: req.user.id,
      expires_at: expiresAt,
    });
    const url = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/kb-bundle/${token}`;
    require('../services/auditService').logAudit(req, { action: 'kb.share_bundle_create', targetType: 'kb_share_bundle', targetId: bundle.id, businessId: bundle.business_id, newValue: { kind, count: kind === 'selection' ? docIds.length : null, expires_at: expiresAt || null } }); // 감사 — 외부 노출(토큰 미기록)
    return successResponse(res, { id: bundle.id, share_token: token, share_url: url, kind, count: kind === 'selection' ? docIds.length : null });
  } catch (err) { next(err); }
});

// DELETE 번들 무효화
router.delete('/businesses/:businessId/kb/share-bundle/:id', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const b = await KbShareBundle.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!b) return errorResponse(res, 'not_found', 404);
    await b.destroy();
    require('../services/auditService').logAudit(req, { action: 'kb.share_bundle_revoke', targetType: 'kb_share_bundle', targetId: b.id, businessId });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

// 묶음 공개에 들어갈 수 있는 범위 — 팀 전체(L3)·외부(L4) 공개 문서만. 개인(L1)·한정(L2)은
//   카테고리가 같아도 들어가지 않는다(2026-09-27 — 카테고리 묶음이 개인 문서 본문까지 무인증으로 보여 주고 있었다).
//   vlevel 이 없는 옛 자료는 scope 로(workspace·client 만).
const BUNDLE_OPEN_WHERE = {
  [Op.or]: [
    { vlevel: { [Op.in]: ['L3', 'L4'] } },
    { vlevel: null, scope: 'workspace', read_policy: { [Op.or]: ['all', null] } },
    { vlevel: null, scope: 'client' },
  ],
};

// GET 공개 번들 뷰 — 인증 없음, token 기반. category 는 live 조회.
router.get('/kb-bundle/public/by-token/:token', async (req, res, next) => {
  try {
    const bundle = await KbShareBundle.findOne({ where: { token: req.params.token } });
    if (!bundle) return errorResponse(res, 'not_found', 404);
    if (bundle.expires_at && new Date(bundle.expires_at) < new Date()) {
      return res.status(410).json({ success: false, code: 'share_expired', message: 'This share link has expired.', expired_at: bundle.expires_at });
    }
    let docs = [];
    if (bundle.kind === 'selection') {
      const rows = await KbDocument.findAll({
        // D4 #62 — 번들 생성 후 등급이 상향된 자료는 공개에서 즉시 제외 (general 만)
        where: { id: bundle.doc_ids || [], business_id: bundle.business_id, security_level: 'general', [Op.and]: [BUNDLE_OPEN_WHERE] },
        attributes: ['id', 'title', 'body', 'source_type', 'file_name', 'mime_type', 'categories', 'category', 'created_at'],
      });
      // doc_ids 순서 유지
      const map = new Map(rows.map((r) => [r.id, r]));
      docs = (bundle.doc_ids || []).map((id) => map.get(id)).filter(Boolean).map(serializePublicKbDoc);
    } else {
      // 카테고리는 free(categories JSON 배열) + legacy(category 컬럼) 둘 다 매칭.
      const rows = await KbDocument.findAll({
        // D4 #62 — 카테고리 번들도 general 자료만 외부 노출
        where: { business_id: bundle.business_id, security_level: 'general', [Op.and]: [BUNDLE_OPEN_WHERE] },
        attributes: ['id', 'title', 'body', 'source_type', 'file_name', 'mime_type', 'categories', 'category', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 500,
      });
      docs = rows.filter((r) => {
        const cats = Array.isArray(r.categories) ? r.categories : [];
        return cats.includes(bundle.category) || r.category === bundle.category;
      }).slice(0, 200).map(serializePublicKbDoc);
    }
    const biz = await Business.findByPk(bundle.business_id, { attributes: ['id', 'name', 'brand_name'] });
    bundle.update({ viewed_count: (bundle.viewed_count || 0) + 1 }).catch(() => null);
    return successResponse(res, {
      kind: bundle.kind,
      title: bundle.title || (bundle.kind === 'category' ? bundle.category : null),
      category: bundle.category,
      workspace: biz ? { id: biz.id, name: biz.brand_name || biz.name } : null,
      count: docs.length,
      documents: docs,
    });
  } catch (err) { next(err); }
});

module.exports = router;
