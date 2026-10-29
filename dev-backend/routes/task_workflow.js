// 업무 워크플로우 라우트 — 멀티 컨펌 기반.
//
// 이 파일은 **HTTP 만** 안다: 파싱 → actor 구성 → 행동 계층 호출 → 응답 직렬화.
// 전이 규칙·권한·이력·알림·broadcast·Focus 정리는 전부 `services/actions/task_actions.js` 안에 있다.
//   왜 — 라우트를 통과하지 않는 실행자(Cue·cron)가 그 규칙들을 통째로 우회하던 구멍을 막기 위해서다.
//   사람이 여기로 들어오든 Cue 가 직접 함수를 부르든 **같은 문**을 지난다.
//
// 역할 구분:
//   담당자 = tasks.assignee_id · 요청자 = tasks.request_by_user_id(또는 created_by) · 컨펌자 = task_reviewers
//   오너   = business_members.role='owner' or platform_admin

const express = require('express');
const router = express.Router();
const { Task, TaskReviewer, TaskWatcher, TaskStatusHistory, User, BusinessMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');
// §8.5 — 고객용 task 직렬화 (공수 시간·예측 출처·내부 메타 차단)
const { serializeTaskForClient } = require('../utils/taskClientView');
const { withBothTimestamps } = require('../utils/rowTimestamps');
const actions = require('../services/actions/task_actions');

// 이 워크스페이스의 멤버가 아니면 고객(요청자)으로 간주 — 응답에서 내부 운영 데이터를 지운다.
async function isClientUser(task, userId) {
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  return !bm;
}

async function loadTaskOrFail(taskId, res, req) {
  const task = await Task.findByPk(taskId);
  // 볼 수 없는 업무는 없는 것과 같다 — 모든 워크플로 행동의 문(2026-10-12 Fable: 관리자가 남의 «나만 보기» 업무를
  //   보류·정책·컨펌자 지정으로 바꾸고 응답으로 내용을 받았다). 읽기 판정 한 곳(access_scope.canAccessTask).
  if (!task || (req && !(await require('../middleware/access_scope').canAccessTask(req.user.id, task)))) {
    errorResponse(res, 'task_not_found', 404);
    return null;
  }
  return task;
}

// 행동의 주체 — 사람이 HTTP 로 들어온 경우. Cue 는 같은 형태를 직접 만들어 행동 계층을 부른다.
//   req 는 감사 로그의 IP 맥락에만 쓴다 (도메인 판단에는 쓰지 않는다).
function actorFrom(req) {
  return {
    kind: 'user',
    userId: req.user.id,
    onBehalfOfUserId: null,
    platformRole: req.user.platform_role || null,
    req,
  };
}

// 행동 계층 결과 → HTTP. code 는 그대로 내보낸다 (프론트가 이 문자열로 분기한다 — 에러도 계약이다).
function sendResult(res, result, onOk) {
  if (!result.ok) return errorResponse(res, result.code, result.http || 400);
  return onOk(result.data);
}

// 읽기 전용 접근 판단 (GET /workflow) — 같은 워크스페이스 멤버이거나 담당자/요청자/컨펌자
async function canAccessTask(task, userId) {
  // 공개 범위(2026-10-12) — 읽기 판정 한 곳(access_scope.canAccessTask)을 먼저 지난다. 남의 «나만 보기»·지정 멤버
  //   업무의 결과물 버전·워크플로가 멤버라는 이유만으로 열리던 사본이었다. 아래 종전 조건(고객은 관계자만)은 그대로 둔다.
  if (!(await require('../middleware/access_scope').canAccessTask(userId, task))) return false;
  if (task.assignee_id === userId) return true;
  if (task.created_by === userId) return true;
  if (task.request_by_user_id === userId) return true;
  const rev = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: userId } });
  if (rev) return true;
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  return !!bm;
}

