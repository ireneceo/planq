// routes/guest.js — 무로그인 게스트 공개 라우트 (운영 #259)
//
// ★ **인증이 없는 표면이다.** 여기 있는 모든 라우트는 토큰 하나로 열린다.
//   그래서 규칙이 셋이다:
//     ① 토큰 해석은 services/guest_link.js 의 resolveGuestToken **하나만** 쓴다.
//        여기서 직접 조회하면 만료·회수·킬스위치 검사 중 하나를 빠뜨린 곳이 생긴다.
//     ② 내보내는 필드는 **화이트리스트**다. exclude 목록이 아니라 include 목록 —
//        나중에 컬럼이 늘어도 자동으로 새지 않는다.
//     ③ 못 찾겠으면 전부 404. 403 을 주면 "그 토큰은 있는데 권한이 없다" 가 새어 나간다.
//
// 설계: docs/GUEST_LINK_DESIGN.md
const express = require('express');
const router = express.Router();
const { Message, User, Conversation, Project } = require('../models');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { blocksExternalShare } = require('../services/securityLevel');
const { Op } = require('sequelize');
// 카드 302 대상 주소를 만들 때 쓴다 — guest_admin 과 같은 원천.
const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

const { guestLimiter, attachGuest } = require('./guest_common');

/** 고객에게 보여도 되는 메시지만 — **정의는 services/guest_link.js 한 곳**이다.
 *  ★ 여기 있던 술어를 서비스로 옮겼다. 답글 알림(services/guest_notify.js)이 같은 판단을
 *    해야 하는데, 베껴 두면 반드시 갈라진다 — 갈라지는 순간 **지운 메시지·내부 메모로
 *    알림 메일이 나간다.** 주석으로 "같은 술어" 라고 쓰는 것은 검증되지 않는다(실사례 있음).
 */
const { visibleToGuest } = require('../services/guest_link');

/** 메시지 화이트리스트 — 내부 필드가 자동으로 따라 나가지 않게. */
const serializeMessage = (m, guestUserId, cardState) => ({
  id: m.id,
  kind: m.kind || 'text',
  content: m.content,
  created_at: m.created_at,
  is_mine: m.sender_id === guestUserId,
  // 카드(청구서·문서·업무…) — **주소는 넣지 않는다.** 누를 때 서버가 302 로만 준다.
  //   meta.share_url 은 발급 당시 스냅샷이라 이미 죽어 있는 경우가 많다(운영 8건 중 5건).
  card: m.kind === 'card' && cardState
    ? require('../services/cardResolver').summarizeCard(m.meta, cardState)
    : null,
  // 보내는 사람은 **표시명만**. 이메일·id 는 내보내지 않는다.
  //   게스트가 쓴 글은 그 행에 박제된 이름을 쓴다 — 그림자 User 이름은 "게스트" 로 고정이라
  //   이것을 안 보면 고객 화면에서 서로가 전부 "게스트" 로 보인다.
  sender_name: (m.sender?.is_guest === true && m.meta?.guest?.name) || m.sender?.name || null,
});

// 답글 알림 신청 (#259 A안) — 별도 파일. `/:token/notify/*` 만 가져간다.
router.use(require('./guest_subscribe'));

