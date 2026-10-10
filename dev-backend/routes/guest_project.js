// 게스트 **프로젝트 탭** 라우트 — `scope='project'` 링크만 여는 문 (개요는 guest.js 의 컨텍스트).
//
//   docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §3.2·§4. 여기 있는 라우트는 전부
//   **채팅 링크(scope='conversation')에서는 404** 다 — 같은 프로젝트·같은 방이어도 갈린다.
//
// ★ guest.js 에서 갈라 나왔다(라우트 파일 500줄 기준, CLAUDE.md 파일 크기). 무인증 표면이라
//   "어느 라우트가 공개인가" 가 파일 경계로 보이는 편이 안전하다 — guest_admin.js 주석과 같은 이유.
// ★ 축이 둘이고 **역할이 다르다.**
//     `vlevel`         = **필터**. L1(개인)은 **행 자체가 없다.** 로그인해도 고객은 못 보므로
//                        "로그인하면 볼 수 있어요" 라고 말하면 그 문장이 거짓이 된다.
//     `security_level` = **잠금**. general 열림 / internal 자리는 보이고 잠김 / confidential 건수만.
const express = require('express');
const router = express.Router();
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { blocksExternalShare } = require('../services/securityLevel');
const { guestLimiter, attachGuest } = require('./guest_common');
// 누구로 보이는가(담당자·작성자·올린 사람) — services/guestParty.js **한 술어**(§A). 여기서 다시 쓰지 않는다.
const { guestPartyLabels } = require('../services/guestParty');
const { isRenderableImage, effectiveMimeType } = require('../services/filePreview');
const { GUEST_VLEVELS, guestProjectOf, findGuestPost } = require('../services/guestPost');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

// ── GET /api/guest/:token/tasks ───────────────────────────────────────────
//   프로젝트 링크의 **업무 탭**. docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §3.2 화이트리스트.
//
// ★ scope='conversation'(채팅 링크) 토큰으로는 **404** 다 — 같은 프로젝트·같은 방이어도 갈린다.
//   "토큰이 있으니 열어 준다" 가 아니라 "이 토큰이 여는 종류인가" 를 본다(파생 열쇠 차단).
// ★ 자유 텍스트(description·body)는 **내보내지 않는다.** 그 필드에는 보안등급 축이 없어
//   "걸리면 잠근다" 를 적용할 수 없다 — fail-closed 로 뺀다. 고객용 본문은 2차에
//   `client_share_content` 로 따로 연다.
// ★ 공수(estimated/actual)는 원가가 역산되므로 키 자체를 담지 않는다.
router.get('/:token/tasks', guestLimiter('guest-tasks', { windowMs: 60 * 1000, max: 30 }), attachGuest, async (req, res, next) => {
  try {
    const { link } = req.guest;
    if (link.scope !== 'project' || !link.project_id) return errorResponse(res, 'not_found', 404);
    const { Task, Project } = require('../models');
    // 테넌트 이중 검증 — 링크의 워크스페이스와 프로젝트가 어긋나면 없는 것으로 친다.
    const project = await Project.findByPk(link.project_id, { attributes: ['id', 'business_id'] });
    if (!project || project.business_id !== link.business_id) return errorResponse(res, 'not_found', 404);

    const rows = await Task.findAll({
      // ★ Task 에는 `deleted_at` 컬럼이 **없다**(모델 실측) — 넣으면 500 이 난다.
      //   앱의 프로젝트 업무 목록도 project_id 로만 거른다(projects.js:1603).
      where: { project_id: project.id, business_id: link.business_id },
      // ★ attributes 를 나열한다 — 모델 전체를 읽고 delete 로 지우는 방식은 컬럼이 늘 때 샌다
      //   (CLAUDE.md: 가릴 땐 화이트리스트).
      attributes: ['id', 'title', 'status', 'progress_percent', 'start_date', 'due_date',
        'completed_at', 'is_milestone', 'category', 'assignee_id'],
      order: [['created_at', 'DESC']],
      limit: 200,
    });

    // 담당자는 **워크스페이스 표시명만** (Irene 결정 §12-Q3). user_id·email 은 담지 않는다.
    //   ★ getMemberNameMap 은 **워크스페이스 표시명을 따로 지정한 사람만** 담는다(실측:
    //     name·name_localized 둘 다 없으면 건너뛴다). 그것만 쓰면 표시명을 안 정한 담당자가
    //     전부 빈칸이 된다 — 계정 이름으로 떨어뜨린다. 이메일은 어느 쪽에서도 읽지 않는다.
    const assigneeIds = [...new Set(rows.map((r) => r.assignee_id).filter(Boolean))];
    const nameMap = await guestPartyLabels(link.business_id, assigneeIds, { surface: 'task' });

    const list = rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      progress_percent: t.progress_percent ?? 0,
      start_date: t.start_date || null,
      due_date: t.due_date || null,
      completed_at: t.completed_at || null,
      is_milestone: !!t.is_milestone,
      category: t.category || null,
      assignee_name: t.assignee_id ? (nameMap.get(t.assignee_id) || null) : null,
    }));
    return successResponse(res, list);
  } catch (err) { next(err); }
});

