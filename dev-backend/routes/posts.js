// 문서 (Posts) CRUD — 포스팅 기반 문서 (매뉴얼/가이드/공지 등)
// project_id NULL = 워크스페이스 전역 문서, NOT NULL = 프로젝트 소속
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Post, PostAttachment, PostCategory, File, User, Project, BusinessMember, Business } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// 에디터 인라인 이미지 저장 경로
const EDITOR_IMG_DIR = path.join(__dirname, '..', 'uploads', 'editor-images');
if (!fs.existsSync(EDITOR_IMG_DIR)) fs.mkdirSync(EDITOR_IMG_DIR, { recursive: true });
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const editorImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, EDITOR_IMG_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(IMG_EXT.has(ext) ? null : new Error('image_only'), IMG_EXT.has(ext));
  }
});

// 워크스페이스 멤버십 확인 헬퍼
async function assertMember(userId, businessId, isPlatformAdmin) {
  if (isPlatformAdmin) return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (bm) return true;
  const biz = await Business.findOne({ where: { id: businessId, owner_id: userId } });
  return !!biz;
}

// Plain text 추출 — Tiptap JSON → 검색/프리뷰용 plain string
function extractText(json) {
  if (!json) return '';
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const out = [];
    const walk = (n) => {
      if (!n) return;
      if (n.text) out.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
    };
    walk(obj);
    return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
  } catch { return ''; }
}

function serialize(p, withContent = false) {
  return {
    id: p.id,
    business_id: p.business_id,
    project_id: p.project_id,
    title: p.title,
    category: p.category,
    status: p.status,
    visibility: p.visibility,
    is_pinned: p.is_pinned,
    view_count: p.view_count,
    author: p.author ? { id: p.author.id, name: p.author.name } : null,
    editor: p.editor ? { id: p.editor.id, name: p.editor.name } : null,
    project: p.Project ? { id: p.Project.id, name: p.Project.name, color: p.Project.color } : null,
    created_at: p.created_at,
    updated_at: p.updated_at,
    content_preview: (p.content_text || '').slice(0, 200),
    ...(withContent ? {
      content_json: p.content_json ? (typeof p.content_json === 'string' ? JSON.parse(p.content_json) : p.content_json) : null,
      attachments: (p.attachments || []).map(a => ({
        id: a.id, file_id: a.file_id, sort_order: a.sort_order,
        file: a.file ? {
          id: a.file.id,
          file_name: a.file.file_name,
          file_size: Number(a.file.file_size),
          mime_type: a.file.mime_type,
          storage_provider: a.file.storage_provider,
          external_url: a.file.external_url,
          download_url: a.file.storage_provider === 'gdrive' && a.file.external_url
            ? a.file.external_url
            : `/api/files/${a.file.business_id}/${a.file.id}/download`,
        } : null,
      })),
    } : {}),
  };
}

// ─── 목록 ───
// GET /api/posts?business_id=&project_id=[null|:id]&category=&mine=1&q=
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id || 0);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMember(req.user.id, businessId, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const where = { business_id: businessId };
    if (req.query.project_id === 'null' || req.query.project_id === '') where.project_id = null;
    else if (req.query.project_id) where.project_id = Number(req.query.project_id);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.mine === '1') where.author_id = req.user.id;

    // 통합 검색: 제목·본문·카테고리·프로젝트명 모두 매칭
    const include = [
      { model: User, as: 'author', attributes: ['id', 'name'] },
      { model: Project, attributes: ['id', 'name', 'color'], required: false },
    ];
    if (req.query.q) {
      const qStr = String(req.query.q);
      const like = `%${qStr}%`;
      // 프로젝트명 매칭 위해 project id 미리 조회 — 이름에 q 가 포함된 프로젝트 id 들
      const projectsByName = await Project.findAll({
        where: { business_id: businessId, name: { [Op.like]: like } },
        attributes: ['id'],
      });
      const projIds = projectsByName.map(p => p.id);
      const orConds = [
        { title: { [Op.like]: like } },
        { content_text: { [Op.like]: like } },
        { category: { [Op.like]: like } },
      ];
      if (projIds.length > 0) orConds.push({ project_id: { [Op.in]: projIds } });
      where[Op.or] = orConds;
    }
    const rows = await Post.findAll({
      where,
      include,
      order: [['is_pinned', 'DESC'], ['updated_at', 'DESC']],
      limit: 200,
    });
    successResponse(res, rows.map(r => serialize(r)));
  } catch (err) { next(err); }
});

