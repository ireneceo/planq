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
const { decodeOriginalName, buildContentDisposition } = require('../services/filename');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope, postListWhereByLevel, canAccessPostByLevel, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { sendPostShareEmail } = require('../services/emailService');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제):
// 다른 사용자가 문서 추가/수정/삭제 시 본인이 페이지 열고 있으면 즉시 보임.
// task_workflow.js 패턴 재사용. business room 으로 broadcast (project room 추가 가능).
function broadcastPost(req, post, event = 'post:updated') {
  const io = req.app.get('io');
  if (!io) return;
  const data = post.toJSON ? post.toJSON() : post;
  if (post.business_id) io.to(`business:${post.business_id}`).emit(event, data);
  if (post.project_id) io.to(`project:${post.project_id}`).emit(event, data);
}

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

// 워크스페이스 멤버십 확인 — middleware/access_scope.assertMemberOrAbove 위임 (단일 모듈 정책).
// 시그니처 호환 wrapper: posts.js 가 isPlatformAdmin boolean 으로 부르고 있어 그대로 둠.
async function assertMember(userId, businessId, isPlatformAdmin) {
  const { assertMemberOrAbove } = require('../middleware/access_scope');
  return assertMemberOrAbove(userId, businessId, isPlatformAdmin ? 'platform_admin' : null);
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
    // 자료정리 메타 (category='brief' 인 post 만 채워짐). BriefViewer 가 사용
    brief_meta: p.brief_meta || null,
    parent_post_id: p.parent_post_id || null,
    kind: p.kind || 'doc',
    q_record_id: p.q_record_id || null,
    linked_post_ids: Array.isArray(p.linked_post_ids) ? p.linked_post_ids : [],
    created_at: p.createdAt,
    updated_at: p.updatedAt,
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
    // 사이클 N+9: 옵션 A — vlevel 단계별 (L1 본인 author / L2 프로젝트 멤버 / L3 워크스페이스)
    // Client 는 옛 헬퍼 사용 (project-client 자기 프로젝트 post 만)
    let baseWhere;
    if (auth.scope.isClient) {
      const { postListWhere } = require('../middleware/access_scope');
      baseWhere = await postListWhere(req.user.id, businessId, auth.scope);
      if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    } else {
      baseWhere = postListWhereByLevel(auth.scope);
    }
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
    // 사이클 N+9: 옵션 A — vlevel 기반
    let baseScope;
    if (auth.scope.isClient) {
      const { postListWhere } = require('../middleware/access_scope');
      baseScope = await postListWhere(req.user.id, businessId, auth.scope);
      if (!baseScope) return errorResponse(res, 'forbidden', 403);
    } else {
      baseScope = postListWhereByLevel(auth.scope);
    }
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
    // 사이클 N+9: 옵션 A — vlevel 단계별 권한.
    // Client 는 옛 헬퍼 사용 (project-client 자기 프로젝트 post 만).
    let allowed;
    if (scope.isClient) {
      const { canAccessPost } = require('../middleware/access_scope');
      allowed = await canAccessPost(req.user.id, post, scope);
    } else {
      allowed = await canAccessPostByLevel(req.user.id, post, scope);
    }
    if (!allowed) {
      return errorResponse(res, 'forbidden', 403);
    }
    await post.increment('view_count');
    const result = serialize(post, true);
    // kind='table' 이면 연결된 QRecord 정보도 같이 (그리드 임베드용)
    if (post.kind === 'table' && post.q_record_id) {
      const { QRecord } = require('../models');
      const qrec = await QRecord.findByPk(post.q_record_id);
      if (qrec) {
        result.qrecord = { id: qrec.id, columns: qrec.columns };
      }
    }
    // 연결된 다른 post 메타 (title/kind) 같이 — 표시용 chip
    const linkedIds = result.linked_post_ids;
    if (linkedIds.length > 0) {
      const linked = await Post.findAll({
        where: { id: linkedIds, business_id: post.business_id },
        attributes: ['id', 'title', 'kind'],
      });
      const linkedMap = new Map(linked.map(p => [p.id, { id: p.id, title: p.title, kind: p.kind }]));
      result.linked_posts = linkedIds.map(id => linkedMap.get(id)).filter(Boolean);
    } else {
      result.linked_posts = [];
    }
    successResponse(res, result);
  } catch (err) { next(err); }
});