//   docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §3.2·§4.
//
// ★ 축이 둘이고 **역할이 다르다.**
//     `vlevel`         = **필터**. L1(개인)은 **행 자체가 없다.** 로그인해도 고객은 못 보므로
//                        "로그인하면 볼 수 있어요" 라고 말하면 그 문장이 거짓이 된다.
//     `security_level` = **잠금**. general 열림 / internal 자리는 보이고 잠김 / confidential 건수만.
//   이 구분을 흐리면 화면이 사용자에게 거짓말을 한다.
// ★ 발행 판정은 `shareOpenable.js` 의 규칙과 **같은 뜻**이어야 한다(post 는 published 만).


/** 이 링크가 프로젝트를 여는가 — 아니면 여기 라우트들은 전부 없는 것이다. */
async function requireProjectScope(req, res) {
  // 판정은 services/guestPost 한 곳 — 이미지 문맥(services/imageCtx)도 같은 함수를 부른다.
  const project = await guestProjectOf(req.guest.link);
  if (!project) { errorResponse(res, 'not_found', 404); return null; }
  return project;
}

/**
 * 게스트가 이 파일을 **받을 수 있는가** — 목록(downloadable·preview_url)과 `/open` 이 **이 한 술어**를 쓴다.
 *   L4(외부 공개) + general + 공유 토큰이 있고, 그 공유에 **비밀번호·만료가 걸려 있지 않을 때만**.
 * ★ 2026-09-24 Fable F1 — 비밀번호·만료를 안 봐서, 공개 다운로드는 401/410 으로 막는 파일의 썸네일(= stored name)을
 *   게스트 목록이 내주고 있었다. stored name 은 회수·만료가 없는 **영구 열쇠**라 `?w=` 를 떼면 원본이 나왔다.
 *   «이미 원본을 받을 수 있으니 새 노출이 아니다» 는 이 두 상태에서 거짓이다 — 그래서 받기 조건 자체를 좁힌다.
 */
function guestDownloadable(r) {
  if ((r.security_level || 'general') !== 'general') return false;
  if (r.vlevel !== 'L4' || !r.share_token) return false;
  if (r.share_password_hash) return false;
  if (r.share_expires_at && new Date(r.share_expires_at).getTime() <= Date.now()) return false;
  return true;
}

/**
 * 게스트가 이 파일을 **볼 수 있는가**(미리보기) — 목록(preview_url·viewable)과 `/preview` 가 **이 한 술어**를 쓴다.
 *   docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-3 — §D(«받을 수 있는 이미지에만») 를 뒤집었다:
 *   general L2 문서 본문은 이미 읽히는데 general L2 png 는 이름만 보이던 모순. «보기» 는 문서와 같은 두 축
 *   (security_level=general ∧ vlevel ∈ GUEST_VLEVELS) + 그릴 수 있는 종류(래스터 이미지·PDF). «받기» 는 guestDownloadable 그대로.
 * ★ 원본은 어느 경우에도 나가지 않는다 — 미리보기는 서버가 줄여 그린 그림뿐이다.
 * ★ SVG 는 뺀다(스크립트 가능한 형식). gif·bmp 등은 리사이즈기가 다루지 않아 뺀다.
 */
