// 문서 (Posts) CRUD — 포스팅 기반 문서 (매뉴얼/가이드/공지 등)
// project_id NULL = 워크스페이스 전역 문서, NOT NULL = 프로젝트 소속
const express = require('express');
const router = express.Router();
const { blockIfSigned } = require('../services/signatureCore');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Post, PostAttachment, PostCategory, File, User, Project, BusinessMember, Business, Conversation, Message } = require('../models');
const { sequelize } = require('../config/database');   // 카테고리 이름변경·삭제는 문서 값과 한 트랜잭션이어야 한다
const { decodeOriginalName, buildContentDisposition } = require('../services/filename');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope, postListWhereByLevel, canAccessPostByLevel, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { sendPostShareEmail } = require('../services/emailService');
const { isValidLevel, blocksExternalShare } = require('../services/securityLevel');
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../services/displayName');
const { broadcastFile } = require('../services/fileBroadcast');   // 파일 실시간 반영 단일 원천 (#378)

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
  if (scope.isPlatformAdmin || scope.isOwner || scope.isMember || scope.isAdmin || scope.isClient) return { ok: true, scope };
  return { ok: false, scope: null };
}

// 문서 편집 권한 — **공개 범위와 같은 축**을 쓴다 (2026-08-21).
//
//   여태 편집은 작성자·owner·platform_admin 만이었다. 공개 범위를 워크스페이스로 열어도
//   **읽기만 열리고 편집은 안 열려서**, 같이 문서를 만들어가는 것이 불가능했다
//   (운영: "내가 작성한 문서는 다른 직원이 수정 못해? 같이 화이트보드처럼 업데이트해야 하는데").
//
//   새 규칙: **볼 수 있으면 고칠 수 있다.** 단 아래는 그대로 둔다.
//     · L1(개인) 문서 — 작성자만. 공개하지 않은 글을 남이 고치면 안 된다.
//     · 고객(Client) — assertMember 에서 이미 막힌다. 읽기·컨펌만.
//     · 삭제 — 편집과 다른 축이다. 파괴적이고 되돌릴 수 없어 작성자·owner 로 유지한다.
async function canEditPost(userId, post, platformRole) {
  if (platformRole === 'platform_admin') return true;
  if (post.author_id === userId) return true;
  // L1 = 개인 문서. 작성자 외에는 owner/admin 도 편집하지 않는다(읽기도 안 되는 등급이다).
  if (post.vlevel === 'L1') {
    const scope0 = await getUserScope(userId, post.business_id, platformRole);
    return !!(scope0.isOwner || scope0.isAdmin);
  }
  const scope = await getUserScope(userId, post.business_id, platformRole);
  return canAccessPostByLevel(userId, post, scope);
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

// 블록 구조를 살린 본문 추출 — 문단·제목·목록 경계에서 줄을 나눈다.
//
// 위 extractText 와 용도가 다르다. 그건 **검색·미리보기용 파생값**이라 공백을 전부 뭉개고 5000자에서
// 자른다 — 개행이 애초에 없다. 공유 페이지에서 사람이나 AI 가 읽을 본문을 그걸로 만들면 한 덩어리
// 문장이 되고 장문은 잘린다. 원본(content_json)에서 다시 뽑는 이유다.
//
// 추출 로직의 소재지는 이 파일 한 곳으로 둔다 — 같은 값을 뽑는 코드가 두 벌이면 반드시 갈라진다.
const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow', 'taskItem',
]);