// ── GET /api/guest/:token — 대화방 컨텍스트 ────────────────────────────────
router.get('/:token', guestLimiter('guest-ctx', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation, guestUser, client } = req.guest;
    // ★ 이미지 신원 — 보안 Stage 2 가 켜지면 이미지 접근이 canAccessConversation 판정이 된다.
    //   게스트는 **열람만 해도** 신원이 있어야 그 문을 지난다. 여기서 쿠키를 준다.
    try { require('../services/authTokens').setImageCookie(res, { id: guestUser.id }); } catch { /* 이미지 없이도 화면은 떠야 한다 */ }

    let project = null;
    if (link.project_id) {
      const p = await Project.findByPk(link.project_id);
      // 다른 워크스페이스 프로젝트면 없는 것으로 친다(테넌트 이중 검증).
      if (p && p.business_id === link.business_id) {
        // ★ 화이트리스트 — loadProjectDetail 을 재사용하지 않는다. 그건 멤버 이메일까지 담는다.
        project = {
          name: p.name,
          description: p.description || null,
          status: p.status || null,
          start_date: p.start_date || null,
          end_date: p.end_date || null,
        };

        // ── 진행 상황 — **프로젝트 링크(scope='project')일 때만** ────────────────
        //   ★ scope 를 안 보면 **이미 나가 있는 채팅 링크가 조용히 넓어진다**
        //     (docs/PROJECT_EXTERNAL_VIEW_DESIGN.md §2.2). 채팅 링크는 예나 지금이나
        //     프로젝트 이름·설명·상태·기간 5필드만 본다 — 그 화면의 문구가 다시 참이 된다.
        //   숫자와 라벨만 내보낸다. 업무 제목·담당자는 업무 탭 라우트(/tasks)의 몫이다.
        if (link.scope === 'project') {
          const { ProjectStage, Task } = require('../models');

          // 거래 단계 — 라벨·종류·상태만. linked_entity_id 같은 내부 키는 내보내지 않는다.
          const stageRows = await ProjectStage.findAll({
            where: { project_id: p.id },
            attributes: ['order_index', 'kind', 'label', 'status'],
            order: [['order_index', 'ASC']],
            limit: 30,
          });
          project.stages = stageRows.map((s2) => ({
            kind: s2.kind, label: s2.label, status: s2.status,
          }));

          // 업무 — 개요에는 **숫자만**.
          const [taskTotal, taskDone] = await Promise.all([
            Task.count({ where: { project_id: p.id, business_id: link.business_id } }),
            Task.count({ where: { project_id: p.id, business_id: link.business_id, status: 'completed' } }),
          ]);
          project.task_summary = { total: taskTotal, completed: taskDone };
        }
      }
    }
    return successResponse(res, {
      // ★ 화면이 이 값으로 프로젝트 페이지와 채팅 페이지를 가른다. 없으면 옛 링크가 옛 화면으로 간다.
      scope: link.scope || 'conversation',
      guest_name: link.guest_name,
      can_write: !!link.can_write,
      // 계정 요청을 이미 보냈는가 — 화면이 배너를 "요청 보냄" 상태로 바꾼다.
      account_requested: !!link.account_requested_at,
      // 고객은 **선택**이다 (2026-09-02). 붙어 있으면 이름을 보여주고, 없으면 null —
      //   화면은 대화방 제목으로 떨어진다. 여기서 `client.display_name` 을 그냥 읽다가
      //   고객 없는 방에서 **500** 이 났다(읽는 곳 전수 확인을 빠뜨린 것).
      client_name: client ? (client.display_name || client.company_name || null) : null,
      conversation: { id: conversation.id, title: conversation.title || null },
      project,
    });
  } catch (err) { next(err); }
});

// ── GET /api/guest/:token/messages ────────────────────────────────────────
router.get('/:token/messages', guestLimiter('guest-msgs', { windowMs: 60 * 1000, max: 120 }), attachGuest, async (req, res, next) => {
  try {
    const { conversation, guestUser } = req.guest;
    const rows = await Message.findAll({
      // 쿼리에서 한 번, visibleToGuest 에서 또 한 번 — 둘 중 하나가 바뀌어도 안 샌다.
      where: { conversation_id: conversation.id, is_deleted: false },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'is_guest'] }],
      order: [['created_at', 'DESC']],
      limit: 200,
    });
    const visible = rows.map((m) => (m.toJSON ? m.toJSON() : m))
      .filter(visibleToGuest)
      .reverse();
    // 카드 상태는 **행을 보고** 계산한다. 목록당 카드는 보통 한 자릿수라 N+1 부담이 없고,
    //   무엇보다 화면이 "왜 못 여는지" 를 말하려면 서버가 지금 상태를 알아야 한다.
    const { resolveCard } = require('../services/cardResolver');
    const states = new Map();
    for (const m of visible) {
      if (m.kind !== 'card') continue;
      const r = await resolveCard(m.meta, { businessId: conversation.business_id, appUrl: APP_URL });
      states.set(m.id, r.state);
    }
    const list = visible.map((m) => serializeMessage(m, guestUser.id, states.get(m.id)));
    return successResponse(res, list);
  } catch (err) { next(err); }
});

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