const PREVIEW_IMAGE_MIME = /^image\/(jpeg|png|webp|avif)$/i;
function guestPreviewKind(r) {
  if ((r.security_level || 'general') !== 'general') return null;
  if (!GUEST_VLEVELS.includes(r.vlevel)) return null;
  const provider = r.storage_provider || 'planq';
  if (provider === 'planq' ? !r.file_path : provider === 'gdrive' ? !r.external_id : true) return null;
  const mime = String(effectiveMimeType(r.mime_type, r.file_name) || '').toLowerCase();
  // PDF 는 서버에 그릴 도구(poppler)가 있을 때만 «보기» — 없으면 눌러도 안 열리는 꼬리표가 된다(2026-10-10 Fable).
  if (mime === 'application/pdf') return require('../services/pdfPagePreview').pdfToolsAvailable() ? 'pdf' : null;
  if (isRenderableImage(r.mime_type, r.file_name) && PREVIEW_IMAGE_MIME.test(mime)) return 'image';
  return null;
}

/** 외부에 내보낼 수 있는 노출 범위인가 — L2·L3·L4 만. L1(개인)은 프로젝트에 묶여 있어도 남의 것이다. */

// GET /api/guest/:token/posts — 문서 목록
router.get('/:token/posts', guestLimiter('guest-posts', { windowMs: 60 * 1000, max: 30 }), attachGuest, async (req, res, next) => {
  try {
    const project = await requireProjectScope(req, res);
    if (!project) return;
    const { link } = req.guest;
    const { Post } = require('../models');

    const rows = await Post.findAll({
      where: {
        project_id: project.id, business_id: link.business_id,
        status: 'published',                 // shareOpenable 의 post 규칙과 같은 뜻
        vlevel: GUEST_VLEVELS,
      },
      // ★ 나열한 키만 읽는다. 모델 전체를 읽고 지우는 방식은 컬럼이 늘 때 조용히 샌다.
      //   `content_json`·`content_text`·`share_token`·`translations` 는 **읽지도 않는다**.
      // ★ Sequelize **속성명**은 `updatedAt` 이다(컬럼이 updated_at). 컬럼명을 쓰면 500 이 난다 —
      //   오늘 `Task.deleted_at` 으로 같은 실수를 한 번 했다.
      attributes: ['id', 'title', 'category', 'security_level', 'author_id', 'updatedAt'],
      order: [['updated_at', 'DESC']],
      limit: 200,
    });

    // confidential 은 **제목도 정보다** — 행을 만들지 않고 건수만 알린다.
    const visible = rows.filter((r) => (r.security_level || 'general') !== 'confidential');
    const lockedCount = rows.length - visible.length;

    // 작성자 표시명은 **열리는 문서만**. 잠긴 문서는 누가 썼는지도 알릴 이유가 없다.
    const openIds = [...new Set(visible.filter((r) => (r.security_level || 'general') === 'general')
      .map((r) => r.author_id).filter(Boolean))];
    const nameMap = await guestPartyLabels(link.business_id, openIds, { surface: 'doc' });

    const list = visible.map((r) => {
      const lv = r.security_level || 'general';
      const locked = lv !== 'general';
      return {
        id: r.id,
        title: r.title,
        category: r.category || null,
        updated_at: r.updatedAt || null,
        locked,                                        // true = 자리는 보이고 열리지 않는다
        author_name: locked ? null : (nameMap.get(r.author_id) || null),
      };
    });
    // ★ `successResponse` 는 **추가 키를 버린다**(errorHandler.js:15 — 인자가 4개뿐).
    //   locked_count 를 다섯 번째 인자로 넘기면 조용히 사라진다(같은 계열 전례:
    //   memory feedback_pagination_helper_drops_extra_keys). payload 안에 담는다.
    return successResponse(res, { items: list, locked_count: lockedCount });
  } catch (err) { next(err); }
});