// ─── 카테고리 목록 (distinct) + 프로젝트별 포스트 수 ───
// GET /api/posts/meta?business_id=&project_id=[null|:id]
// 응답: { categories: [{name, count}], projects: [{id, name, color, count}], total, myCount }
router.get('/meta', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id || 0);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMember(req.user.id, businessId, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const scopeWhere = { business_id: businessId };
    if (req.query.project_id === 'null' || req.query.project_id === '') scopeWhere.project_id = null;
    else if (req.query.project_id) scopeWhere.project_id = Number(req.query.project_id);

    const all = await Post.findAll({
      where: scopeWhere,
      attributes: ['id', 'category', 'project_id', 'author_id'],
      include: [{ model: Project, attributes: ['id', 'name', 'color'], required: false }],
    });
    const catMap = new Map();
    const projMap = new Map();
    let myCount = 0;
    for (const p of all) {
      if (p.category) catMap.set(p.category, (catMap.get(p.category) || 0) + 1);
      if (p.project_id && p.Project) {
        const cur = projMap.get(p.project_id);
        if (cur) cur.count++;
        else projMap.set(p.project_id, { id: p.project_id, name: p.Project.name, color: p.Project.color, count: 1 });
      }
      if (p.author_id === req.user.id) myCount++;
    }

    // 마스터 카테고리 테이블 (빈 카테고리 포함) — scope 와 일치하는 것만
    const masterCats = await PostCategory.findAll({
      where: scopeWhere,
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    for (const mc of masterCats) {
      if (!catMap.has(mc.name)) catMap.set(mc.name, 0);
    }

    successResponse(res, {
      total: all.length,
      myCount,
      categories: Array.from(catMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      projects: Array.from(projMap.values()).sort((a, b) => b.count - a.count),
    });
  } catch (err) { next(err); }
});

// ─── 상세 ───
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name'] },
        { model: User, as: 'editor', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await post.increment('view_count');
    successResponse(res, serialize(post, true));
  } catch (err) { next(err); }
});

// ─── 생성 ───
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id = null, title, content_json = null, category = null, status = 'published', is_pinned = false } = req.body || {};
    if (!business_id || !title) return errorResponse(res, 'business_id/title required', 400);
    if (!(await assertMember(req.user.id, Number(business_id), req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // project_id 가 있으면 business 일치 검증
    if (project_id) {
      const p = await Project.findOne({ where: { id: project_id, business_id } });
      if (!p) return errorResponse(res, 'invalid project_id', 400);
    }
    const post = await Post.create({
      business_id,
      project_id: project_id || null,
      title: String(title).slice(0, 200),
      content_json: content_json ? JSON.stringify(content_json) : null,
      content_text: extractText(content_json),
      category,
      author_id: req.user.id,
      status,
      is_pinned: !!is_pinned,
    });
    const full = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name'] },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    successResponse(res, serialize(full, true), 'Post created', 201);
  } catch (err) { next(err); }
});

// ─── 수정 ───
// 권한: 작성자(author) 또는 owner/platform_admin 만.
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const isAuthor = post.author_id === req.user.id;
    let isOwner = false;
    if (!isAuthor && !isPlatformAdmin) {
      const bm = await BusinessMember.findOne({ where: { business_id: post.business_id, user_id: req.user.id }, attributes: ['role'] });
      isOwner = bm?.role === 'owner';
    }
    if (!isAuthor && !isOwner && !isPlatformAdmin) {
      return errorResponse(res, '작성자 또는 오너만 문서를 수정할 수 있습니다', 403);
    }
    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).slice(0, 200);
    if (req.body.content_json !== undefined) {
      patch.content_json = req.body.content_json ? JSON.stringify(req.body.content_json) : null;
      patch.content_text = extractText(req.body.content_json);
    }
    if (req.body.category !== undefined) patch.category = req.body.category;
    if (req.body.status !== undefined) patch.status = req.body.status;
    if (req.body.is_pinned !== undefined) patch.is_pinned = !!req.body.is_pinned;
    patch.editor_id = req.user.id;
    await post.update(patch);
    const full = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name'] },
        { model: User, as: 'editor', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    successResponse(res, serialize(full, true), 'Post updated');
  } catch (err) { next(err); }
});