// ── POST /api/guest/:token/account-request ────────────────────────────────
//   게스트가 "계정 요청하기" 를 누른다. **가입 화면으로 보내지 않는다** —
//   초대 토큰 없이 가입하면 `routes/auth.js:216` 가 자기 워크스페이스를 새로 만들어
//   고객이 빈 화면에 떨어지고 이 대화는 못 본다(Fable 설계 판정 2026-09-02).
//   여기서는 **담당자에게 알림만** 보내고, 계정 생성은 멤버가 보내는 초대 메일 한 곳으로 몬다.
router.post('/:token/account-request',
  guestLimiter('guest-account-req', { windowMs: 60 * 60 * 1000, max: 5 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation } = req.guest;
    // 링크당 1회. 24시간 지나면 다시 보낼 수 있다 — 담당자가 놓쳤을 수 있으므로 영구 차단은 아니다.
    const last = link.account_requested_at ? new Date(link.account_requested_at).getTime() : 0;
    if (last && Date.now() - last < 24 * 60 * 60 * 1000) {
      return successResponse(res, { account_requested: true }, 'already_requested');
    }
    // 이메일은 **선택**이고 힌트일 뿐이다 — 멤버가 초대할 때 바꿀 수 있다.
    //   무인증 입력이라 형식만 보고 길이를 자른다.
    let email = null;
    const rawEmail = String(req.body?.email || '').trim().slice(0, 200);
    if (rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) email = rawEmail;

    await link.update({ account_requested_at: new Date(), requested_email: email });

    try {
      const { notifyMany } = require('./notifications');
      const { ConversationParticipant } = require('../models');
      // 스코프 — 이 방(conversation)은 **링크가 정한다**(attachGuest 가 토큰 → link → 방).
      //   링크에는 business_id 가 박혀 있으므로 이 목록은 그 워크스페이스 안이다.
      //   참가자 테이블에는 business_id 컬럼이 없어 조건으로 다시 걸 수 없다 — 아래 알림도
      //   conversation.business_id 로 보낸다.
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conversation.id }, attributes: ['user_id', 'role'],
      });
      const memberIds = parts.filter((p) => p.role !== 'client' && p.user_id !== req.guest.guestUser.id).map((p) => p.user_id);
      if (memberIds.length) {
        await notifyMany({
          userIds: memberIds,
          businessId: conversation.business_id,
          eventKind: 'message',
          title: '고객이 계정을 요청했습니다',
          body: email
            ? `${conversation.title || '대화방'} — ${email} 로 초대해 주세요`
            : `${conversation.title || '대화방'} — 링크로 들어온 분이 계정을 요청했습니다`,
          link: `/talk?conv=${conversation.id}`,
          ctaLabel: '대화 열기',
          entityType: 'Conversation',
          entityId: conversation.id,
          ioApp: req.app,
        });
      }
    } catch (e) {
      // 알림이 실패해도 요청 자체는 기록됐다 — 게스트에게 실패로 보이면 계속 다시 누른다.
      console.error('[guest] account-request notify 실패:', e.message);
    }
    return successResponse(res, { account_requested: true }, 'requested');
  } catch (err) { next(err); }
});


// ── 프로젝트 링크 2차: 문서·파일 ─────────────────────────────────────────
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