// GET /api/guest/:token/posts/:postId — 문서 본문
//   잠긴 문서는 **404** 다. "그 문서가 있다" 는 목록이 이미 말했고, 본문의 존재 여부를 따로 흘릴 이유가 없다.
router.get('/:token/posts/:postId', guestLimiter('guest-post', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const project = await requireProjectScope(req, res);
    if (!project) return;
    const { link } = req.guest;
    const post = await findGuestPost(link, project.id, req.params.postId,
      ['id', 'title', 'category', 'security_level', 'author_id', 'updatedAt', 'content_json']);
    if (!post) return errorResponse(res, 'not_found', 404);

    const nameMap = await guestPartyLabels(link.business_id, [post.author_id].filter(Boolean), { surface: 'doc' });
    let content = null;
    try {
      content = post.content_json
        ? (typeof post.content_json === 'string' ? JSON.parse(post.content_json) : post.content_json)
        : null;
    } catch { content = null; }

    await link.update({ last_used_at: new Date() }).catch(() => null);
    return successResponse(res, {
      id: post.id,
      title: post.title,
      category: post.category || null,
      updated_at: post.updatedAt || null,
      author_name: nameMap.get(post.author_id) || null,
      content,
      // 이미지 문맥(2b 1단계) — 이 링크·이 문서 안에서만 본문 이미지를 연다(services/imageCtx).
      image_ctx: require('../services/imageCtx').issueImageCtx('guest', { token: req.params.token, postId: post.id }),
    });
  } catch (err) { next(err); }
});

// GET /api/guest/:token/files — 파일 목록
router.get('/:token/files', guestLimiter('guest-files', { windowMs: 60 * 1000, max: 30 }), attachGuest, async (req, res, next) => {
  try {
    const project = await requireProjectScope(req, res);
    if (!project) return;
    const { link } = req.guest;
    const { File } = require('../models');

    const rows = await File.findAll({
      where: {
        project_id: project.id, business_id: link.business_id,
        deleted_at: null,
        vlevel: GUEST_VLEVELS,
      },
      // ★ file_path·external_id·storage_provider 는 **썸네일 주소를 만드는 데만** 읽는다 —
      //   응답에는 싣지 않는다(아래 list 는 나열한 키만 낸다).
      attributes: ['id', 'file_name', 'file_size', 'mime_type', 'security_level', 'vlevel',
        'uploader_id', 'share_token', 'share_password_hash', 'share_expires_at',
        'updatedAt', 'file_path', 'external_id', 'storage_provider'],
      // ★ file_path·external_id·storage_provider 는 **미리보기 가능 판정에만** 읽는다 — 응답에는 싣지 않는다.
      order: [['updated_at', 'DESC']],
      limit: 200,
    });

    const visible = rows.filter((r) => (r.security_level || 'general') !== 'confidential');
    const lockedCount = rows.length - visible.length;
    const openIds = [...new Set(visible.filter((r) => (r.security_level || 'general') === 'general')
      .map((r) => r.uploader_id).filter(Boolean))];
    const nameMap = await guestPartyLabels(link.business_id, openIds, { surface: 'file' });

    const list = visible.map((r) => {
      const lv = r.security_level || 'general';
      const locked = lv !== 'general';
      // ★ 내려받기는 **이미 외부로 공개된 파일(L4)만**. Irene 원안 "파일 다운로드만 로그인 유도"
      //   (GUEST_LINK §1). 문서는 읽는 것이고 파일은 반출이라 비대칭은 의도다.
      //   토큰은 응답에 싣지 않는다 — 열 때 서버가 302 로 보낸다.
      const downloadable = !locked && guestDownloadable(r);
      const previewKind = locked ? null : guestPreviewKind(r);
      return {
        id: r.id,
        file_name: r.file_name,
        file_size: Number(r.file_size) || 0,
        mime_type: r.mime_type || null,
        updated_at: r.updatedAt || null,
        locked,
        downloadable,
        uploader_name: locked ? null : (nameMap.get(r.uploader_id) || null),
        // 썸네일·보기 — 2026-10-10 §I-3 (옛 §D «받을 수 있는 이미지에만» 을 뒤집었다).
        //   ★ 썸네일·보기는 **이 링크 토큰 아래** 주소 하나다(public-image 의 stored name 은
        //     회수·만료가 없는 영구 열쇠라 게스트 응답에서 뺐다). 링크를 닫으면 미리보기도 닫힌다.
        //     조건 밖이면 키 자체를 싣지 않는다.
        viewable: !locked && !!previewKind,
        ...(!locked && previewKind ? {
          preview_kind: previewKind,
          preview_url: `/api/guest/${encodeURIComponent(req.params.token)}/files/${r.id}/preview?w=400`,
        } : {}),
      };
    });
    return successResponse(res, { items: list, locked_count: lockedCount });
  } catch (err) { next(err); }
});

