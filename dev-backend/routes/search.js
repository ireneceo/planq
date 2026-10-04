// 통합 검색 — 워크스페이스 모든 도메인을 한 번에 검색.
// GET /api/search?business_id=X&q=...&limit=10
//   결과: { tasks, posts, records, files, conversations, knowledge, clients, projects,
//           mail, events, interactions, project_notes, meeting_notes }   ← 뒤 다섯은 2026-10-04 M3-b(확정 §12-⑤)
//   각 결과에 `match: { field, snippet } | null` — "왜 이 결과가 여기 있는가" (2026-09-11).
//     field   = 맞은 필드 (title·description·content·category·table·file_name·name·company·email·body·value·subject·summary·location)
//     snippet = 그 필드가 목록 행에 **안 보일 때만** 매칭 주변 평문 창(≤160자). 보이면 null.
//     규칙: utils/searchMatch.js — 프론트 하이라이트(utils/searchMatch.ts)와 같은 정규식.
//     ★ 본문 전체는 응답에 싣지 않는다(스니펫 계산에 쓴 컬럼은 내보내기 전에 뺀다).
//     ★ 비밀(secret) 항목 값에서는 스니펫을 만들지 않는다.
// 권한: 사용자 scope 기준 — client 격리 + project 멤버 한정 + KB 차단 등.
//
// ★ 2026-10-04 — 권한 범위(buildScopedWheres)와 그룹별 조회는 services/searchScope 로 **옮겼다**(동작 무변경).
//   AI 앱의 search_all 이 같은 함수를 부른다 — 라우트에 두고 베끼면 두 입구가 갈라진다(설계 docs/AI_AGENT_M3_DESIGN.md §5.2).
const searchGates = require('../services/searchGates');
const express = require('express');
const router = express.Router();
const { Task, Post, File, Conversation } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const S = require('../services/searchScope');
const { TASK_ORDER, buildScopedWheres } = S;

