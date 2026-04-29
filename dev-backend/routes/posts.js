// 문서 (Posts) CRUD — 포스팅 기반 문서 (매뉴얼/가이드/공지 등)
// project_id NULL = 워크스페이스 전역 문서, NOT NULL = 프로젝트 소속
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Post, PostAttachment, PostCategory, File, User, Project, BusinessMember, Business, Conversation, Message } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope, postListWhere, canAccessPost, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { sendPostShareEmail } = require('../services/emailService');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

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

// 워크스페이스 멤버십 확인 헬퍼 (member 이상 — 쓰기 액션용)
async function assertMember(userId, businessId, isPlatformAdmin) {
  if (isPlatformAdmin) return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  if (bm) return true;
  const biz = await Business.findOne({ where: { id: businessId, owner_id: userId } });
  return !!biz;
}

// 워크스페이스 + client 통합 (조회 액션용)
async function assertWorkspaceOrClient(userId, businessId, platformRole) {
  const scope = await getUserScope(userId, businessId, platformRole);
  if (scope.isPlatformAdmin || scope.isOwner || scope.isMember || scope.isClient) return { ok: true, scope };
  return { ok: false, scope: null };
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
    conversation_id: p.conversation_id,
    title: p.title,
    category: p.category,
    status: p.status,
    visibility: p.visibility,
    is_pinned: p.is_pinned,
    view_count: p.view_count,
    author: p.author ? { id: p.author.id, name: p.author.name } : null,
    editor: p.editor ? { id: p.editor.id, name: p.editor.name } : null,
    project: p.Project ? { id: p.Project.id, name: p.Project.name, color: p.Project.color } : null,
    conversation: p.Conversation ? { id: p.Conversation.id, title: p.Conversation.display_name || p.Conversation.title || null } : null,
    share_token: p.share_token || null,
    share_url: p.share_token ? `${APP_URL}/public/posts/${p.share_token}` : null,
    shared_at: p.shared_at || null,
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
    const auth = await assertWorkspaceOrClient(req.user.id, businessId, req.user.platform_role);
    if (!auth.ok) return errorResponse(res, 'forbidden', 403);
    // Client 면 자기 참여 프로젝트 post 만
    const baseWhere = await postListWhere(req.user.id, businessId, auth.scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    const where = { ...baseWhere };
    if (req.query.project_id === 'null' || req.query.project_id === '') where.project_id = null;
    else if (req.query.project_id) where.project_id = Number(req.query.project_id);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.mine === '1') where.author_id = req.user.id;

    // 통합 검색: 제목·본문·카테고리·프로젝트명 모두 매칭
    const include = [
      { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
      { model: Project, attributes: ['id', 'name', 'color'], required: false },
      { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
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
    const auth = await assertWorkspaceOrClient(req.user.id, businessId, req.user.platform_role);
    if (!auth.ok) return errorResponse(res, 'forbidden', 403);
    // Client 는 자기 참여 프로젝트 post 의 메타만
    const baseScope = await postListWhere(req.user.id, businessId, auth.scope);
    if (!baseScope) return errorResponse(res, 'forbidden', 403);
    const scopeWhere = { ...baseScope };
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
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: User, as: 'editor', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    const scope = await getUserScope(req.user.id, post.business_id, req.user.platform_role);
    if (!(await canAccessPost(req.user.id, post, scope))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await post.increment('view_count');
    successResponse(res, serialize(post, true));
  } catch (err) { next(err); }
});

// ─── 생성 ───
router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id = null, conversation_id = null, title, content_json = null, category = null, status = 'published', is_pinned = false } = req.body || {};
    if (!business_id || !title) return errorResponse(res, 'business_id/title required', 400);
    if (!(await assertMember(req.user.id, Number(business_id), req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // project_id 가 있으면 business 일치 검증
    if (project_id) {
      const p = await Project.findOne({ where: { id: project_id, business_id } });
      if (!p) return errorResponse(res, 'invalid project_id', 400);
    }
    // conversation_id 가 있으면 business 일치 검증
    if (conversation_id) {
      const conv = await Conversation.findOne({ where: { id: conversation_id, business_id } });
      if (!conv) return errorResponse(res, 'invalid conversation_id', 400);
    }
    const post = await Post.create({
      business_id,
      project_id: project_id || null,
      conversation_id: conversation_id || null,
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
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    // Phase D+1: 거래 stage 자동 진행
    if (post.project_id) {
      require('../services/projectStageEngine').onPostChanged(post.id).catch(() => null);
    }
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
    if (req.body.project_id !== undefined) {
      const pid = req.body.project_id;
      if (pid === null || pid === '') {
        patch.project_id = null;
      } else {
        const p = await Project.findOne({ where: { id: Number(pid), business_id: post.business_id } });
        if (!p) return errorResponse(res, 'invalid project_id', 400);
        patch.project_id = p.id;
      }
    }
    if (req.body.conversation_id !== undefined) {
      const cid = req.body.conversation_id;
      if (cid === null || cid === '') {
        patch.conversation_id = null;
      } else {
        const conv = await Conversation.findOne({ where: { id: Number(cid), business_id: post.business_id } });
        if (!conv) return errorResponse(res, 'invalid conversation_id', 400);
        patch.conversation_id = conv.id;
      }
    }
    patch.editor_id = req.user.id;
    await post.update(patch);
    const full = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: User, as: 'editor', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    // Phase D+1: stage 자동 진행 (status/category 변경 가능성)
    if (full?.project_id) require('../services/projectStageEngine').onPostChanged(full.id).catch(() => null);
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

// ─── 공유: token 발급/조회 ───
// POST /api/posts/:id/share — share_token 없으면 발급, 있으면 그대로 반환
router.post('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    if (!post.share_token) {
      const token = crypto.randomBytes(32).toString('hex');
      await post.update({ share_token: token, shared_at: new Date() });
    }
    return successResponse(res, {
      share_token: post.share_token,
      share_url: `${APP_URL}/public/posts/${post.share_token}`,
      shared_at: post.shared_at,
    });
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/share — share_token 무효화
router.delete('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await post.update({ share_token: null, shared_at: null });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

// ─── 공유: 이메일 발송 ───
// POST /api/posts/:id/share/email  body: { to, message? }
router.post('/:id/share/email', authenticateToken, async (req, res, next) => {
  try {
    const { to, message } = req.body || {};
    const recipients = Array.isArray(to) ? to : (typeof to === 'string' ? to.split(',').map(s => s.trim()).filter(Boolean) : []);
    if (recipients.length === 0) return errorResponse(res, 'to required', 400);
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const e of recipients) {
      if (!emailRe.test(e)) return errorResponse(res, `invalid email: ${e}`, 400);
    }
    const post = await Post.findByPk(req.params.id, {
      include: [{ model: Business, attributes: ['id', 'name'] }],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // share_token 자동 발급
    if (!post.share_token) {
      const token = crypto.randomBytes(32).toString('hex');
      await post.update({ share_token: token, shared_at: new Date() });
    }
    const shareUrl = `${APP_URL}/public/posts/${post.share_token}`;
    const sender = await User.findByPk(req.user.id, { attributes: ['name'] });

    const results = [];
    for (const email of recipients) {
      const ok = await sendPostShareEmail({
        to: email,
        docTitle: post.title,
        senderName: sender?.name || '',
        workspaceName: post.Business?.name || '',
        message: message ? String(message).slice(0, 1000) : null,
        shareUrl,
      });
      results.push({ to: email, sent: ok });
    }
    return successResponse(res, { share_url: shareUrl, results });
  } catch (err) { next(err); }
});

// ─── 공유: 채팅방으로 보내기 ───
// POST /api/posts/:id/share-to-chat  body: { conversation_id, message? }
router.post('/:id/share-to-chat', authenticateToken, async (req, res, next) => {
  try {
    const convId = Number(req.body?.conversation_id || 0);
    if (!convId) return errorResponse(res, 'conversation_id required', 400);
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const conv = await Conversation.findOne({ where: { id: convId, business_id: post.business_id } });
    if (!conv) return errorResponse(res, 'invalid conversation_id', 400);
    // share_token 자동 발급
    if (!post.share_token) {
      const token = crypto.randomBytes(32).toString('hex');
      await post.update({ share_token: token, shared_at: new Date() });
    }
    const shareUrl = `${APP_URL}/public/posts/${post.share_token}`;
    const userMessage = req.body?.message ? String(req.body.message).slice(0, 1000) : '';
    // 폴백: kind='card' 미지원 클라이언트나 알림 미리보기에서 쓰일 짧은 텍스트
    const fallbackContent = userMessage ? `[문서] ${post.title} — ${userMessage}` : `[문서] ${post.title}`;

    const msg = await Message.create({
      conversation_id: conv.id,
      sender_id: req.user.id,
      content: fallbackContent,
      kind: 'card',
      meta: {
        card_type: 'post',
        post_id: post.id,
        share_token: post.share_token,
        share_url: shareUrl,
        title: post.title,
        note: userMessage || null,
      },
      is_ai: false,
      is_internal: false,
    });
    await conv.update({ last_message_at: new Date() });
    return successResponse(res, { message: msg, share_url: shareUrl });
  } catch (err) { next(err); }
});

// ─── PDF 다운로드 (멤버) ───
async function buildPostPdf(post) {
  const author = post.author ? { id: post.author.id, name: post.author.name } : null;
  const business = await require('../models').Business.findByPk(post.business_id, {
    attributes: ['name', 'brand_name', 'legal_name'],
  });
  const { postPdfHtml } = require('../services/pdfTemplates');
  const { renderPdfFromHtml } = require('../services/pdfService');
  const html = postPdfHtml(post, author, business?.toJSON() || {});
  return renderPdfFromHtml(html);
}

router.get('/:id/pdf', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const pdf = await buildPostPdf(post);
    res.setHeader('Content-Type', 'application/pdf');
    // ASCII filename + RFC 5987 UTF-8 filename* (한글 등 비 ASCII 문자 지원)
    const asciiName = (post.title || 'document').replace(/[^\w-]/g, '_').slice(0, 80) || 'document';
    const utf8Name = encodeURIComponent(`${post.title || 'document'}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.pdf"; filename*=UTF-8''${utf8Name}`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ─── PDF 다운로드 (익명 — share_token) ───
router.get('/public/:token/pdf', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { share_token: req.params.token, status: 'published' },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    const pdf = await buildPostPdf(post);
    res.setHeader('Content-Type', 'application/pdf');
    // ASCII filename + RFC 5987 UTF-8 filename* (한글 등 비 ASCII 문자 지원)
    const asciiName = (post.title || 'document').replace(/[^\w-]/g, '_').slice(0, 80) || 'document';
    const utf8Name = encodeURIComponent(`${post.title || 'document'}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.pdf"; filename*=UTF-8''${utf8Name}`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// ─── Public — share_token 기반 (인증 없음) ───
// GET /api/posts/public/:token
router.get('/public/:token', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { share_token: req.params.token, status: 'published' },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    await post.increment('view_count');
    const safe = serialize(post, true);
    // 공개 응답에서 민감 정보 정리: business_id 는 노출 안 해도 무방하지만 frontend 에서 직접 사용은 X
    delete safe.share_token; // 이미 URL 에 있어서 굳이 응답에 포함 안 함
    return successResponse(res, safe);
  } catch (err) { next(err); }
});

module.exports = router;