// GET /api/guest/:token/files/:fileId/open — 내려받기(302). 실패는 전부 404.
router.get('/:token/files/:fileId/open',
  guestLimiter('guest-file-open', { windowMs: 60 * 1000, max: 30 }), attachGuest, async (req, res, next) => {
  try {
    const project = await requireProjectScope(req, res);
    if (!project) return;
    const { link } = req.guest;
    const { File } = require('../models');
    const file = await File.findOne({
      where: {
        id: Number(req.params.fileId) || 0,
        project_id: project.id, business_id: link.business_id,
        deleted_at: null, vlevel: 'L4',
      },
      attributes: ['id', 'security_level', 'vlevel', 'share_token', 'share_password_hash', 'share_expires_at'],
    });
    // 목록과 **같은 술어**를 다시 태운다 — 주소로 직접 두드리는 경로를 막는다.
    //   — 비밀번호·만료가 걸린 공유는 여기서도 없는 것이다(Fable F1).
    if (!file || !guestDownloadable(file)) return errorResponse(res, 'not_found', 404);
    if (blocksExternalShare(file)) return errorResponse(res, 'not_found', 404);

    await link.update({ last_used_at: new Date() }).catch(() => null);
    // 헤더만 보낸다 — Express 기본 302 본문에 토큰이 한 번 더 실린다.
    return res.status(302).set('Location', `${APP_URL}/public/files/${file.share_token}`).end();
  } catch (err) { next(err); }
});