// ── GET /api/guest/:token/cards/:messageId/open ───────────────────────────
//   카드를 **누를 때** 서버가 지금 주소를 해석해 302 로 보낸다.
//   응답 JSON 에 토큰을 실어 보내지 않는 이유는 cardResolver 파일 주석 참조.
//   실패는 전부 404 — 왜 실패했는지 게스트에게 알려 주면 그것이 곧 정찰 수단이 된다.
router.get('/:token/cards/:messageId/open',
  guestLimiter('guest-card-open', { windowMs: 60 * 1000, max: 60 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation } = req.guest;
    const msg = await Message.findOne({
      where: { id: Number(req.params.messageId) || 0, conversation_id: conversation.id, is_deleted: false },
    });
    if (!msg || msg.kind !== 'card') return errorResponse(res, 'not_found', 404);
    // 목록에서 거른 것과 **같은 술어**를 다시 태운다 — 링크로 직접 두드리는 경로를 막는다.
    if (!visibleToGuest(msg.toJSON ? msg.toJSON() : msg)) return errorResponse(res, 'not_found', 404);

    const { resolveCard } = require('../services/cardResolver');
    const r = await resolveCard(msg.meta, { businessId: conversation.business_id, appUrl: APP_URL });
    if (r.state !== 'ok' || !r.url) return errorResponse(res, 'not_found', 404);

    // 사용 기록 — 열람도 사용이다(슬라이딩 만료가 뒤로 밀린다).
    await link.update({ last_used_at: new Date() }).catch(() => null);
    // 헤더만 보낸다 — Express 기본 302 본문(`Found. Redirecting to <url>`)에 토큰이 한 번 더 실린다.
    //   Location 과 같은 값이라 새 노출은 아니지만, 내보낼 이유도 없다.
    return res.status(302).set('Location', r.url).end();
  } catch (err) { next(err); }
});