// GET /api/search/recent?business_id=X&limit=5
//   운영 #305 — "검색이랑 상단 탭 열 때 최신글이나 문서 등 이런거 보여주는 거 기본 아니야? 검색 전에."
//   빈 검색창은 아무것도 못 하는 화면이었다. 열자마자 **최근에 손댄 것**을 보여주면
//   대부분의 이동은 타이핑 없이 끝난다.
//   ★ 검색과 같은 권한 규칙(buildScopedWheres)을 쓴다 — 여기만 느슨하면 그게 곧 유출이다.
router.get('/recent', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    const w = await buildScopedWheres(req.user.id, businessId, req.user.platform_role);
    if (!w) return errorResponse(res, 'forbidden', 403);

    const [posts, tasks, files, conversations] = await Promise.all([
      Post.findAll({
        where: w.postWhere, attributes: ['id', 'title', 'category', 'project_id', 'kind'],
        limit, order: [['updated_at', 'DESC']],
      }).catch(() => []),
      Task.findAll({
        where: w.taskWhere, attributes: ['id', 'title', 'status', 'project_id'],
        limit, order: TASK_ORDER,
      }).catch(() => []),
      File.findAll({
        where: { ...w.fileWhere, deleted_at: null }, attributes: ['id', 'file_name', 'file_size', 'mime_type'],
        limit, order: [['created_at', 'DESC']],
      }).catch(() => []),
      Conversation.findAll({
        where: w.convWhere, attributes: ['id', 'title', 'display_name', 'project_id'],
        limit, order: [['last_message_at', 'DESC']],
      }).catch(() => []),
    ]);

    const toPlain = (m) => (m && typeof m.toJSON === 'function') ? m.toJSON() : m;
    return successResponse(res, {
      posts: posts.map(toPlain),
      tasks: tasks.map(toPlain),
      files: files.map(toPlain),
      conversations: conversations.map(toPlain),
    });
  } catch (err) { next(err); }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.query.business_id);
    // ★ #364 — 검색어도 조합형(NFC)으로 통일한다. 맥에서 복사한 검색어는 분해형(NFD)이라
    //   눈에는 같아 보여도 저장값과 바이트가 달라 LIKE 가 한 건도 못 찾는다(조용한 실패).
    //   저장측은 services/filename.js 가 NFC 로 통일한다 — 양쪽 축을 맞춰야 의미가 있다.
    const q = String(req.query.q || '').normalize('NFC').trim();
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!q) return successResponse(res, { tasks: [], posts: [], records: [], files: [], conversations: [], knowledge: [], clients: [], projects: [], mail: [], events: [], interactions: [], project_notes: [], meeting_notes: [] });

    // ★ 2026-08-20 — 여기가 **비멤버에게 타 워크스페이스 업무·대화를 내주고 있었다**(Fable 실측).
    //   옛 코드는 `getUserScope` 결과를 `if (!scope)` 로 검사했는데, 그 함수는 완전 외부인에게도
    //   truthy(모든 플래그 false)를 준다 → 403 이 영원히 안 난다. 이어 taskListWhere/conversationListWhere
    //   가 거부 뜻으로 돌려준 null 이 `where: null` = **조건 없음**으로 해석돼 전 워크스페이스가 샜다.
    //   접근권 판정을 assertWorkspaceAccess 로 바꾸고, where 는 deny() 로 2차 차단한다(buildScopedWheres 와 동일 계약).
    const w = await buildScopedWheres(req.user.id, businessId, req.user.platform_role);
    if (!w) return errorResponse(res, 'forbidden', 403);
    const { isClient } = w;
    const M = S.makeMatcher(q);
    const opt = { limit };
    // 새 다섯 그룹 — 메뉴가 숨겨졌거나 고객이면 부르지도 않는다(services/searchGates.newGroupGates)
    const gates = await searchGates.newGroupGates(businessId, req.user, isClient);
    const none = () => Promise.resolve([]);

    // 병렬 검색 — 그룹 함수는 services/searchScope 한 벌(AI search_all 과 공유)
    const [tasks, posts, records, files, conversations, knowledge, clients, projects,
      mail, events, interactions, projectNotes, meetingNotes] = await Promise.all([
      S.searchTasks(w, M, opt),
      S.searchPosts(w, M, opt).catch(() => []),
      // #359 — 폐지된 "Q record" 잔재. 검색에서 뺀다.
      //   Q record 메뉴는 이미 폐지돼 Q docs 의 표(kind='table')로 흡수됐다(App.tsx:122, /records → /docs).
      //   응답 키는 빈 배열로 남긴다: 옛 프론트 번들이 아직 살아 있을 수 있어 undefined 로 깨뜨리지 않는다.
      Promise.resolve([]),
      S.searchFiles(w, M, opt),
      S.searchConversations(w, M, opt),
      S.searchKnowledge(w, M, opt).catch(() => []),
      S.searchClients(w, M, opt),
      S.searchProjects(w, M, opt),
      gates.mail ? S.searchMail(w, M, opt).catch(() => []) : none(),
      gates.events ? S.searchEvents(w, M, opt).catch(() => []) : none(),
      gates.interactions ? S.searchInteractions(w, M, opt).catch(() => []) : none(),
      gates.project_notes ? S.searchProjectNotes(w, M, opt).catch(() => []) : none(),
      // 회의록은 q-note 가 정한다(상한 10). 사람 화면은 실패를 빈 목록으로 그린다(검색창 전체를 죽이지 않는다).
      gates.meeting_notes ? S.searchMeetingNotes(w, M, opt).then((r) => r.items).catch(() => []) : none(),
    ]);

    // 메뉴 권한 — Q task·Q sale 이 «숨김» 인 멤버에게는 검색에서도 그 결과를 내지 않는다(services/searchGates).
    await searchGates.applyMenuGates({ tasks, clients }, businessId, req.user, isClient);

    successResponse(res, {
      tasks: S.shapeTasks(tasks, q),
      posts,
      records,
      files,
      conversations,
      knowledge,
      clients: S.shapeClients(clients, q),
      projects,
      mail,
      events,
      interactions,
      project_notes: projectNotes,
      meeting_notes: meetingNotes,
    });
  } catch (err) { next(err); }
});

module.exports = router;