// ─── 생성 ───
// /records/:id (구 Q record) → post 로 redirect 용
router.get('/by-record/:recordId', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findOne({ where: { q_record_id: Number(req.params.recordId) } });
    if (!post) return errorResponse(res, 'not_found', 404);
    successResponse(res, { post_id: post.id });
  } catch (err) { next(err); }
});

router.post('/', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id = null, conversation_id = null, title, content_json = null, category = null, status = 'published', is_pinned = false, parent_post_id = null, kind = 'doc' } = req.body || {};
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
    // parent_post_id 가 있으면 같은 워크스페이스 post 검증 (자료정리 → 후속 문서 양방향 링크)
    if (parent_post_id) {
      const parent = await Post.findOne({ where: { id: parent_post_id, business_id } });
      if (!parent) return errorResponse(res, 'invalid parent_post_id', 400);
    }
    // kind='table' 이면 빈 q_record 자동 생성 — 컬럼 0, 행 0. 사용자가 직접 컬럼 추가.
    let qRecordId = null;
    if (kind === 'table') {
      const { QRecord } = require('../models');
      const qrec = await QRecord.create({
        business_id,
        project_id: project_id || null,
        name: String(title).slice(0, 200),
        category,
        columns: [],
        read_policy: 'all',
        created_by: req.user.id,
      });
      qRecordId = qrec.id;
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
      parent_post_id: parent_post_id || null,
      kind: ['doc', 'table', 'brief', 'template'].includes(kind) ? kind : 'doc',
      q_record_id: qRecordId,
      vlevel: project_id ? 'L2' : 'L1',  // VISIBILITY_VOCABULARY.md — 프로젝트=팀 / 미연결=개인
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
    require('../services/auditService').logAudit(req, {
      action: 'post.create',
      targetType: 'post',
      targetId: post.id,
      newValue: { title: post.title, category: post.category, status: post.status, project_id: post.project_id },
    });
    broadcastPost(req, full, 'post:new');
    successResponse(res, serialize(full, true), 'Post created', 201);
  } catch (err) { next(err); }
});