// ── POST /api/guest/:token/messages ───────────────────────────────────────
//   게스트가 글을 쓴다. **텍스트만** — 파일 업로드는 2단계(쿼터·악성파일 축이 별도 설계).
router.post('/:token/messages', guestLimiter('guest-send', { windowMs: 60 * 1000, max: 10 }), attachGuest, async (req, res, next) => {
  try {
    const { link, conversation, guestUser } = req.guest;
    if (!link.can_write) return errorResponse(res, 'read_only_link', 403);
    const raw = String(req.body?.content || '').trim();
    if (!raw) return errorResponse(res, 'content_required', 400);
    if (raw.length > 4000) return errorResponse(res, 'content_too_long', 400);

    // ★ 무인증 표면이다 — 기존 메시지 라우트는 문자열을 그대로 저장하지만(프론트가 렌더 시 정화),
    //   여기는 아무나 쓸 수 있으므로 **태그를 아예 걷어낸다.** 게스트는 서식이 필요 없다.
    //   프론트 정화기를 믿고 원문을 넣으면, 그 정화기가 한 번 무너질 때 이 입구가 통로가 된다.
    const cleaned = raw.replace(/<[^>]*>/g, '').slice(0, 4000);
    if (!cleaned.trim()) return errorResponse(res, 'content_required', 400);

    // ── 게스트가 스스로 정하는 표시명 (선택) ──────────────────────────────
    //   무인증 입력이다. 프론트 정화기를 믿지 않는다 — 본문과 같은 원칙.
    //   비어 있으면 null → 화면은 "게스트" 로 그린다.
    let guestDisplayName = null;
    const rawName = req.body?.guest_name;
    if (rawName != null) {
      const n = String(rawName)
        .replace(/<[^>]*>/g, '')             // 태그
        .replace(/[\u0000-\u001F\u007F]/g, '')  // 제어문자
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30);                        // 30자 캡
      if (n) {
        // 사칭 차단 — 우리 쪽 사람으로 보이는 이름은 거절한다. 뱃지가 최종 방어지만
        //   "PlanQ 관리자" 가 이름으로 통과하면 뱃지를 못 본 사람에게는 통한다.
        const RESERVED = ['planq', 'cue', '관리자', 'admin', '운영자', '담당자'];
        const low = n.toLowerCase();
        if (RESERVED.some((w) => low.includes(w))) return errorResponse(res, 'name_reserved', 400);
        guestDisplayName = n;
      }
    }
    const msg = await Message.create({
      conversation_id: conversation.id,
      sender_id: guestUser.id,   // 그림자 User — sender_id 는 NOT NULL 이다
      content: cleaned,
      kind: 'text',
      is_ai: false,
      is_internal: false,        // ★ 게스트는 내부 메모를 만들 수 없다. 하드코딩이다
      // ★ 표시명은 **이 행에 박제**한다 (2026-09-02).
      //   한 링크를 여럿이 나눠 갖는 것이 이 기능의 전제라(설계 §2), 이름을 링크나 그림자 User 에
      //   두면 **나중 사람이 이름을 정하는 순간 과거 메시지의 이름까지 소급해서 바뀐다.**
      //   신원(누가 썼나) = 링크의 그림자 User, 라벨(뭐라고 보이나) = 이 값. 둘을 갈라 둔다.
      //   link_id 는 §8 승격(이 링크 발 메시지만 이관)의 열쇠이기도 하다.
      //   이름이 없으면 키 자체를 넣지 않는다 — JSON null 은 읽는 쪽에서 문자열 'null' 로
      //   새어 나갈 자리를 만든다(실측: 목록 미리보기에 "null" 이 이름으로 떴다).
      meta: { guest: guestDisplayName ? { link_id: link.id, name: guestDisplayName } : { link_id: link.id } },
    });
    await conversation.update({ last_message_at: new Date() });
    await link.increment('message_count');

    // 실시간 반영 — 멤버 Q Talk 이 즉시 본다 (CLAUDE.md 운영 안정성 §16).
    const full = await Message.findByPk(msg.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized', 'is_guest'] }],
    });
    const io = req.app.get('io');
    if (io && full) {
      const payload = full.toJSON();
      // 표시명은 REST 와 **같은 헬퍼**로 바꾼다 — 경로마다 따로 쓰면 반드시 갈라진다.
      require('../services/displayName').applyGuestDisplayName(payload);
      payload.via_guest_link = true;   // (옛 필드 — 뱃지 근거는 sender.is_guest 다)
      io.to(`conv:${conversation.id}`).emit('message:new', payload);
      io.to(`business:${conversation.business_id}`).emit('message:new', payload);
    }

    // 멤버에게 알림 — 게스트가 글을 썼는데 아무도 모르면 이 기능은 무용지물이다.
    try {
      const { notifyMany } = require('./notifications');
      const { ConversationParticipant } = require('../models');
      const parts = await ConversationParticipant.findAll({
        where: { conversation_id: conversation.id },
        attributes: ['user_id', 'role'],
      });
      const memberIds = parts.filter((p) => p.role !== 'client' && p.user_id !== guestUser.id).map((p) => p.user_id);
      if (memberIds.length) {
        await notifyMany({
          userIds: memberIds,
          businessId: conversation.business_id,
          eventKind: 'message',
          // link.guest_name 은 멤버 메모용이라 대개 비어 있다. 이 글을 쓴 사람의 이름을 쓴다.
          title: `${guestDisplayName || link.guest_name || '게스트'} (게스트)`,
          // 정화 전 raw 가 아니라 태그를 걷어낸 cleaned 를 넣는다 — 알림은 메일·inbox·push 로
          //   퍼지고 그중 하나만 HTML 로 렌더하면 무인증 입구가 그대로 통로가 된다 (#259).
          body: cleaned.length > 140 ? cleaned.slice(0, 140) + '…' : cleaned,
          link: `/talk?conv=${conversation.id}`,
          ctaLabel: '대화 열기',
          entityType: 'Conversation',
          entityId: conversation.id,
          ioApp: req.app,
        });
      }
    } catch (e) { console.warn('[guest] notify 실패:', e.message); }

    return successResponse(res, { id: msg.id, created_at: msg.created_at }, 'sent', 201);
  } catch (err) { next(err); }
});

module.exports = router;