function extractBlockText(json, { maxChars = 100000 } = {}) {
  if (!json) return [];
  try {
    const obj = typeof json === 'string' ? JSON.parse(json) : json;
    const blocks = [];
    let cur = [];
    const flush = () => {
      const t = cur.join('').replace(/[ \t]+/g, ' ').trim();
      if (t) blocks.push(t);
      cur = [];
    };
    const walk = (n) => {
      if (!n) return;
      if (n.type === 'hardBreak') { cur.push('\n'); return; }
      if (n.text) cur.push(n.text);
      if (Array.isArray(n.content)) n.content.forEach(walk);
      if (BLOCK_TYPES.has(n.type)) flush();
    };
    walk(obj);
    flush();
    // 총량 캡 — 비정상적으로 긴 문서가 응답을 부풀리지 않게 한다.
    const out = [];
    let used = 0;
    for (const b of blocks) {
      if (used + b.length > maxChars) { out.push(b.slice(0, Math.max(0, maxChars - used))); break; }
      out.push(b);
      used += b.length;
    }
    return out.filter(Boolean);
  } catch { return []; }
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
    // N+72-7 — serialize 에 vlevel/target_member_ids 빠져 있어 PUT 응답에 안 실리는 회귀 fix
    vlevel: p.vlevel || (p.project_id ? 'L2' : 'L3'),
    security_level: p.security_level || 'general',
    target_member_ids: Array.isArray(p.target_member_ids) ? p.target_member_ids : null,
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
          // 공유 모달이 "이 첨부가 공개 링크로 나가는가" 를 표시하는 근거(#378 후속).
          //   이 화이트리스트에 없어서 프론트가 늘 undefined 를 읽었고, 그래서 **이미 공개된
          //   첨부까지 "링크로 안 나감" 으로 표시**됐다 — 소유자에게 노출을 과소보고하는 거짓 안내였다.
          //   ※ 공개 응답에는 L4 첨부만 실리므로 여기에 등급이 실려도 새는 정보가 없다.
          vlevel: a.file.vlevel,
          visibility: a.file.visibility,
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
    // #252 — 임시저장(draft)은 작성자에게만 보인다.
    //   자동저장이 첫 입력 시점에 draft 를 만들기 때문에, 이 필터가 없으면 **반쯤 쓴 글이
    //   워크스페이스 전 목록에 즉시 뜬다.** vlevel='L1' 로도 격리되지만 그건 draft 가
    //   L1 로 생성된 경우에만이라, status 축에서도 한 번 더 막는다(이중 방어).
    where[Op.and] = [
      ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
      { [Op.or]: [{ status: { [Op.ne]: 'draft' } }, { author_id: req.user.id }] },
    ];
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
      const qStr = String(req.query.q).normalize('NFC');   // #364 검색어 조합형 통일
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
      // ★ `where[Op.or] = orConds` 로 **대입하면 baseWhere 의 가시등급 조건이 통째로 지워진다.**
      //   baseWhere 는 `{business_id, [Op.or]: 가시성조건}` 이라, 검색어를 넣는 순간 남는 건
      //   business_id 뿐이었다 — 실측(2026-09-02 보안감사): 평멤버가 `?q=` 를 붙이면
      //   **타인의 L1(개인) 문서**와 **미참여 프로젝트의 L2 문서**가 본문 미리보기까지 떴다
      //   (같은 문서의 상세 GET 은 403 인데 목록만 샜다).
      //   위 draft 필터와 같은 방식으로 **Op.and 에 합친다** — 기존 조건을 지우지 않는다.
      where[Op.and] = [
        ...(Array.isArray(where[Op.and]) ? where[Op.and] : []),
        { [Op.or]: orConds },
      ];
    }
    // 사이클 N+50 — pagination. 기존 hardcoded limit 200 정형화. include 1:1 → distinct:true 안전
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await Post.findAndCountAll({
      where,
      include,
      order: [['is_pinned', 'DESC'], ['updated_at', 'DESC']],
      limit, offset,
      distinct: true,
    });
    // 워크스페이스 표시명 우선 (author/editor) — 계정 이름 노출 방지
    const items = rows.map(r => serialize(r));
    await applyMemberDisplayName(items, businessId, ['author', 'editor']);
    return paginatedResponse(res, items, count, { limit, page, offset });
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

    // 마스터 카테고리 테이블 (빈 카테고리 포함)
    //   🔴 운영 실버그(Fable 발견 2026-08-18) — 여기에 `scopeWhere` 를 그대로 넘기고 있었다.
    //   scopeWhere 는 **Post 의 가시성 술어**(vlevel·visibility·target_member_ids …)를 담는데
    //   `post_categories` 엔 그런 컬럼이 없다 → member/client 요청이 통째로 500
    //   (`Unknown column 'PostCategory.vlevel'`). owner 는 술어가 단순해 우연히 통과했다.
    //   카테고리는 **가시성 대상이 아니라 마스터 목록**이다 — 워크스페이스/프로젝트 축만 쓴다.
    //   (memory: feedback_column_reference_must_exist — 없는 컬럼 참조는 catch 에 삼켜져 안 보인다)
    const catWhere = { business_id: businessId };
    if (Object.prototype.hasOwnProperty.call(scopeWhere, 'project_id')) {
      catWhere.project_id = scopeWhere.project_id;
    }
    const masterCats = await PostCategory.findAll({
      where: catWhere,
      order: [['sort_order', 'ASC'], ['name', 'ASC']],
    });
    for (const mc of masterCats) {
      if (!catMap.has(mc.name)) catMap.set(mc.name, 0);
    }
    // 운영 #401 — "카테고리를 추가했는데 수정 및 삭제가 안돼."
    //   목록에 **id 가 없었다.** 화면은 이름만 받아서, 수정·삭제 라우트를 부를 방법이 아예 없었다
    //   (삭제 함수는 services 에 있는데 호출부가 0곳이었다 — 만들어 놓고 읽는 곳이 없는 계열).
    //   마스터에 없는 이름(문서에만 남은 옛 값)은 id 가 null 이다 — 화면이 그것으로 구별한다.
    const catIdByName = new Map(masterCats.map((mc) => [mc.name, mc.id]));

    successResponse(res, {
      total: all.length,
      myCount,
      categories: Array.from(catMap.entries())
        .map(([name, count]) => ({ id: catIdByName.get(name) ?? null, name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
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
    // ★ silent — 조회수 증가가 updated_at 을 건드리면 안 된다.
    //   (a) 문서를 **열기만 해도** updated_at 이 바뀌어 편집 낙관적 잠금(#252)이 즉시 거짓 409 를 낸다
    //   (b) 목록 정렬이 ['updated_at','DESC'] 라 남이 열어보기만 해도 순서가 뒤바뀐다
    await post.increment('view_count', { silent: true });
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
    await applyMemberDisplayNameOne(result, post.business_id, ['author', 'editor']);
    successResponse(res, result);
  } catch (err) { next(err); }
});

// ─── 생성 ───
// /records/:id (폐지된 옛 경로) → post 로 redirect 용
router.get('/by-record/:recordId', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findOne({ where: { q_record_id: Number(req.params.recordId) } });
    if (!post) return errorResponse(res, 'not_found', 404);
    // ★ 멤버십 검사 (Fable 구현 검증 게이트 2026-09-01 지적).
    //   여태 authenticateToken 만 걸려 있어, **다른 워크스페이스**의 record id 를 넣어도
    //   post_id 가 그대로 돌아왔다. 내용은 상세 라우트에서 403 이지만 **그 표가 존재한다는 사실**과
    //   내부 id 가 새어 나간다(id 를 훑으면 남의 워크스페이스에 표가 몇 개 있는지도 알 수 있다).
    //   이 라우트는 폐지된 옛 경로(/records/:id)를 post 로 보내는 리다이렉트 보조라
    //   조회 권한을 따로 둘 이유가 없다 — 같은 워크스페이스 멤버만 통과시킨다.
    //   ★ not_found 검사보다 **뒤에** 두지 않는다면 존재 여부가 응답 코드로 갈리므로,
    //     비멤버에게는 404 와 구별되지 않게 403 을 준다(존재 자체를 알리지 않는다).
    if (!(await assertMember(req.user.id, Number(post.business_id), req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
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
    // kind='table' 이면 q_record 자동 생성 — #96: 빈 표가 아니라 기본 컬럼 3개 + 빈 행 1개 시드
    //   (옛: columns 0·rows 0 → 처음부터 설정해야 했음. Irene 결정: 즉시 쓸 수 있는 기본 테이블).
    let qRecordId = null;
    if (kind === 'table') {
      const { QRecord, QRecordRow } = require('../models');
      const lang = req.user.language === 'en' ? 'en' : 'ko';
      const L = (ko, en) => (lang === 'en' ? en : ko);
      const colId = () => 'c_' + Math.random().toString(36).slice(2, 10);
      const defaultCols = [
        { id: colId(), name: L('제목', 'Title'), type: 'text', order: 0 },
        { id: colId(), name: L('상태', 'Status'), type: 'select', order: 1,
          options: [L('시작 전', 'Not started'), L('진행 중', 'In progress'), L('완료', 'Done')] },
        { id: colId(), name: L('메모', 'Notes'), type: 'longtext', order: 2 },
      ];
      const qrec = await QRecord.create({
        business_id,
        project_id: project_id || null,
        name: String(title).slice(0, 200),
        category,
        columns: defaultCols,
        read_policy: 'all',
        created_by: req.user.id,
      });
      // 빈 행 1개 — 사용자가 바로 입력 시작 (#96 "기본 테이블이 나와야")
      await QRecordRow.create({ q_record_id: qrec.id, values: {}, position: 0, created_by: req.user.id });
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
      // N+72 fix — 신규 문서 default visibility.
      // 옛: 프로젝트 = L2 / 미연결 = L1 (나만보기) — 사용자 호소 "공유한 문서를 다른 사람이 못 봄"
      // 새: 프로젝트 = L2 / 워크스페이스 = L3 (멤버 모두) — 일반 SaaS 패턴.
      //      L1 원하면 등록 후 "공유 범위 → 나만보기" 변경 (UI 명시 동작).
      // #252 — 임시저장으로 만들어지는 글은 **무조건 L1(작성자 본인만)**.
      //   자동저장이 첫 입력에 POST 를 쏘므로, 기본 L2/L3 를 그대로 두면 아직 문장도 안 끝난
      //   글이 프로젝트 멤버·워크스페이스 전원에게 보인다. 명시 저장 시점에 사용자가 고른
      //   공개 범위로 승격된다(프론트 submit 이 vlevel 을 같이 보낸다).
      vlevel: status === 'draft' ? 'L1' : (req.body.vlevel || (project_id ? 'L2' : 'L3')),
    });
    const full = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    // #252 — 임시저장 단계에서는 부수효과를 일으키지 않는다. 아직 "만들어진 문서" 가 아니라
    //   타이핑 중인 상태다. stage 진행·감사 기록·전 워크스페이스 broadcast 를 여기서 쏘면
    //   글 하나 쓰는 동안 거래 단계가 움직이고 남의 화면에 "새 문서" 가 뜬다.
    //   명시 저장(status='published' 로 승격되는 PUT)에서 전부 발화한다.
    const isDraft = post.status === 'draft';
    if (post.project_id && !isDraft) {
      require('../services/projectStageEngine').onPostChanged(post.id).catch(() => null);
    }
    if (!isDraft) {
      require('../services/auditService').logAudit(req, {
        action: 'post.create',
        targetType: 'post',
        targetId: post.id,
        newValue: { title: post.title, category: post.category, status: post.status, project_id: post.project_id },
      });
      broadcastPost(req, full, 'post:new');
    }
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
    const items = children.map(c => ({
      id: c.id, title: c.title, category: c.category, created_at: c.created_at,
      author: c.author ? { id: c.author.id, name: c.author.name } : null,
    }));
    await applyMemberDisplayName(items, parent.business_id, ['author']);
    return successResponse(res, items);
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
    // N+41: brief post 도 일반 post 와 동일하게 socket broadcast.
    // PostsPage / BriefViewerPage 가 다른 사용자 액션 즉시 반영. CLAUDE.md 16번.
    try {
      broadcastPost(req, result.post, 'post:new');
    } catch (e) { console.warn('[brief broadcast]', e.message); }
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
    // 서명 잠금 — 판정은 services/signatureLock 단일 착지점. 본문 수정(자동저장도 이 라우트를 쓴다).
    if (await blockIfSigned(res, req.params.id)) return;
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // 볼 수 있으면 고칠 수 있다 — 공개 범위와 같은 축. (L1 개인 문서는 예외: 작성자·owner 만)
    if (!(await canEditPost(req.user.id, post, req.user.platform_role))) {
      return errorResponse(res, 'post_edit_forbidden', 403);
    }
    // #252 낙관적 잠금 — 자동저장이 붙으면 PUT 빈도가 수십 배로 뛴다. 잠금이 없으면
    //   내 자동저장이 그 사이 남이 저장한 본문을 통째로 덮어쓴다(last-write-wins).
    //   클라이언트가 편집 시작 시점의 updated_at 을 같이 보내고, 서버 것과 다르면 409.
    //   프론트는 409 를 받으면 자동저장을 멈추고 배너로 알린다 — 조용히 덮지 않는다.
    if (req.body.base_updated_at) {
      const base = new Date(req.body.base_updated_at).getTime();
      const cur = new Date(post.updated_at || post.updatedAt).getTime();
      // ★ 밀리초까지 비교된다 — posts.updated_at 은 DATETIME(3) 이다(models/Post.js 참조).
      //   초 정밀도(DATETIME)면 "같은 초 안의 두 저장" 이 base == cur 로 통과해 남의 글을 덮는다.
      //   editor_id 로 구분하려던 시도는 틀렸다: 남이 오래 전에 편집한 문서를 처음 여는 정상 케이스와
      //   구분이 안 돼 모든 타인 문서 편집이 거짓 409 가 된다. 정밀도 자체를 올려야 풀린다.
      if (Number.isFinite(base) && Number.isFinite(cur) && base < cur) {
        // ★ **마지막으로 저장한 사람이 누구인지 같이 준다.**
        //   이 잠금은 "남의 저장을 덮지 않는다" 가 목적인데, 실제로는 **혼자 쓰는 중에도** 자주 터졌다
        //   (Irene 2026-08-20 운영 신고: "나만 수정중인데"). 내 저장으로 서버가 앞서 나간 것이면
        //   충돌이 아니라 **내 기준이 낡은 것**이므로, 클라이언트가 기준을 갱신하고 한 번 재시도하면 된다.
        //   판정 근거를 서버가 주지 않으면 클라이언트는 "남" 과 "나" 를 구별할 수 없어 막힌다.
        const lastEditor = post.editor_id || post.author_id;
        return res.status(409).json({
          success: false, code: 'stale_edit',
          message: '다른 사람이 이 문서를 수정했습니다. 새로고침 후 이어서 작성해 주세요.',
          data: {
            current_updated_at: post.updated_at || post.updatedAt,
            last_editor_id: lastEditor,
            by_me: lastEditor === req.user.id,
          },
        });
      }
    }
    // 자동저장 PUT — 타이핑 중이라는 뜻. 감사 로그·거래 stage 는 명시 저장에서만 발화한다
    //   (안 그러면 글 하나 쓰는 동안 audit_logs 에 수십 row 가 쌓이고 stage 가 흔들린다).
    const isAutosave = req.body.autosave === true;
    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).slice(0, 200);
    if (req.body.content_json !== undefined) {
      patch.content_json = req.body.content_json ? JSON.stringify(req.body.content_json) : null;
      patch.content_text = extractText(req.body.content_json);
    }
    if (req.body.category !== undefined) patch.category = req.body.category;
    if (req.body.status !== undefined) patch.status = req.body.status;
    if (req.body.is_pinned !== undefined) patch.is_pinned = !!req.body.is_pinned;
    // N+72-7 — 표 ↔ 문서 kind 전환 (사용자 호소)
    // 표 → 문서: q_record 가 비어있으면 자유, 컬럼/행 있으면 force_kind_change=true 필요
    // 문서 → 표: 자유 — 빈 q_record 자동 생성
    if (req.body.kind !== undefined && ['doc', 'table'].includes(req.body.kind) && req.body.kind !== post.kind) {
      const { QRecord } = require('../models');
      if (req.body.kind === 'doc' && post.kind === 'table' && post.q_record_id) {
        const qrec = await QRecord.findByPk(post.q_record_id);
        const hasContent = qrec && Array.isArray(qrec.columns) && qrec.columns.length > 0;
        if (hasContent && !req.body.force_kind_change) {
          return errorResponse(res, '표에 컬럼/데이터가 있습니다. 문서로 변경 시 모두 사라집니다. 확인 후 다시 시도해주세요. (force_kind_change=true)', 409);
        }
        // q_record 제거 + post 분리
        if (qrec) await qrec.destroy().catch(() => null);
        patch.kind = 'doc';
        patch.q_record_id = null;
      } else if (req.body.kind === 'table' && post.kind === 'doc') {
        const qrec = await QRecord.create({
          business_id: post.business_id,
          project_id: post.project_id,
          name: String(req.body.title || post.title).slice(0, 200),
          category: req.body.category || post.category,
          columns: [],
          read_policy: 'all',
          created_by: req.user.id,
        });
        patch.kind = 'table';
        patch.q_record_id = qrec.id;
      }
    }
    // 공개 범위 변경 (visibility — vlevel)
    if (req.body.vlevel !== undefined && ['L1', 'L2', 'L3', 'L4'].includes(req.body.vlevel)) {
      patch.vlevel = req.body.vlevel;
    }
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
    // draft → published 승격은 사용자 입장에서 "문서를 만든" 순간이다. draft 생성 시점의
    //   post.create 를 억제했으므로(타이핑 중이었다), 여기서 create 로 기록해야 감사 기록에
    //   구멍이 안 생긴다 — "모든 CUD 는 AuditLog" 운영 정책.
    const isPromotion = post.status === 'draft' && patch.status === 'published';
    await post.update(patch);
    // 버전 기록 — 자동저장이든 명시 저장이든 남긴다(서비스가 합치기·상한을 담당).
    //   실패해도 저장 자체는 성공시킨다. 다만 삼키지 말고 로그로 드러낸다.
    if (patch.title !== undefined || patch.content_json !== undefined || patch.category !== undefined) {
      try {
        await require('../services/postRevisions').recordRevision({
          post, editorUserId: req.user.id, source: isAutosave ? 'autosave' : 'manual',
        });
      } catch (e) { console.warn('[postRevisions]', e.message); }
    }
    if (!isAutosave) {
      require('../services/auditService').logAudit(req, {
        action: isPromotion ? 'post.create' : 'post.update',
        targetType: 'post',
        targetId: post.id,
        oldValue: oldSnapshot,
        newValue: { ...oldSnapshot, ...patch, content_json: undefined, content_text: undefined },  // 본문은 audit 에 안 담음 (revision 별도)
      });
    }
    const full = await Post.findByPk(post.id, {
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: User, as: 'editor', attributes: ['id', 'name'], required: false },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: Conversation, attributes: ['id', 'title', 'display_name'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    // Phase D+1: stage 자동 진행 (status/category 변경 가능성). 자동저장은 제외 — 위 주석 참조.
    if (full?.project_id && !isAutosave) require('../services/projectStageEngine').onPostChanged(full.id).catch(() => null);
    // draft 는 작성자만 볼 수 있으므로 broadcast 하지 않는다(받는 쪽은 어차피 목록에서 못 본다).
    //   draft → published 승격 PUT 은 status 가 바뀌었으므로 아래 조건을 통과해 정상 발화한다.
    if (full?.status !== 'draft') broadcastPost(req, full, 'post:updated');
    successResponse(res, serialize(full, true), 'Post updated');
  } catch (err) { next(err); }
});

// ─── Visibility 변경 (사이클 N+9 → N+67 L4 통일) ───
// PUT /api/posts/:id/visibility  body: { level: 'L1'|'L2'|'L3'|'L4', project_id? }
// L2 → project_id 필수. L4 → share_token 자동 발급 (없으면). 권한: author 본인 또는 workspace owner/admin
router.put('/:id/visibility', authenticateToken, async (req, res, next) => {
  try {
    const { level, project_id } = req.body || {};
    if (!['L1', 'L2', 'L3', 'L4'].includes(level)) return errorResponse(res, 'invalid_level', 400);
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    const scope = await getUserScope(req.user.id, post.business_id, req.user.platform_role);
    const isAuthor = post.author_id === req.user.id;
    const isOwner = scope.isOwner || scope.isPlatformAdmin;
    if (!isAuthor && !isOwner) return errorResponse(res, 'forbidden', 403);

    // ★ 운영 (Irene 2026-08-28): "프로젝트 > 문서에 왜 나만보기는 안나와? 보기표시 하고 나오긴 해야지."
    //   옛 코드는 L1/L3/L4 로 바꿀 때 project_id 를 **null 로 지웠다.** 그래서 프로젝트 문서를
    //   '나만보기' 로 바꾸는 순간 그 문서가 프로젝트에서 통째로 빠져나가, 목록(where project_id=?)에
    //   영영 안 걸렸다. 본인조차 못 찾는다.
    //   두 축을 섞어 쓴 것이 원인이다:
    //     · vlevel     = **누가 보는가**(공개 범위)
    //     · project_id = **어디에 속하는가**(소속)
    //   공개 범위를 좁힌다고 소속이 사라질 이유가 없다. 소속은 유지하고 범위만 바꾼다.
    //   L2 만 예외로 project_id 가 **필수**다 — 그때는 프로젝트가 곧 청중이기 때문이다.
    //   (목록에는 이미 RowVisChip 으로 공개 범위가 표시된다 = "보기표시 하고 나오긴 해야지")
    let nextProjectId = post.project_id;
    if (level === 'L2') {
      if (project_id) nextProjectId = Number(project_id);
      if (!nextProjectId) return errorResponse(res, 'project_id_required_for_L2', 400);
    } else if (project_id !== undefined) {
      // 호출자가 명시적으로 넘긴 경우만 소속 변경 (null 을 주면 '프로젝트에서 빼기')
      nextProjectId = project_id === null ? null : Number(project_id);
    }
    // D4 #62 — 보안등급 게이트: 일반 외 문서는 L4(외부 공개) 전환 차단
    if (level === 'L4' && blocksExternalShare(post)) {
      return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
    }
    const patch = { vlevel: level, project_id: nextProjectId };
    // N+67 — L4 선택 시 share_token 자동 발급 (없으면)
    if (level === 'L4' && !post.share_token) {
      const crypto = require('crypto');
      patch.share_token = crypto.randomBytes(24).toString('base64url');
      patch.shared_at = new Date();
    }
    await post.update(patch);
    broadcastPost(req, post, 'post:updated');
    successResponse(res, { id: post.id, vlevel: level, project_id: nextProjectId, share_token: post.share_token });
  } catch (err) { next(err); }
});

// ─── 삭제 ───
// 권한: 작성자(author) 또는 owner/platform_admin 만.
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    // 서명 잠금 — 삭제되면 서명 페이지가 entity_missing 404 가 된다(서명 대상 소멸).
    if (await blockIfSigned(res, req.params.id)) return;
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
    // 서명 잠금 — 판정은 services/signatureLock 단일 착지점. 별첨 추가.
    if (await blockIfSigned(res, req.params.id)) return;
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
    // 서명 잠금 — 판정은 services/signatureLock 단일 착지점. 별첨 삭제.
    if (await blockIfSigned(res, req.params.id)) return;
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

      // #97 — 본문 표시용은 리사이즈본 (?w=1600). 원본은 파라미터 없이 접근 가능.
      const url = `/api/posts/editor-image/${req.file.filename}?w=1600`;
      // ★ 운영 #378 잔여 — business_id 가 없으면 **File 행 없이** 통과시키던 자리다.
      //   그렇게 올라간 이미지는 본문에는 보이는데 파일 메뉴 어디에도 없다(운영 실측 9건).
      //   옛 번들이 안 보내도 토큰의 **활성 워크스페이스**로 착지시킨다 — 조용한 결손보다 낫다.
      //   ★ active_business_id 는 권한 근거가 아니다(멤버 해제 후 stale 가능) —
      //     바로 아래 assertMember 가 그 판정을 한다. 여기서는 "어디에 담을지" 만 정한다.
      const businessId = Number(req.body?.business_id || req.query?.business_id || req.user?.active_business_id || 0);
      if (!businessId) {
        // 워크스페이스를 끝내 못 정하면 등록할 곳이 없다. 조용히 넘기지 말고 로그를 남긴다.
        console.warn('[editor-image] business_id 없음 — File 미등록 (user', req.user?.id, ')');
        return successResponse(res, { url }, 'uploaded');
      }
      // 워크스페이스 멤버 확인
      if (!(await assertMember(req.user.id, businessId, req.user.platform_role === 'platform_admin'))) {
        return errorResponse(res, 'forbidden', 403);
      }
      // 운영 #378 — "문서 상세에 들어간 파일이나 이미지도 따로 파일메뉴로 들어가야 하는 거 아니야?
      //   프로젝트 > 파일에도 그렇고."
      //   워크스페이스 파일 목록에는 이미 떴다(L3). 안 뜨던 곳은 **프로젝트 > 파일** 이다 —
      //   이 라우트가 project_id 를 아예 안 받아 File 행이 project_id NULL 로 저장됐고,
      //   프로젝트 파일 목록은 `where.project_id = ?` 로 거르므로 영영 안 걸렸다.
      //   문서가 프로젝트 안에 있으면 그 이미지도 그 프로젝트 것이어야 한다.
      const projectId = Number(req.body?.project_id || req.query?.project_id || 0) || null;
      if (projectId) {
        // 남의 프로젝트 id 를 넘겨 파일을 심는 것 차단 — 같은 워크스페이스인지 확인.
        const prj = await Project.findOne({ where: { id: projectId, business_id: businessId }, attributes: ['id'] });
        if (!prj) return errorResponse(res, 'invalid_project', 400);
      }
      // 표준 File 등록 — 본문 인라인 이미지는 **그 문서와 동일 노출 범위**.
      //   프로젝트 문서면 L2(프로젝트 멤버), 워크스페이스 문서면 L3(워크스페이스).
      //   옛 L1(개인) 정책은 사용자가 Q File 리스트에서 자기 본문 이미지 못 찾는 회귀 유발 → 폐기됨.
      // ★ vlevel 이 권위 컬럼이다 — visibility 만 쓰면 모델 default('L3')로 저장돼 프로젝트 전용
      //   이미지가 워크스페이스 전체에 노출된다 (routes/files.js 의 같은 경고 참조).
      const level = projectId ? 'L2' : 'L3';

      // ★ 이 경로만 dedup·쿼터를 지나지 않았다 (운영 실측: editor-image 58건 전부 content_hash NULL).
      //   같은 이미지를 여러 문서에 붙이면 물리 파일이 매번 새로 쌓이고, 스토리지 사용량에도 안 잡혀
      //   플랜 한도가 헐거워진다. 표준 업로드(routes/files.js)·메일 첨부와 같은 규칙으로 맞춘다.
      //   ※ dedup 대상은 **같은 에디터 이미지 폴더 안**으로 제한한다 — 본문 URL 이
      //     `/api/posts/editor-image/<파일명>` 이라, 다른 폴더 파일을 재사용하면 그 URL 이 404 가 된다.
      const { sha256OfFile } = require('../utils/fileHash');
      const { reservePlanqUpload } = require('../services/storageUsage');
      let hash = null;
      try { hash = await sha256OfFile(req.file.path); } catch (e) { console.warn('[editor-image] hash 실패', e.message); }

      let twin = null;
      if (hash) {
        twin = await File.findOne({
          where: {
            business_id: businessId, content_hash: hash, deleted_at: null,
            file_path: { [Op.like]: '%editor-images%' },
          },
          order: [['id', 'ASC']],
        });
      }

      let finalPath = req.file.path;
      let finalUrl = url;
      if (twin) {
        // 중복 — 물리 파일은 하나만 두고 참조만 늘린다. 본문 URL 도 살아 있는 쪽을 가리킨다.
        try { fs.unlinkSync(req.file.path); } catch { /* 이미 없으면 그만 */ }
        await twin.increment('ref_count');
        finalPath = twin.file_path;
        finalUrl = `/api/posts/editor-image/${path.basename(twin.file_path)}?w=1600`;
      } else {
        // 새 바이트 — 쿼터에 반영한다. 한도를 넘으면 파일을 지우고 413.
        let reserved;
        try {
          reserved = await reservePlanqUpload(businessId, req.file.size);
        } catch (e) {
          try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
          throw e;
        }
        if (reserved && reserved.ok === false) {
          try { fs.unlinkSync(req.file.path); } catch { /* noop */ }
          const planEngine = require('../services/plan');
          return res.status(413).json(planEngine.buildQuotaError(reserved, businessId));
        }
      }

      const file = await File.create({
        business_id: businessId,
        project_id: projectId,
        uploader_id: req.user.id,
        file_name: decodeOriginalName(req.file.originalname),
        file_path: finalPath,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        storage_provider: 'planq',
        content_hash: hash,
        ref_count: 1,
        visibility: level,
        vlevel: level,
        // ★ 같은 바이트를 다시 붙여넣은 경우(twin) — Drive 사본은 **이미 있다.**
        //   미러 정보를 물려주지 않으면 새 행의 gdrive_mirror_id 가 NULL 이라
        //   isEligible 을 통과해 **같은 이미지가 Drive 에 또 올라간다**(붙여넣을 때마다 한 장씩).
        //   물려주면 ① 중복 업로드가 막히고(멱등) ② 새 행도 같은 Drive 파일을 가리킨다.
        gdrive_mirror_id: twin ? twin.gdrive_mirror_id : null,
        gdrive_mirror_url: twin ? twin.gdrive_mirror_url : null,
        gdrive_mirrored_at: twin ? twin.gdrive_mirrored_at : null,
      });
      // ★ 운영 #378 — 여기서 만든 파일도 **다른 업로드와 똑같이** 다뤄야 한다.
      //   여태 이 경로만 아래 둘이 빠져 있어, 같은 앱인데 어느 에디터에서 넣었느냐에 따라
      //   Drive 에 올라가기도 하고 안 올라가기도 했다(Irene: "파일 동기화랑 ... 통일해서 맞춰서").
      //   ① 파일 목록 실시간 반영 (CLAUDE.md §16) — 없으면 새로고침 전엔 안 보인다.
      broadcastFile(req, file, 'file:new');
      //   ② GDrive 미러 — best-effort, 응답을 막지 않는다. L1 개인·security 제외는 미러가 자체 판단한다.
      setImmediate(() => require('../services/gdriveMirror').mirrorOnUpload(file.id, businessId));
      successResponse(res, {
        url: finalUrl,
        file_id: file.id,
        download_url: `/api/files/${businessId}/${file.id}/download`,
      }, 'uploaded');
    } catch (e) { next(e); }
  });
});

