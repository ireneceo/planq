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
    const nameMap = await guestDisplayNames(link.business_id, assigneeIds);

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

/**
 * 사람 이름 — **워크스페이스 표시명 우선, 없으면 계정 이름.** 이메일은 어느 쪽에서도 읽지 않는다.
 *   ★ getMemberNameMap 은 표시명을 따로 지정한 사람만 담는다(실측) — 그것만 쓰면 표시명을 안 정한
 *     담당자·작성자가 전부 빈칸이 된다. 업무·문서·파일이 **같은 규칙**을 쓰도록 한 곳에 둔다.
 */
async function guestDisplayNames(businessId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const { getMemberNameMap } = require('../services/displayName');
  const { User } = require('../models');
  const [wsMap, users] = await Promise.all([
    getMemberNameMap(businessId, ids),
    User.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true }),
  ]);
  for (const u of users) map.set(u.id, u.name || null);
  for (const [uid, v] of wsMap) if (v && v.name) map.set(uid, v.name);
  return map;
}

/** 이 링크가 프로젝트를 여는가 — 아니면 여기 라우트들은 전부 없는 것이다. */
async function requireProjectScope(req, res) {
  const { link } = req.guest;
  if (link.scope !== 'project' || !link.project_id) { errorResponse(res, 'not_found', 404); return null; }
  const { Project } = require('../models');
  const project = await Project.findByPk(link.project_id, { attributes: ['id', 'business_id'] });
  // 테넌트 이중 검증 — 링크의 워크스페이스와 프로젝트가 어긋나면 없는 것으로 친다.
  if (!project || project.business_id !== link.business_id) { errorResponse(res, 'not_found', 404); return null; }
  return project;
}

/** 외부에 내보낼 수 있는 노출 범위인가 — L2·L3·L4 만. L1(개인)은 프로젝트에 묶여 있어도 남의 것이다. */
const GUEST_VLEVELS = ['L2', 'L3', 'L4'];

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
    const nameMap = await guestDisplayNames(link.business_id, openIds);

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
    const { Post } = require('../models');
    const post = await Post.findOne({
      where: {
        id: Number(req.params.postId) || 0,
        project_id: project.id, business_id: link.business_id,
        status: 'published', vlevel: GUEST_VLEVELS,
      },
      attributes: ['id', 'title', 'category', 'security_level', 'author_id', 'updatedAt', 'content_json'],
    });
    if (!post) return errorResponse(res, 'not_found', 404);
    if ((post.security_level || 'general') !== 'general') return errorResponse(res, 'not_found', 404);

    const nameMap = await guestDisplayNames(link.business_id, [post.author_id].filter(Boolean));
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
      attributes: ['id', 'file_name', 'file_size', 'mime_type', 'security_level', 'vlevel',
        'uploader_id', 'share_token', 'updatedAt'],
      order: [['updated_at', 'DESC']],
      limit: 200,
    });

    const visible = rows.filter((r) => (r.security_level || 'general') !== 'confidential');
    const lockedCount = rows.length - visible.length;
    const openIds = [...new Set(visible.filter((r) => (r.security_level || 'general') === 'general')
      .map((r) => r.uploader_id).filter(Boolean))];
    const nameMap = await guestDisplayNames(link.business_id, openIds);

    const list = visible.map((r) => {
      const lv = r.security_level || 'general';
      const locked = lv !== 'general';
      return {
        id: r.id,
        file_name: r.file_name,
        file_size: Number(r.file_size) || 0,
        mime_type: r.mime_type || null,
        updated_at: r.updatedAt || null,
        locked,
        // ★ 내려받기는 **이미 외부로 공개된 파일(L4)만**. Irene 원안 "파일 다운로드만 로그인 유도"
        //   (GUEST_LINK §1). 문서는 읽는 것이고 파일은 반출이라 비대칭은 의도다.
        //   토큰은 응답에 싣지 않는다 — 열 때 서버가 302 로 보낸다.
        downloadable: !locked && r.vlevel === 'L4' && !!r.share_token,
        uploader_name: locked ? null : (nameMap.get(r.uploader_id) || null),
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
      attributes: ['id', 'security_level', 'share_token'],
    });
    // 목록에서 거른 것과 **같은 술어**를 다시 태운다 — 주소로 직접 두드리는 경로를 막는다.
    if (!file || !file.share_token) return errorResponse(res, 'not_found', 404);
    if (blocksExternalShare(file)) return errorResponse(res, 'not_found', 404);

    await link.update({ last_used_at: new Date() }).catch(() => null);
    // 헤더만 보낸다 — Express 기본 302 본문에 토큰이 한 번 더 실린다.
    return res.status(302).set('Location', `${APP_URL}/public/files/${file.share_token}`).end();
  } catch (err) { next(err); }
});

module.exports = router;