// ─────────────────────────────────────────────
// POST /api/tasks/:id/ack — 담당자 요청 확인완료
// ─────────────────────────────────────────────
router.post('/:id/ack', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.ack(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/submit-review — 담당자 컨펌 요청 (라운드 시작)
// Body: { note?: string, body?: string }
//   ★ `body` 는 **제출 시점의 결과물 본문**이다. 화면이 자동저장을 기다리지 않고 제출해도
//     마지막 타이핑이 박제본에서 빠지지 않게 같이 받아 한 트랜잭션에 쓴다.
// ─────────────────────────────────────────────
router.post('/:id/submit-review', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.submitReview(task, actorFrom(req), {
      note: req.body?.note || null,
      // undefined 면 종전대로 서버의 현재 body 를 박제한다(옛 클라이언트 호환).
      ...(typeof req.body?.body === 'string' ? { body: req.body.body } : {}),
    });
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/cancel-review — 담당자 컨펌 요청 취소
// ─────────────────────────────────────────────
router.post('/:id/cancel-review', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.cancelReview(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/approve — 컨펌자 승인
// Body: { note?: string }
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/approve', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.approve(task, actorFrom(req), { note: req.body?.note || null });
    return sendResult(res, result, ({ task: t, newStatus }) =>
      successResponse(res, { task: t.toJSON(), new_status: newStatus }));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/revision — 컨펌자 수정 요청
// Body: { note: string } — 필수. 단 이번 라운드에 내 댓글이 있으면 비워도 된다(#466, 그 댓글을 가리킨다)
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/revision', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.requestRevision(task, actorFrom(req), { note: req.body?.note });
    // #112 — 프론트가 이 comment_id 로 참고 파일을 첨부한다 (context='comment')
    return sendResult(res, result, ({ task: t, revisionCommentId, revisionRefCommentId }) =>
      successResponse(res, { ...t.toJSON(), revision_comment_id: revisionCommentId, revision_ref_comment_id: revisionRefCommentId }));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/revert — 컨펌자 본인 판단 되돌리기 (라운드당 1회)
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/revert', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.revertReviewerState(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/revert-status — 업무 단계 되돌리기 (#10)
//   직전 상태로 복귀. 권한: 담당자 / admin / owner.
// ─────────────────────────────────────────────
router.post('/:id/revert-status', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.revertStatus(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/hold — 업무 보류 (#206)
//   body: { reason?: string }  권한: 담당자 / 작성자 / owner / admin
// ─────────────────────────────────────────────
router.post('/:id/hold', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.hold(task, actorFrom(req), { reason: req.body?.reason });
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/resume — 보류/외부컨펌 해제 (#206)
//   on_hold → hold_prev_status 복귀 / external_review → in_progress
// ─────────────────────────────────────────────
router.post('/:id/resume', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.resume(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/complete — 담당자 최종 완료 (컨펌자 0명일 때만)
// ─────────────────────────────────────────────
router.post('/:id/complete', authenticateToken, async (req, res, next) => { // audit-exempt: 상태 전이는 task_status_history 가 원장이다(행동 계층 logHistory)
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.complete(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers — 컨펌자 추가
// Body: { user_id }
// ─────────────────────────────────────────────

// ── 반복업무 시리즈 범위 적용 (2026-09-08) ──────────────────────────────
//   Irene: "업무가 반복된다는 건 내용도 반복관리가 되어야 하잖아."
//   컨펌자·컨펌정책은 회차마다 달라야 할 이유가 없는 **시리즈의 성질**인데, 이 라우트들에는
//   범위 개념이 아예 없어서 제목·담당자만 전체에 반영되고 컨펌자는 이 회차에만 남았다.
//   대상 산출은 PUT·태그와 **같은 함수**(services/taskSeriesScope)를 부른다.
//
//   ★ 다른 회차에도 **행동 계층을 그대로 태운다** — 권한·감사·브로드캐스트가 회차마다 필요하다.
//     여기서 DB 를 직접 건드리면 그 셋이 통째로 빠진다(memory: feedback_workflow_routes_bypass_side_effects).
//     한 회차가 실패해도 나머지는 진행하고, 몇 건에 적용됐는지 응답에 싣는다.
async function applyToSeries(req, task, run) {
  const { seriesTargetIds } = require('../services/taskSeriesScope');
  const { ids, scope } = await seriesTargetIds(task, req.body?.series_scope);
  const others = ids.filter((id) => id !== task.id);
  let applied = 1;
  for (const id of others) {
    try {
      const t = await Task.findOne({ where: { id, business_id: task.business_id } });
      if (!t) continue;
      const r = await run(t);
      if (r && r.ok !== false) applied += 1;
    } catch (e) {
      console.warn('[task_workflow] 시리즈 적용 실패 (task', id, '):', e.message);
    }
  }
  return { scope, applied };
}

router.post('/:id/reviewers', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 행동 계층(services/actions/task_actions.js audit())이 남긴다 — 라우트에서 또 쓰면 한 사건이 두 행
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.addReviewer(task, actorFrom(req), { userId: req.body?.user_id });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);
    const series = await applyToSeries(req, task,
      (t) => actions.addReviewer(t, actorFrom(req), { userId: req.body?.user_id }));
    const json = result.data;
    const out = (await isClientUser(task, req.user.id)) ? serializeTaskForClient(json) : json;
    return successResponse(res, { ...(out.toJSON ? out.toJSON() : out), series_scope: series.scope, series_applied: series.applied });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// DELETE /api/tasks/:id/reviewers/:userId — 컨펌자 제거
// ─────────────────────────────────────────────
router.delete('/:id/reviewers/:userId', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 행동 계층(services/actions/task_actions.js audit())이 남긴다 — 라우트에서 또 쓰면 한 사건이 두 행
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.removeReviewer(task, actorFrom(req), { userId: req.params.userId });
    if (result.ok !== false) {
      // 컨펌자를 뺄 때도 같은 범위를 쓴다 — 넣을 때만 전체에 적용되면 목록이 어긋난 채 남는다.
      //   ★ DELETE 는 body 를 잘 안 보내므로 쿼리스트링도 받는다.
      await applyToSeries({ body: { series_scope: req.body?.series_scope || req.query?.series_scope } }, task,
        (t) => actions.removeReviewer(t, actorFrom(req), { userId: req.params.userId }));
    }
    return sendResult(res, result, (data) => successResponse(res, data));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/watchers — 참조자 추가 (2026-10-27)
// Body: { user_id, series_scope? }
//   참조자는 반복 업무 시리즈의 성질이기도 하다 — 컨펌자와 같은 범위 적용.
// ─────────────────────────────────────────────
router.post('/:id/watchers', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 행동 계층(services/actions/task_actions.js audit())이 남긴다 — 라우트에서 또 쓰면 한 사건이 두 행
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.addWatcher(task, actorFrom(req), { userId: req.body?.user_id });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);
    const series = await applyToSeries(req, task,
      (t) => actions.addWatcher(t, actorFrom(req), { userId: req.body?.user_id }));
    return successResponse(res, { ...result.data, series_scope: series.scope, series_applied: series.applied });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// DELETE /api/tasks/:id/watchers/:userId — 참조자 제거 · 본인 빠지기
// ─────────────────────────────────────────────
router.delete('/:id/watchers/:userId', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 행동 계층(services/actions/task_actions.js audit())이 남긴다 — 라우트에서 또 쓰면 한 사건이 두 행
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.removeWatcher(task, actorFrom(req), { userId: req.params.userId });
    if (result.ok !== false) {
      await applyToSeries({ body: { series_scope: req.body?.series_scope || req.query?.series_scope } }, task,
        (t) => actions.removeWatcher(t, actorFrom(req), { userId: req.params.userId }));
    }
    return sendResult(res, result, (data) => successResponse(res, data));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// PATCH /api/tasks/:id/policy — 컨펌 정책 변경
// Body: { review_policy: 'all' | 'any' }
// ─────────────────────────────────────────────
router.patch('/:id/policy', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 행동 계층(services/actions/task_actions.js audit())이 남긴다 — 라우트에서 또 쓰면 한 사건이 두 행
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    const result = await actions.setPolicy(task, actorFrom(req), { policy: req.body?.review_policy });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);
    // 컨펌 정책도 회차마다 다를 이유가 없다 — 컨펌자와 같은 축이다.
    await applyToSeries(req, task, (t) => actions.setPolicy(t, actorFrom(req), { policy: req.body?.review_policy }));
    const json = result.data.toJSON();
    return successResponse(res, (await isClientUser(task, req.user.id)) ? serializeTaskForClient(json) : json);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// GET /api/tasks/:id/workflow — 상세 (reviewers + history)
//   읽기 전용 — 행동이 아니므로 라우트에 남는다.
// ─────────────────────────────────────────────
router.get('/:id/workflow', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res, req);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);

    const [watchers, reviewers, history] = await Promise.all([
      TaskWatcher.findAll({
        where: { task_id: task.id },
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar_url'] }],
        order: [['created_at', 'ASC']],
      }),
      TaskReviewer.findAll({
        where: { task_id: task.id },
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'avatar_url'] }],
        order: [['created_at', 'ASC']],
      }),
      TaskStatusHistory.findAll({
        where: { task_id: task.id },
        include: [
          { model: User, as: 'actor', attributes: ['id', 'name'] },
          { model: User, as: 'target', attributes: ['id', 'name'] },
        ],
        order: [['created_at', 'ASC']],
      }),
    ]);

    const wfTaskJson = task.toJSON();
    const reviewersJson = reviewers.map((r) => r.toJSON());
    // ★ 시각은 **두 이름으로** 싣는다 (utils/rowTimestamps.js) — `h.toJSON()` 은 최상위라
    //   전역 override 가 `createdAt` 을 지우는데 화면은 그 이름을 읽어, 히스토리 시각이
    //   2026-04-25 부터 **빈칸**이었다(Fable 실측: 업무 #692 2건 모두 ""). 댓글과 같은 계열.
    const historyJson = history.map((h) => withBothTimestamps(h));
    await applyMemberDisplayName(reviewersJson, task.business_id, ['user']);
    // 참조자 — 내부 멤버만이라 고객 화면에는 싣지 않는다(1차 · Fable 설계 판정)
    const viewerIsClient = await isClientUser(task, req.user.id);
    const watchersJson = viewerIsClient ? [] : watchers.map((w) => w.toJSON());
    await applyMemberDisplayName(watchersJson, task.business_id, ['user']);
    await applyMemberDisplayName(historyJson, task.business_id, ['actor', 'target']);
    // 옛 행 가리기 — 2026-08-25 이전 assignee_change/project_change 는 note 에 **id 원문**이
    //   들어 있다("5 → 1000279"). 프로젝트 히스토리와 **같은 술어**를 쓴다(두 벌로 가르면 갈라진다).
    //   쓰기측은 이름으로 이미 고쳤고, 이미 쌓인 행만 화면에서 숨긴다(대상 이름이 그 역할을 한다).
    const { looksLikeRawIdNote } = require('../services/event_stream');
    for (const h of historyJson) {
      if (looksLikeRawIdNote(h.event_type, h.note)) h.note = null;
    }
    return successResponse(res, {
      task: (await isClientUser(task, req.user.id)) ? serializeTaskForClient(wfTaskJson) : wfTaskJson,
      reviewers: reviewersJson,
      watchers: watchersJson,
      history: historyJson,
    });
  } catch (err) { next(err); }
});

module.exports = router;
// 같은 접두어(/api/tasks)의 형제 라우터(routes/task_deliverables.js)가 같은 문(볼 권한·주체·결과)을 쓴다 — 베끼지 않는다.
module.exports.helpers = { loadTaskOrFail, actorFrom, sendResult, canAccessTask };