// GET /api/posts/editor-image/:filename — UUID 로 추측 불가, 인증 생략 (img 태그 직접 로드 용)
// ★ 무인증 공개 라우트. 방벽은 **파일명(UUID)의 추측 불가능성 하나뿐**이다.
//   공개 공유 문서(익명 열람)의 인라인 이미지가 이 길로 나가므로 인증을 걸 수 없다.
//
// ★ 2026-09-01 (Fable 설계 게이트) — 여태 이 라우트는 **DB 를 아예 보지 않았다.**
//   파일시스템에 파일이 있으면 그냥 내보냈다. 그래서 같은 계열 4개 경로 중 가장 약했다:
//     · 삭제된 파일이 계속 열렸다 (deleted_at 검사 없음)
//     · 보안 등급(대외비·내부용)을 통과시켰다
//     · 확장자만 보고 MIME 을 정해, DB 가 아는 실제 타입과 어긋날 수 있었다
//   File 행을 근거로 삼는다. 운영 실측으로 이 폴더의 파일은 전부 File 행이 있다(orphan 0).
//
// ※ 신원 게이트(등급별 접근 판정)는 Stage 2 다 — `<img>` 는 인증 헤더를 못 실으므로
//   이미지 전용 쿠키 발급(Stage 1)이 먼저다. 현재 모델은 "URL 을 아는 사람 = 볼 수 있는 사람"
//   (capability URL)이고, 그것이 L1(개인) 어휘와 어긋난다는 것이 알려진 부채다.
router.get('/editor-image/:filename', async (req, res) => {
  try {
    const filename = String(req.params.filename || '');
    // path traversal 방어
    if (!/^[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i.test(filename)) {
      return errorResponse(res, 'invalid_filename', 400);
    }
    const fp = path.join(EDITOR_IMG_DIR, filename);

    // ★ LIKE 는 접미사 매칭이라 짧은 값으로 남의 파일이 걸린다 — basename 정확 일치까지 본다.
    //   (files.js public-image 가 같은 함정을 같은 방식으로 막았다. 규칙을 갈라 두지 말 것.)
    const row = await File.findOne({
      where: { file_path: { [Op.like]: `%editor-images/${filename}` }, deleted_at: null },
    });
    const file = row && path.basename(row.file_path) === filename ? row : null;
    if (!file) return errorResponse(res, 'not_found', 404);
    if (file.security_level && file.security_level !== 'general') {
      // 대외비·내부용은 무인증 경로로 절대 내보내지 않는다 (/drag · gdriveMirror 와 같은 술어).
      return errorResponse(res, 'not_found', 404);   // 존재 은닉
    }
    // image/* 만 — HTML/JS 를 inline 으로 흘리면 XSS 가 된다 (public-image 와 같은 계약).
    const { isRenderableImage } = require('../services/filePreview');
    if (!isRenderableImage(file.mime_type)) return errorResponse(res, 'not_public_image', 403);
    // 보안 Stage 1 — 막지 않고 계측만 (Stage 2 에서 게이트).
    {
      const { resolveImageViewerDetailed, auditWouldDeny } = require('../middleware/imageViewer');
      auditWouldDeny(file, resolveImageViewerDetailed(req), 'posts/editor-image', req);
    }

    if (!fs.existsSync(fp)) return errorResponse(res, 'not_found', 404);
    const mime = file.mime_type;   // 확장자 추측이 아니라 DB 가 아는 실제 타입
    if (await require('../services/imageResize').maybeServeResized(req, res, fp, mime)) return; // #97 ?w= 리사이즈
    require('../services/fileServing').applyFileResponseHeaders(res, { mime_type: mime, file_name: file.file_name }, { inline: true });
    res.sendFile(fp);
  } catch (e) {
    console.error('[posts] editor-image:', e.message);
    return errorResponse(res, 'not_found', 404);
  }
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

// PUT /api/posts/categories/:id — 이름 변경 (운영 #401)
//   ★ 문서의 category 는 **이름 문자열**이다. 마스터 row 이름만 바꾸면 기존 문서는 옛 이름에
//     남아, 새 이름 카테고리는 0건으로 비고 옛 이름이 목록에 계속 뜬다(사용자에겐 "안 바뀜").
//     그래서 같은 트랜잭션에서 문서의 값도 함께 옮긴다.
router.put('/categories/:id', authenticateToken, async (req, res, next) => {
  try {
    const row = await PostCategory.findByPk(req.params.id);
    if (!row) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, row.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) return errorResponse(res, 'name required', 400);
    if (name === row.name) return successResponse(res, { id: row.id, name: row.name, moved: 0 });
    const dup = await PostCategory.findOne({
      where: { business_id: row.business_id, project_id: row.project_id, name },
    });
    if (dup) return errorResponse(res, 'duplicate_name', 400);

    const oldName = row.name;
    const t = await sequelize.transaction();
    try {
      await row.update({ name }, { transaction: t });
      const scope = { business_id: row.business_id, category: oldName };
      if (row.project_id === null) scope.project_id = null; else scope.project_id = row.project_id;
      const [moved] = await Post.update({ category: name }, { where: scope, transaction: t });
      await t.commit();
      successResponse(res, { id: row.id, name, moved: moved || 0 });
    } catch (e) { await t.rollback(); throw e; }
  } catch (err) { next(err); }
});

// DELETE /api/posts/categories/:id
//   ★ 마스터 row 만 지우면, 그 이름을 쓰는 문서가 한 건이라도 있으면 meta 가 문서에서 다시
//     집계해 **목록에 그대로 남는다** — 사용자에겐 "삭제가 안 된다"(운영 #401).
//     삭제는 문서의 분류도 함께 비운다(문서 자체는 그대로 남는다).
router.delete('/categories/:id', authenticateToken, async (req, res, next) => {
  try {
    const row = await PostCategory.findByPk(req.params.id);
    if (!row) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, row.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const scope = { business_id: row.business_id, category: row.name };
    if (row.project_id === null) scope.project_id = null; else scope.project_id = row.project_id;
    const t = await sequelize.transaction();
    try {
      const [cleared] = await Post.update({ category: null }, { where: scope, transaction: t });
      await row.destroy({ transaction: t });
      await t.commit();
      successResponse(res, { cleared: cleared || 0 }, 'deleted');
    } catch (e) { await t.rollback(); throw e; }
  } catch (err) { next(err); }
});

// ─── 공유: token 발급/조회 ───
// POST /api/posts/:id/share — share_token 없으면 발급, 있으면 그대로 반환
// body: { expires_in_days?: number | null }  // null/생략 = 무제한 (기본 30일 권장 — 프론트에서 default 전달)
// N+43: share_expires_at 박제. expires_in_days <= 0 또는 null 이면 무제한.
router.post('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    // D4 #62 — 보안등급 게이트
    if (blocksExternalShare(post)) {
      return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
    }
    const days = Number(req.body?.expires_in_days);
    const expiresAt = Number.isFinite(days) && days > 0
      ? new Date(Date.now() + days * 86400 * 1000)
      : null;
    if (!post.share_token) {
      const token = crypto.randomBytes(32).toString('hex');
      await post.update({ share_token: token, shared_at: new Date(), share_expires_at: expiresAt });
    } else if (req.body?.expires_in_days !== undefined) {
      // 기존 토큰 유지 + 만료일만 갱신 (재발급 아님)
      await post.update({ share_expires_at: expiresAt });
    }
    return successResponse(res, {
      share_token: post.share_token,
      share_url: `${APP_URL}/public/posts/${post.share_token}`,
      shared_at: post.shared_at,
      share_expires_at: post.share_expires_at,
    });
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/share — share_token 무효화 (revoke)
router.delete('/:id/share', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    await post.update({ share_token: null, shared_at: null, share_expires_at: null });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

// ─── D4 #62 — 보안등급 변경 ───
// PUT /api/posts/:id/security-level  body: { level: 'general'|'internal'|'confidential' }
//   권한: author 본인 또는 owner/admin (visibility 변경과 동일). 일반 외로 상향 시 외부 공유 링크 즉시 무효화.
router.put('/:id/security-level', authenticateToken, async (req, res, next) => {
  try {
    const level = String(req.body?.level || '');
    if (!isValidLevel(level)) return errorResponse(res, 'invalid_level', 400);
    const post = await Post.findByPk(req.params.id);
    if (!post) return errorResponse(res, 'not_found', 404);
    const scope = await getUserScope(req.user.id, post.business_id, req.user.platform_role);
    const isAuthor = post.author_id === req.user.id;
    const isOwner = scope.isOwner || scope.isPlatformAdmin || scope.isAdmin;
    if (!isAuthor && !isOwner) return errorResponse(res, 'forbidden', 403);
    const prev = post.security_level;
    const patch = { security_level: level };
    let revokedShare = false;
    if (level !== 'general' && post.share_token) {
      patch.share_token = null; patch.shared_at = null; patch.share_expires_at = null;
      if (post.vlevel === 'L4') patch.vlevel = 'L3'; // 외부 공개였으면 워크스페이스로 내림
      revokedShare = true;
    }
    await post.update(patch);
    broadcastPost(req, post, 'post:updated');
    require('../services/auditService').logAudit(req, {
      action: 'post.security_level_change', targetType: 'post', targetId: post.id, businessId: post.business_id,
      oldValue: { security_level: prev }, newValue: { security_level: level, revoked_share: revokedShare },
    });
    return successResponse(res, { id: post.id, security_level: level, revoked_share: revokedShare });
  } catch (err) { next(err); }
});

// ─── 공유: 이메일 발송 ───
// POST /api/posts/:id/share/email  body: { to, message? }
// 비용폭탄 H2 — 문서 공유 메일 발송 per-user rate-limit.
const postShareEmailLimiter = require('../middleware/costGuard').perUserDaily('post-share-email', { perMin: 10, perDay: 100, message: '공유 메일 발송이 너무 잦습니다. 잠시 후 다시 시도하세요.' });
router.post('/:id/share/email', authenticateToken, ...postShareEmailLimiter, async (req, res, next) => {
  try {
    const { to, message } = req.body || {};
    const recipients = Array.isArray(to) ? to : (typeof to === 'string' ? to.split(',').map(s => s.trim()).filter(Boolean) : []);
    if (recipients.length === 0) return errorResponse(res, 'to required', 400);
    // 비용폭탄 H2 — 요청당 수신자 수 캡.
    if (recipients.length > 20) return errorResponse(res, 'too_many_recipients', 400);
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
    // D4 #62 — 보안등급 게이트
    if (blocksExternalShare(post)) {
      return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
    }
    // share_token 자동 발급
    if (!post.share_token) {
      const token = crypto.randomBytes(32).toString('hex');
      await post.update({ share_token: token, shared_at: new Date() });
    }
    const shareUrl = `${APP_URL}/public/posts/${post.share_token}`;
    const sender = await User.findByPk(req.user.id, { attributes: ['name'] });
    const { getMemberDisplayName } = require('../services/displayName');
    const senderDisp = await getMemberDisplayName(post.business_id, req.user.id, sender?.name);

    const results = [];
    for (const email of recipients) {
      const ok = await sendPostShareEmail({
        to: email,
        docTitle: post.title,
        senderName: senderDisp.name || '',
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
    // D4 #62 — 보안등급 게이트
    if (blocksExternalShare(post)) {
      return errorResponse(res, 'security_level_blocks_share', 403, 'security_level_blocks_share');
    }
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
  let author = post.author ? { id: post.author.id, name: post.author.name } : null;
  // 워크스페이스 표시명 우선 (PDF 작성자도 닉네임)
  if (author?.id) {
    const { getMemberDisplayName } = require('../services/displayName');
    const d = await getMemberDisplayName(post.business_id, author.id, author.name);
    if (d.name) author.name = d.name;
  }
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

// ─── 워드(.docx) 다운로드 (#225) ───
//   접근 검사는 위 PDF 와 같다 — 같은 내용을 다른 형식으로 줄 뿐이다.
router.get('/:id/docx', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findByPk(req.params.id, {
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    if (!(await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin'))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { buildDocx, sendDocx } = require('../services/docxService');
    const buf = await buildDocx({
      title: post.title,
      subtitle: post.author?.name ? `${post.author.name}` : '',
      content: post.content_json,
      plain: post.content_text || '',
    });
    return sendDocx(res, buf, post.title);
  } catch (err) { next(err); }
});

// ─── PDF 다운로드 (익명 — share_token) ───
router.get('/public/:token/pdf', async (req, res, next) => {
  try {
    // ★ 열림 판정은 `services/shareOpenable` — 본문·카드와 **같은 함수**(두 벌이면 갈린다).
    const post = await Post.findOne({
      where: { share_token: req.params.token },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    {
      const { shareOpenReason } = require('../services/shareOpenable');
      const why = shareOpenReason('post', post);
      if (why === 'expired') {
        return res.status(410).json({ success: false, code: 'share_expired', message: 'This share link has expired.' });
      }
      if (why) return errorResponse(res, 'not_found', 404);
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

// ─── Public — share_token 기반 (인증 없음) ───
// GET /api/posts/public/:token
router.get('/public/:token', async (req, res, next) => {
  try {
    // ★ status 조건을 where 에서 뺐다 — 열림 판정은 `services/shareOpenable` 한 곳이 한다.
    //   채팅 카드도 같은 함수를 불러 "열어보기" 를 그릴지 정한다. 두 벌이면 갈린다.
    const post = await Post.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] },
        { model: Project, attributes: ['id', 'name', 'color'], required: false },
        { model: PostAttachment, as: 'attachments', include: [{ model: File, as: 'file' }] },
      ],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    // ★ 열림 판정은 `services/shareOpenable` 한 곳 — 채팅 카드가 부르는 것과 **같은 함수**다.
    //   두 벌로 두면 카드가 "열어보기" 를 그려 놓고 여기서 410/404 가 나는 거짓말이 생긴다.
    {
      const { shareOpenReason } = require('../services/shareOpenable');
      const why = shareOpenReason('post', post);
      if (why === 'expired') {
        // N+43: 만료는 410 + 친절한 응답 (frontend 가 만료 페이지로 분기).
        return res.status(410).json({
          success: false, code: 'share_expired',
          message: 'This share link has expired.', expired_at: post.share_expires_at,
        });
      }
      if (why) return errorResponse(res, 'not_found', 404);   // deleted·no_token·not_published
    }
    // ★ silent — 조회수 증가가 updated_at 을 건드리면 안 된다.
    //   (a) 문서를 **열기만 해도** updated_at 이 바뀌어 편집 낙관적 잠금(#252)이 즉시 거짓 409 를 낸다
    //   (b) 목록 정렬이 ['updated_at','DESC'] 라 남이 열어보기만 해도 순서가 뒤바뀐다
    await post.increment('view_count', { silent: true });
    const safe = serialize(post, true);
    // 공유 미리보기 — attachments 의 download_url 을 공개 라우트로 매핑 (인증 없이 다운로드 가능).
    // 사이클 N+9 fix: 옛 download_url 은 /api/files/:bizId/:id/download (인증 필요) — 공개 페이지에선 401.
    const token = req.params.token;
    if (Array.isArray(safe.attachments)) {
      // ★ 공개 링크에는 **L4(외부 공개)로 표시된 첨부만** 내보낸다.
      //   여태 파일 등급을 보지 않아, 내부 문서(L2)의 "나만 보기"(L1) 첨부까지 링크 소지자
      //   전원이 파일명을 보고 내려받을 수 있었다. 파일명 자체도 정보라 목록에서 뺀다.
      //   문서를 공개할 때 화면이 "첨부도 함께 공개할지" 를 묻고, 동의하면 그때 L4 로 올린다.
      //   ★ 판정은 **원본 인스턴스**(post.attachments)로 한다. `serialize` 가 파일 필드를
      //     화이트리스트로 추리면서 vlevel 을 빼기 때문에, 직렬화 결과로 판단하면
      //     "전부 비공개" 로 읽혀 동의한 첨부까지 사라진다(실측: 다운로드는 200 인데 목록만 0건).
      //     파생본을 원본으로 쓰지 않는다.
      const isPublicFile = (f) => !!f && (f.vlevel === 'L4' || (!f.vlevel && f.visibility === 'L4'));
      const publicAttIds = new Set(
        (post.attachments || []).filter(a => isPublicFile(a.file)).map(a => a.id));
      const hidden = safe.attachments.filter(a => !publicAttIds.has(a.id)).length;
      safe.attachments = safe.attachments.filter(a => publicAttIds.has(a.id)).map(a => ({
        ...a,
        file: { ...a.file, download_url: `/api/posts/public/${token}/attachments/${a.id}/download` },
      }));
      // ★ 숨긴 건수를 **익명 뷰어에게 내보내지 않는다.** 처음엔 "조용히 사라지면 오해한다" 며
      //   실었는데, 공개 페이지를 보는 사람은 문서 소유자가 아니다 — 숨긴 파일이 몇 개인지는
      //   그에게 줄 정보가 아니다(존재 자체가 정보다). 소유자는 공유 모달에서 본다.
      //   소비처도 0곳이었다 — 죽은 채로 두지 않는다(Fable 권고).
      void hidden;
    }
    delete safe.share_token;
    await applyMemberDisplayNameOne(safe, post.business_id, ['author', 'editor']);
    return successResponse(res, safe);
  } catch (err) { next(err); }
});

// N+47 — Smart Routing auth-check (PlanQ 로그인된 사용자면 in-app 으로 자동 redirect 정보 제공).
// 응답: { canAccess: boolean, appUrl: string | null }
// 본 endpoint 는 authenticateToken 필요. 비로그인은 호출 안 함 (PublicPostPage 의 useEffect 가 getAccessToken() check).
router.get('/public/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    const post = await Post.findOne({ where: { share_token: req.params.token } });
    if (!post) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(post, res)) return;
    // 멤버 (owner/admin/member) 이면 PostsPage 안에서 ?post=:id 로 진입 가능
    const isMember = await assertMember(req.user.id, post.business_id, req.user.platform_role === 'platform_admin');
    return successResponse(res, {
      canAccess: !!isMember,
      appUrl: isMember ? `/docs?post=${post.id}` : null,
    });
  } catch (err) { next(err); }
});

// GET /api/posts/public/:token/attachments/:attId/download
// 공유 미리보기에서 첨부 파일 다운로드 (인증 없이 share_token 기반).
// post.share_token 검증 + 해당 post 의 attachments 중 하나 → 파일 스트리밍.
router.get('/public/:token/attachments/:attId/download', async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { share_token: req.params.token, status: 'published' },
      attributes: ['id', 'share_expires_at'],
    });
    if (!post) return errorResponse(res, 'not_found_or_expired', 404);
    {
      const { shareOpenReason } = require('../services/shareOpenable');
      const why = shareOpenReason('post', post);
      if (why === 'expired') {
        return res.status(410).json({ success: false, code: 'share_expired', message: 'This share link has expired.' });
      }
      if (why) return errorResponse(res, 'not_found_or_expired', 404);
    }
    const att = await PostAttachment.findOne({
      where: { id: req.params.attId, post_id: post.id },
      include: [{ model: File, as: 'file' }],
    });
    if (!att || !att.file) return errorResponse(res, 'attachment_not_found', 404);
    const file = att.file;
    // ★ 목록에서 뺐어도 URL 을 알면 그대로 받아진다 — 여기서도 같은 기준으로 막는다.
    //   (한쪽만 막는 것은 막은 게 아니다)
    if (!(file.vlevel === 'L4' || (!file.vlevel && file.visibility === 'L4'))) {
      return errorResponse(res, 'attachment_not_shared', 403);
    }
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
// ogMeta 가 공유 페이지 본문 SSR 에 쓴다 — 추출 로직을 복사하지 말고 이걸 가져다 쓸 것.
//   ★ 반드시 `module.exports = router` **뒤**에 둘 것. 앞에 두면 그 대입에 통째로 덮여
//     조용히 undefined 가 된다 (문법검사·빌드는 전부 통과한다).
module.exports.extractBlockText = extractBlockText;
// #250 후속 — 워크스페이스 이전 워커가 Post 를 만들 때 content_text 를 같은 규칙으로 뽑아야 한다.
//   사본을 만들면 검색 프리뷰가 두 규칙으로 갈린다(Fable 설계 조건 4).
module.exports.extractText = extractText;
// post_revisions.js 가 같은 권한·격리·broadcast 규칙을 쓰도록 공유한다 — 사본을 만들면 규칙이 갈라진다.
module.exports.canEditPost = canEditPost;
module.exports.broadcastPost = broadcastPost;