// ─── 자료정리 후속 문서 생성 (Manual / AI) ───
// POST /api/posts/:id/follow-up
//   parent post (category='brief') 의 brief_meta 기반으로 새 post 생성
//   body: { mode: 'manual' | 'ai', kind: 'meeting_note'|'proposal'|'quote'|'contract'|'nda'|'sop'|'custom', title? }
//   응답: { post: serialize() }
router.post('/:id/follow-up', authenticateToken, async (req, res, next) => {
  try {
    const parent = await Post.findByPk(req.params.id);
    if (!parent) return errorResponse(res, 'parent_not_found', 404);
    if (parent.category !== 'brief') return errorResponse(res, 'parent_not_brief', 400);
    if (!(await assertMember(req.user.id, parent.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { mode = 'manual', kind: rawKind, title: rawTitle } = req.body || {};
    const VALID_KINDS = ['meeting_note', 'proposal', 'quote', 'contract', 'nda', 'sop', 'custom'];
    const kind = VALID_KINDS.includes(rawKind) ? rawKind : 'custom';
    if (!['manual', 'ai'].includes(mode)) return errorResponse(res, 'invalid_mode', 400);

    const title = String(rawTitle || `${KIND_LABEL_KO[kind] || kind} — ${parent.title}`).slice(0, 200);

    let contentJson = null;
    let contentText = null;

    if (mode === 'ai') {
      // brief 본문(요약 + timeline + by_file) 을 user_input 으로 → AI 가 후속 문서 작성
      const meta = parent.brief_meta || {};
      const briefSummary = String(meta.summary || '').slice(0, 1500);
      const timelineText = (Array.isArray(meta.timeline) ? meta.timeline : []).slice(0, 30)
        .map((t) => `- ${t.when || ''}: ${t.title || ''} — ${(t.content || '').slice(0, 200)}`).join('\n');
      const byFileText = (Array.isArray(meta.by_file) ? meta.by_file : []).slice(0, 20)
        .map((f) => `[${f.source}]\n요약: ${f.summary || ''}\n${(f.key_points || []).map(p => `• ${p}`).join('\n')}`).join('\n\n');
      const userPrompt = `## 원본 자료정리 요약\n${briefSummary}\n\n${timelineText ? `## 시점별\n${timelineText}\n\n` : ''}${byFileText ? `## 자료별\n${byFileText}\n\n` : ''}## 작성할 문서\n종류: ${KIND_LABEL_KO[kind] || kind}\n제목: ${title}\n위 자료를 바탕으로 ${KIND_LABEL_KO[kind] || kind}를 작성하세요.`;
      const systemPrompt = `당신은 ${KIND_LABEL_KO[kind] || kind} 작성 전문가입니다. 주어진 자료를 바탕으로 ${KIND_LABEL_KO[kind] || kind} 형식의 문서를 한국어로 작성하세요. 문체는 비즈니스 격식체. 결론·핵심·실행 항목이 명확하게 구조화되도록 헤더(##)와 불릿(-) 적절히 사용. 마크다운 형식으로 작성.`;
      const cueOrch = require('../services/cue_orchestrator');
      const result = await cueOrch.generateDocumentDraft(parent.business_id, { systemPrompt, userPrompt, maxTokens: 2500 });
      if (result.error === 'usage_limit_exceeded') {
        return res.status(429).json({ success: false, message: 'cue_limit_exceeded', usage: result.usage });
      }
      if (result.error) return errorResponse(res, result.error, 500);
      // 마크다운 → 단순 TipTap doc 으로 (헤더·문단·리스트 처리)
      contentJson = JSON.stringify(markdownToTipTap(result.content || ''));
      contentText = (result.content || '').slice(0, 10_000);
    }

    const post = await Post.create({
      business_id: parent.business_id,
      project_id: parent.project_id,
      conversation_id: parent.conversation_id,
      title,
      content_json: contentJson,
      content_text: contentText,
      category: kind,
      author_id: req.user.id,
      parent_post_id: parent.id,
      vlevel: parent.vlevel || (parent.project_id ? 'L2' : 'L1'),  // 부모 visibility 상속
    });

    require('../services/auditService').logAudit(req, {
      action: 'post.follow_up.create',
      targetType: 'post',
      targetId: post.id,
      newValue: { kind, mode, parent_post_id: parent.id, title },
    });

    const full = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
      ],
    });
    broadcastPost(req, full, 'post:new');
    return successResponse(res, serialize(full, true), 'Follow-up created', 201);
  } catch (err) { next(err); }
});

const KIND_LABEL_KO = {
  meeting_note: '회의록', proposal: '제안서', quote: '견적서',
  contract: '계약서', nda: 'NDA', sop: '운영 가이드', custom: '문서',
};

