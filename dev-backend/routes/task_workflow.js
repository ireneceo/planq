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
const { Task, TaskReviewer, TaskStatusHistory, User, BusinessMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { applyMemberDisplayName } = require('../services/displayName');
// §8.5 — 고객용 task 직렬화 (공수 시간·예측 출처·내부 메타 차단)
const { serializeTaskForClient } = require('../utils/taskClientView');
const actions = require('../services/actions/task_actions');

// 이 워크스페이스의 멤버가 아니면 고객(요청자)으로 간주 — 응답에서 내부 운영 데이터를 지운다.
async function isClientUser(task, userId) {
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  return !bm;
}

async function loadTaskOrFail(taskId, res) {
  const task = await Task.findByPk(taskId);
  if (!task) {
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
router.post('/:id/ack', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.ack(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/submit-review — 담당자 컨펌 요청 (라운드 시작)
// Body: { note?: string }
// ─────────────────────────────────────────────
router.post('/:id/submit-review', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.submitReview(task, actorFrom(req), { note: req.body?.note || null });
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/cancel-review — 담당자 컨펌 요청 취소
// ─────────────────────────────────────────────
router.post('/:id/cancel-review', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.cancelReview(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/approve — 컨펌자 승인
// Body: { note?: string }
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/approve', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.approve(task, actorFrom(req), { note: req.body?.note || null });
    return sendResult(res, result, ({ task: t, newStatus }) =>
      successResponse(res, { task: t.toJSON(), new_status: newStatus }));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/revision — 컨펌자 수정 요청
// Body: { note: string (필수) }
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/revision', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.requestRevision(task, actorFrom(req), { note: req.body?.note });
    // #112 — 프론트가 이 comment_id 로 참고 파일을 첨부한다 (context='comment')
    return sendResult(res, result, ({ task: t, revisionCommentId }) =>
      successResponse(res, { ...t.toJSON(), revision_comment_id: revisionCommentId }));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/revert — 컨펌자 본인 판단 되돌리기 (라운드당 1회)
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/revert', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.revertReviewerState(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/revert-status — 업무 단계 되돌리기 (#10)
//   직전 상태로 복귀. 권한: 담당자 / admin / owner.
// ─────────────────────────────────────────────
router.post('/:id/revert-status', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.revertStatus(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/complete — 담당자 최종 완료 (컨펌자 0명일 때만)
// ─────────────────────────────────────────────
router.post('/:id/complete', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.complete(task, actorFrom(req));
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers — 컨펌자 추가
// Body: { user_id }
// ─────────────────────────────────────────────
router.post('/:id/reviewers', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.addReviewer(task, actorFrom(req), { userId: req.body?.user_id });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);
    const json = result.data;
    return successResponse(res, (await isClientUser(task, req.user.id)) ? serializeTaskForClient(json) : json);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// DELETE /api/tasks/:id/reviewers/:userId — 컨펌자 제거
// ─────────────────────────────────────────────
router.delete('/:id/reviewers/:userId', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.removeReviewer(task, actorFrom(req), { userId: req.params.userId });
    return sendResult(res, result, (data) => successResponse(res, data));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// PATCH /api/tasks/:id/policy — 컨펌 정책 변경
// Body: { review_policy: 'all' | 'any' }
// ─────────────────────────────────────────────
router.patch('/:id/policy', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.setPolicy(task, actorFrom(req), { policy: req.body?.review_policy });
    if (!result.ok) return errorResponse(res, result.code, result.http || 400);
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
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);

    const [reviewers, history] = await Promise.all([
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
    const historyJson = history.map((h) => h.toJSON());
    await applyMemberDisplayName(reviewersJson, task.business_id, ['user']);
    await applyMemberDisplayName(historyJson, task.business_id, ['actor', 'target']);
    return successResponse(res, {
      task: (await isClientUser(task, req.user.id)) ? serializeTaskForClient(wfTaskJson) : wfTaskJson,
      reviewers: reviewersJson,
      history: historyJson,
    });
  } catch (err) { next(err); }
});

module.exports = router;