// GET /api/guest/:token/files/:fileId/preview?w=&page= — 파일 **보기**(줄여 그린 그림). 실패는 전부 404.
//   docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-3.
//   ★ 이 주소는 **링크 토큰 아래**에 있다 — 링크를 회수·만료하면 미리보기도 닫힌다(stored name 영구 열쇠 없음).
//   ★ 원본 바이트는 나가지 않는다: 폭은 허용값으로 강제(없거나 틀리면 400 폭), 이미지는 webp 로 다시 그린 것,
//     PDF 는 한 쪽을 png 로 그린 것. 리사이즈가 실패하면 원본으로 떨어지지 않고 404 다.
//   ★ 판정이 캐시보다 **먼저** 선다 — 캐시본이 있어도 링크·파일 판정을 통과해야 내보낸다.
const PREVIEW_CACHE_OPTS = { cacheControl: 'private, max-age=3600', disposition: 'inline; filename="preview"' };
function snapPreviewWidth(raw) {
  const { ALLOWED_WIDTHS } = require('../services/imageResize');
  const n = parseInt(raw, 10);
  if (!n || n <= 0) return 400;
  return ALLOWED_WIDTHS.reduce((best, a) => (Math.abs(a - n) < Math.abs(best - n) ? a : best), ALLOWED_WIDTHS[0]);
}
router.get('/:token/files/:fileId/preview',
  // 카드 수십 장이 한 번에 뜬다 — 30 이면 그리드가 깨진다(Fable §I-3).
  guestLimiter('guest-file-preview', { windowMs: 60 * 1000, max: 120 }), attachGuest, async (req, res, next) => {
  try {
    const project = await requireProjectScope(req, res);
    if (!project) return;
    const { link } = req.guest;
    const { File } = require('../models');
    const file = await File.findOne({
      where: {
        id: Number(req.params.fileId) || 0,
        project_id: project.id, business_id: link.business_id,
        deleted_at: null, vlevel: GUEST_VLEVELS,
      },
      attributes: ['id', 'business_id', 'file_name', 'file_size', 'mime_type', 'security_level', 'vlevel',
        'file_path', 'external_id', 'storage_provider', 'content_hash'],
    });
    // 목록과 **같은 술어** — 목록에 preview_url 이 없으면 여기서도 없는 것이다.
    const kind = file ? guestPreviewKind(file) : null;
    if (!kind) return errorResponse(res, 'not_found', 404);
    const width = snapPreviewWidth(req.query.w);

    if (kind === 'pdf') {
      const pageRaw = req.query.page === undefined ? '1' : String(req.query.page);
      if (!/^\d{1,3}$/.test(pageRaw)) return errorResponse(res, 'not_found', 404);
      const { renderPdfPage } = require('../services/pdfPagePreview');
      const out = await renderPdfPage(file, Number(pageRaw), width);
      if (!out.ok) return errorResponse(res, 'not_found', 404);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', PREVIEW_CACHE_OPTS.disposition);
      res.setHeader('Cache-Control', PREVIEW_CACHE_OPTS.cacheControl);
      res.setHeader('X-Pq-Pages', String(out.pages));
      res.setHeader('Access-Control-Expose-Headers', 'X-Pq-Pages');
      return res.sendFile(out.path);
    }

    // 이미지 — 리사이즈기(services/imageResize)가 요구하는 `req.query.w` 를 스냅한 값으로 덮어 원본 분기를 없앤다.
    const imageResize = require('../services/imageResize');
    const mime = effectiveMimeType(file.mime_type, file.file_name);
    const rq = { query: { w: String(width) } };
    const cacheId = `guest-preview:${file.storage_provider || 'planq'}:${file.external_id || file.file_path}`;
    if (imageResize.serveCachedIfPresent(rq, res, mime, cacheId, PREVIEW_CACHE_OPTS)) return;
    const { readAttachmentBody } = require('../services/attachmentStorage');
    const body = await readAttachmentBody(file);
    if (!body || body.ok === false || body.redirect) return errorResponse(res, 'not_found', 404);
    if (body.abs) {
      // ★ 실패하면 false 를 돌려주고 **원본으로 떨어진다** 는 것이 그 함수의 계약이다 — 여기서는 404 로 끝낸다.
      const served = await imageResize.maybeServeResized(rq, res, body.abs, mime, PREVIEW_CACHE_OPTS);
      if (!served && !res.headersSent) return errorResponse(res, 'not_found', 404);
      return;
    }
    if (!body.stream) return errorResponse(res, 'not_found', 404);
    const served = await imageResize.resizeStreamAndServe(rq, res, body.stream, mime, cacheId, PREVIEW_CACHE_OPTS);
    if (!served && !res.headersSent) return errorResponse(res, 'not_found', 404);
  } catch (err) { next(err); }
});

// GET /api/guest/:token/history — 공개된 «주요 이슈»(사람이 적고, 항목마다 «고객에게 보이기» 를 켠 것만).
//   docs/GUEST_PROJECT_VIEW_DECISIONS.md §I-2. 술어는 services/guestHistory 한 곳.
//   응답 키는 {id, occurred_at, title, body} 뿐 — 누가 적었는지는 고객 정보가 아니다.
router.get('/:token/history', guestLimiter('guest-history', { windowMs: 60 * 1000, max: 30 }), attachGuest, async (req, res, next) => {
  try {
    const project = await requireProjectScope(req, res);
    if (!project) return;
    const { link } = req.guest;
    const { ProjectHistoryEntry } = require('../models');
    const { clientVisibleHistoryWhere, CLIENT_HISTORY_ATTRS } = require('../services/guestHistory');
    const rows = await ProjectHistoryEntry.findAll({
      // business_id 를 한 번 더 링크에서 박는다(술어 안에도 있다 — 테넌트 이중 검증).
      where: { ...clientVisibleHistoryWhere(project), business_id: link.business_id },
      attributes: CLIENT_HISTORY_ATTRS,
      order: [['occurred_at', 'DESC'], ['id', 'DESC']],
      limit: 100,
    });
    const items = rows.map((r) => ({ id: r.id, occurred_at: r.occurred_at, title: r.title, body: r.body || null }));
    return successResponse(res, { items });
  } catch (err) { next(err); }
});

module.exports = router;