// 마크다운 → TipTap JSON (단순 변환 — heading/paragraph/bulletList 만)
function markdownToTipTap(md) {
  const lines = String(md || '').split('\n');
  const content = [];
  let bullets = null;
  const flushBullets = () => {
    if (bullets && bullets.length) {
      content.push({
        type: 'bulletList',
        content: bullets.map(b => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: b }] }],
        })),
      });
    }
    bullets = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushBullets(); continue; }
    const h2 = /^##\s+(.*)$/.exec(line);
    const h3 = /^###\s+(.*)$/.exec(line);
    const h1 = /^#\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (h1 || h2 || h3) {
      flushBullets();
      const txt = (h1 || h2 || h3)[1];
      const lvl = h1 ? 1 : h2 ? 2 : 3;
      content.push({ type: 'heading', attrs: { level: lvl }, content: [{ type: 'text', text: txt }] });
    } else if (bullet) {
      if (!bullets) bullets = [];
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
    }
  }
  flushBullets();
  return { type: 'doc', content };
}

// ─── 자료정리에서 파생된 후속 문서 목록 ───
// GET /api/posts/:id/children
//   parent post 가 brief 일 때 children (parent_post_id = :id) 반환. 양방향 링크 표시용.
router.get('/:id/children', authenticateToken, async (req, res, next) => {
  try {
    const parent = await Post.findByPk(req.params.id);
    if (!parent) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, parent.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const children = await Post.findAll({
      where: { parent_post_id: parent.id },
      attributes: ['id', 'title', 'category', 'author_id', 'created_at'],
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'DESC']],
    });
    return successResponse(res, children.map(c => ({
      id: c.id, title: c.title, category: c.category, created_at: c.created_at,
      author: c.author ? { id: c.author.id, name: c.author.name } : null,
    })));
  } catch (err) { next(err); }
});

// ─── 자료정리 (Brief) — 텍스트·파일 여러 개 → AI 통합 정리 → Post 생성 ───
// POST /api/posts/brief
//   body: { business_id, project_id?, conversation_id?, title, text_blocks: string[], attached_file_ids: number[] }
//   응답: { post, brief_meta, recommended_next_kind, recommended_next_reason }
//   한도 초과 시 429 + { usage }
router.post('/brief', authenticateToken, async (req, res, next) => {
  try {
    const {
      business_id, project_id = null, conversation_id = null,
      title, text_blocks = [], attached_file_ids = [], attached_post_ids = [],
    } = req.body || {};
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!title || !String(title).trim()) return errorResponse(res, 'title required', 400);
    if (!(await assertMember(req.user.id, Number(business_id), req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    if (project_id) {
      const p = await Project.findOne({ where: { id: project_id, business_id } });
      if (!p) return errorResponse(res, 'invalid project_id', 400);
    }
    const blocks = Array.isArray(text_blocks) ? text_blocks.filter(t => typeof t === 'string') : [];
    const fileIds = Array.isArray(attached_file_ids)
      ? attached_file_ids.map(Number).filter(Number.isFinite)
      : [];
    const postIds = Array.isArray(attached_post_ids)
      ? attached_post_ids.map(Number).filter(Number.isFinite)
      : [];
    if (blocks.length === 0 && fileIds.length === 0 && postIds.length === 0) {
      return errorResponse(res, 'at least one text block, file, or post required', 400);
    }
    const briefSvc = require('../services/brief_service');
    let result;
    try {
      result = await briefSvc.buildAndCreatePost({
        business_id: Number(business_id),
        project_id: project_id || null,
        conversation_id: conversation_id || null,
        title,
        text_blocks: blocks,
        attached_file_ids: fileIds,
        attached_post_ids: postIds,
        created_by: req.user.id,
      });
    } catch (e) {
      if (e.message === 'cue_limit_exceeded') {
        return res.status(429).json({ success: false, message: 'cue_limit_exceeded', usage: e.usage });
      }
      throw e;
    }
    require('../services/auditService').logAudit(req, {
      action: 'post.brief.create',
      targetType: 'post',
      targetId: result.post.id,
      newValue: {
        title: result.post.title,
        view_kind: result.brief_meta?.view_kind,
        timeline_count: result.brief_meta?.timeline_count,
        recommended_next_kind: result.recommended_next_kind,
      },
    });
    return successResponse(res, {
      post_id: result.post.id,
      title: result.post.title,
      brief_meta: result.brief_meta,
      recommended_next_kind: result.recommended_next_kind,
      recommended_next_reason: result.recommended_next_reason,
    }, 'Brief created', 201);
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
    // 다른 post 연결 — 자기 자신·중복 제거 + 같은 워크스페이스 내 post 만 허용
    if (req.body.linked_post_ids !== undefined) {
      const raw = Array.isArray(req.body.linked_post_ids) ? req.body.linked_post_ids : [];
      const candidate = [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n !== post.id))];
      if (candidate.length > 0) {
        const valid = await Post.findAll({
          where: { id: candidate, business_id: post.business_id },
          attributes: ['id'],
        });
        patch.linked_post_ids = valid.map(p => p.id);
      } else {
        patch.linked_post_ids = [];
      }
    }
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
    const oldSnapshot = { title: post.title, category: post.category, status: post.status, project_id: post.project_id, is_pinned: post.is_pinned };
    await post.update(patch);
    require('../services/auditService').logAudit(req, {
      action: 'post.update',
      targetType: 'post',
      targetId: post.id,
      oldValue: oldSnapshot,
      newValue: { ...oldSnapshot, ...patch, content_json: undefined, content_text: undefined },  // 본문은 audit 에 안 담음 (revision 별도)
    });
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
    broadcastPost(req, full, 'post:updated');
    successResponse(res, serialize(full, true), 'Post updated');
  } catch (err) { next(err); }
});