// ─── 삭제 ───
// 권한: 작성자(author) 또는 owner/platform_admin 만.
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const isAuthor = post.author_id === req.user.id;
    let isOwner = false;
    if (!isAuthor && !isPlatformAdmin) {
      const bm = await BusinessMember.findOne({ where: { business_id: post.business_id, user_id: req.user.id }, attributes: ['role'] });
      isOwner = bm?.role === 'owner';
    }
    if (!isAuthor && !isOwner && !isPlatformAdmin) {
      return errorResponse(res, '작성자 또는 오너만 문서를 삭제할 수 있습니다', 403);
    }
    await PostAttachment.destroy({ where: { post_id: post.id } });
    await post.destroy();
    successResponse(res, null, 'Post deleted');
  } catch (err) { next(err); }
});

// ─── 첨부 연결 (기존 파일) ───
// POST /api/posts/:id/attachments  body: { file_ids: number[] }
router.post('/:id/attachments', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const fileIds = Array.isArray(req.body?.file_ids) ? req.body.file_ids.map(Number).filter(Boolean) : [];
    if (fileIds.length === 0) return errorResponse(res, 'file_ids required', 400);
    const files = await File.findAll({ where: { id: fileIds, business_id: post.business_id, deleted_at: null } });
    const existing = await PostAttachment.count({ where: { post_id: post.id } });
    const created = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const a = await PostAttachment.create({ post_id: post.id, file_id: f.id, sort_order: existing + i });
      created.push({ id: a.id, file_id: f.id, sort_order: a.sort_order });
    }
    successResponse(res, created, `${created.length} attached`);
  } catch (err) { next(err); }
});

// ─── 첨부 해제 ───
router.delete('/:id/attachments/:attId', authenticateToken, async (req, res, next) => {
  try {
    const att = await PostAttachment.findByPk(req.params.attId);
    if (!att) return errorResponse(res, 'not_found', 404);
    const post = await Post.findByPk(att.post_id);
    if (!post || post.id !== Number(req.params.id)) return errorResponse(res, 'mismatch', 400);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await att.destroy();
    successResponse(res, null, 'Detached');
  } catch (err) { next(err); }
});

// ─── 에디터 인라인 이미지 업로드 ───
// POST /api/posts/editor-image  multipart 'file'
// 응답: { url: '/api/posts/editor-image/:filename' }
router.post('/editor-image', authenticateToken, (req, res, next) => {
  editorImageUpload.single('file')(req, res, (err) => {
    if (err) return errorResponse(res, err.message || 'upload_failed', 400);
    if (!req.file) return errorResponse(res, 'file_required', 400);
    successResponse(res, { url: `/api/posts/editor-image/${req.file.filename}` }, 'uploaded');
  });
});

// GET /api/posts/editor-image/:filename — UUID 로 추측 불가, 인증 생략 (img 태그 직접 로드 용)
router.get('/editor-image/:filename', (req, res) => {
  const filename = String(req.params.filename || '');
  // path traversal 방어
  if (!/^[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i.test(filename)) {
    return errorResponse(res, 'invalid_filename', 400);
  }
  const fp = path.join(EDITOR_IMG_DIR, filename);
  if (!fs.existsSync(fp)) return errorResponse(res, 'not_found', 404);
  res.sendFile(fp);
});

// ─── 카테고리 마스터 CRUD (빈 카테고리도 미리 만들어 둘 수 있음) ───
// POST /api/posts/categories  body: { business_id, project_id?, name }
router.post('/categories', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.body?.business_id || 0);
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await assertMember(req.user.id, businessId, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) return errorResponse(res, 'name required', 400);
    const project_id = req.body?.project_id ? Number(req.body.project_id) : null;
    const [row, created] = await PostCategory.findOrCreate({
      where: { business_id: businessId, project_id, name },
      defaults: { business_id: businessId, project_id, name, sort_order: 0 }
    });
    successResponse(res, { id: row.id, name: row.name, created });
  } catch (err) { next(err); }
});

// DELETE /api/posts/categories/:id
router.delete('/categories/:id', authenticateToken, async (req, res, next) => {
  try {
    const row = await PostCategory.findByPk(req.params.id);
    if (!row) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, row.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await row.destroy();
    // 기존 문서의 category 값은 건드리지 않음 (유연성 보존). 단, meta 계산에서는 사라짐.
    successResponse(res, null, 'deleted');
  } catch (err) { next(err); }
});

module.exports = router;