// ─── Visibility 변경 (사이클 N+9) ───
// PUT /api/posts/:id/visibility  body: { level: 'L1'|'L2'|'L3', project_id? }
// L2 → project_id 필수. 권한: author 본인 또는 workspace owner/admin
router.put('/:id/visibility', authenticateToken, async (req, res, next) => {
  try {
    const { level, project_id } = req.body || {};
    if (!['L1', 'L2', 'L3'].includes(level)) return errorResponse(res, 'invalid_level', 400);
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    const scope = await getUserScope(req.user.id, post.business_id, req.user.platform_role);
    const isAuthor = post.author_id === req.user.id;
    const isOwner = scope.isOwner || scope.isPlatformAdmin;
    if (!isAuthor && !isOwner) return errorResponse(res, 'forbidden', 403);

    let nextProjectId = post.project_id;
    if (level === 'L2') {
      if (project_id) nextProjectId = Number(project_id);
      if (!nextProjectId) return errorResponse(res, 'project_id_required_for_L2', 400);
    } else if (level === 'L1' || level === 'L3') {
      nextProjectId = null;
    }
    await post.update({ vlevel: level, project_id: nextProjectId });
    broadcastPost(req, post, 'post:updated');
    successResponse(res, { id: post.id, vlevel: level, project_id: nextProjectId });
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
    const snapshot = { title: post.title, category: post.category, status: post.status, project_id: post.project_id };
    await PostAttachment.destroy({ where: { post_id: post.id } });
    const snapForBroadcast = { id: post.id, business_id: post.business_id, project_id: post.project_id };
    await post.destroy();
    require('../services/auditService').logAudit(req, {
      action: 'post.delete',
      targetType: 'post',
      targetId: post.id,
      businessId: post.business_id,
      oldValue: snapshot,
    });
    broadcastPost(req, snapForBroadcast, 'post:deleted');
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
    broadcastPost(req, post, 'post:updated');
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
    broadcastPost(req, post, 'post:updated');
    successResponse(res, null, 'Detached');
  } catch (err) { next(err); }
});

// ─── 에디터 인라인 이미지 업로드 ───
// POST /api/posts/editor-image  multipart 'file' + body/query.business_id
// 사이클 N+9 통합: 인라인 이미지도 표준 File 테이블에 등록 (Q file 메뉴 노출 + share-link
// 인프라 + visibility/quota 일관 적용). business_id 없으면 legacy 동작 (DB row 없음).
// 응답: { url, file_id?, download_url? }
router.post('/editor-image', authenticateToken, (req, res, next) => {
  editorImageUpload.single('file')(req, res, async (err) => {
    try {
      if (err) return errorResponse(res, err.message || 'upload_failed', 400);
      if (!req.file) return errorResponse(res, 'file_required', 400);

      const url = `/api/posts/editor-image/${req.file.filename}`;
      const businessId = Number(req.body?.business_id || req.query?.business_id || 0);
      if (!businessId) {
        // legacy fallback — business_id 없으면 DB 등록 X (옛 호출자 호환)
        return successResponse(res, { url }, 'uploaded');
      }
      // 워크스페이스 멤버 확인
      if (!(await assertMember(req.user.id, businessId, req.user.platform_role === 'platform_admin'))) {
        return errorResponse(res, 'forbidden', 403);
      }
      // 표준 File 등록 — visibility L3 (워크스페이스) — 본문 인라인 이미지는 그 문서와 동일 노출 범위.
      // 옛 L1(개인) 정책은 사용자가 Q File 리스트에서 자기 본문 이미지 못 찾는 회귀 유발 → L3 로 변경.
      const file = await File.create({
        business_id: businessId,
        uploader_id: req.user.id,
        file_name: decodeOriginalName(req.file.originalname),
        file_path: req.file.path,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        storage_provider: 'planq',
        visibility: 'L3',
      });
      successResponse(res, {
        url,
        file_id: file.id,
        download_url: `/api/files/${businessId}/${file.id}/download`,
      }, 'uploaded');
    } catch (e) { next(e); }
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
    // 공유 미리보기 — attachments 의 download_url 을 공개 라우트로 매핑 (인증 없이 다운로드 가능).
    // 사이클 N+9 fix: 옛 download_url 은 /api/files/:bizId/:id/download (인증 필요) — 공개 페이지에선 401.
    const token = req.params.token;
    if (Array.isArray(safe.attachments)) {
      safe.attachments = safe.attachments.map(a => a.file ? {
        ...a,
        file: { ...a.file, download_url: `/api/posts/public/${token}/attachments/${a.id}/download` },
      } : a);
    }
    delete safe.share_token;
    return successResponse(res, safe);
  } catch (err) { next(err); }
});

// GET /api/posts/public/:token/attachments/:attId/download
// 공유 미리보기에서 첨부 파일 다운로드 (인증 없이 share_token 기반).
// post.share_token 검증 + 해당 post 의 attachments 중 하나 → 파일 스트리밍.
router.get('/public/:token/attachments/:attId/download', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { share_token: req.params.token, status: 'published' },
      attributes: ['id'],
    });
    if (!post) return errorResponse(res, 'not_found_or_expired', 404);
    const att = await PostAttachment.findOne({
      where: { id: req.params.attId, post_id: post.id },
      include: [{ model: File, as: 'file' }],
    });
    if (!att || !att.file) return errorResponse(res, 'attachment_not_found', 404);
    const file = att.file;
    if (file.storage_provider !== 'planq') {
      if (file.external_url) return res.redirect(file.external_url);
      return errorResponse(res, 'external_file_no_url', 400);
    }
    const fsLocal = require('fs');
    if (!fsLocal.existsSync(file.file_path)) return errorResponse(res, 'physical_file_missing', 410);
    // 한글 파일명 안전 — RFC 5987 filename*=UTF-8'' 우선 + ASCII fallback. res.download 의 default
    // Content-Disposition 는 ASCII only 라 한글 깨짐 → 직접 헤더 설정 후 sendFile.
    res.setHeader('Content-Disposition', buildContentDisposition(file.file_name));
    if (file.mime_type) res.setHeader('Content-Type', file.mime_type);
    return res.sendFile(path.resolve(file.file_path));
  } catch (err) { next(err); }
});

module.exports = router;
