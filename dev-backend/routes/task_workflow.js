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
// Body: { note?: string, body?: string }
//   ★ `body` 는 **제출 시점의 결과물 본문**이다. 화면이 자동저장을 기다리지 않고 제출해도
//     마지막 타이핑이 박제본에서 빠지지 않게 같이 받아 한 트랜잭션에 쓴다.
// ─────────────────────────────────────────────
router.post('/:id/submit-review', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
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
// POST /api/tasks/:id/hold — 업무 보류 (#206)
//   body: { reason?: string }  권한: 담당자 / 작성자 / owner / admin
// ─────────────────────────────────────────────
router.post('/:id/hold', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.hold(task, actorFrom(req), { reason: req.body?.reason });
    return sendResult(res, result, (t) => successResponse(res, t.toJSON()));
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/resume — 보류/외부컨펌 해제 (#206)
//   on_hold → hold_prev_status 복귀 / external_review → in_progress
// ─────────────────────────────────────────────
router.post('/:id/resume', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const result = await actions.resume(task, actorFrom(req));
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
// GET /api/tasks/:id/deliverable-versions — 회차별 결과물 이력 (#271·#307)
//   결과물이 tasks.body 한 칸이라 다시 제출하면 이전 것이 덮이던 것 → 제출 시점마다 박제한 이력.
//   권한은 업무 상세와 같다(loadTaskOrFail 이 접근 검사를 이미 지난다).
// ─────────────────────────────────────────────
router.get('/:id/deliverable-versions', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    // ★ 2026-08-25 격리 결함 수정 — 옛 주석은 "loadTaskOrFail 이 격리를 끝냈다" 고 했으나 **사실이 아니었다.**
    //   그 함수는 `Task.findByPk` 만 한다(이 파일 상단). 다른 라우트는 행동 계층(actions.*)이 내부에서
    //   권한을 보지만 이 라우트는 읽기 전용이라 행동 계층을 거치지 않아 **아무 검사도 없이 통과했다.**
    //   실측: 타 워크스페이스 task 의 결과물 본문이 200 으로 반환됐다(같은 task 에 /workflow 는 403).
    //   이 표는 task_id 로만 매여 있어 where 에 business_id 를 넣을 자리가 없다 → /workflow 와 같은 술어를 부른다.
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);

    const { TaskDeliverableVersion } = require('../models');
    // 목록에 본문을 담지 않는다 — 회차가 쌓이면 응답이 수 MB 가 된다(포스트 이력과 같은 규칙,
    //   routes/post_revisions.js). 본문은 아래 단건 조회로 그 회차를 열 때만 가져온다.
    const rows = await TaskDeliverableVersion.findAll({
      where: { task_id: task.id },
      attributes: ['id', 'round', 'note', 'attachment_ids', 'submitted_by', 'created_at',
        [require('sequelize').fn('CHAR_LENGTH', require('sequelize').col('body')), 'body_len']],
      include: [{ model: User, as: 'submitter', attributes: ['id', 'name', 'name_localized'], required: false }],
      order: [['round', 'DESC'], ['id', 'DESC']],
    });

    // 회차별 결과(승인/수정요청) — 사용자가 알고 싶은 건 "무엇이 반려된 버전인가" 다.
    //   approve·revision 이력은 round 를 들고 있다(task_status_history.round).
    const outcomes = await TaskStatusHistory.findAll({
      where: { task_id: task.id, event_type: ['approve', 'revision'] },
      attributes: ['event_type', 'round', 'note', 'created_at'],
      order: [['created_at', 'ASC']],
    });
    const byRound = new Map();
    for (const h of outcomes) {
      if (h.round == null) continue;
      const cur = byRound.get(h.round) || { approved: 0, revision: 0, lastNote: null, at: null };
      if (h.event_type === 'approve') cur.approved += 1;
      else { cur.revision += 1; cur.lastNote = h.note || cur.lastNote; }
      cur.at = h.created_at;
      byRound.set(h.round, cur);
    }

    const items = rows.map(r => r.toJSON());
    await applyMemberDisplayName(items, task.business_id, ['submitter']);
    return successResponse(res, {
      current_round: task.review_round ?? null,
      versions: items.map(j => {
        const o = byRound.get(j.round);
        return {
          id: j.id,
          round: j.round,
          note: j.note,
          attachment_ids: Array.isArray(j.attachment_ids) ? j.attachment_ids : [],
          // 본문 유무 — #271 이전 회차는 스냅샷이 없다. 화면이 "고장" 으로 보이지 않게 구분해 준다.
          has_body: Number(j.body_len || 0) > 0,
          body_len: Number(j.body_len || 0),
          outcome: o ? (o.revision > 0 ? 'revision' : (o.approved > 0 ? 'approved' : 'pending')) : 'pending',
          outcome_note: o ? o.lastNote : null,
          submitted_at: j.created_at,
          submitter: j.submitter ? { id: j.submitter.id, name: j.submitter.name } : null,
        };
      }),
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// GET /api/tasks/:id/deliverable-versions/:vid — 그 회차 결과물 본문
//   목록이 본문을 빼고 오므로, 사용자가 회차를 펼칠 때만 이걸 부른다.
// ─────────────────────────────────────────────
router.get('/:id/deliverable-versions/:vid', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);
    const { TaskDeliverableVersion } = require('../models');
    const v = await TaskDeliverableVersion.findOne({
      where: { id: req.params.vid, task_id: task.id },   // task_id 를 같이 걸어 남의 회차 조회 차단
    });
    if (!v) return errorResponse(res, 'version_not_found', 404);
    return successResponse(res, {
      id: v.id, round: v.round, body: v.body, note: v.note,
      attachment_ids: Array.isArray(v.attachment_ids) ? v.attachment_ids : [],
      submitted_at: v.created_at,
    });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/deliverable-versions/:vid/restore — 그 회차 본문을 현재 결과물로 되돌리기
//   비파괴적이다 — 되돌리기 **직전의 현재 본문을 새 회차로 먼저 박제**한 뒤 덮는다.
//   그래서 "되돌렸다가 다시 원래대로" 도 된다. (포스트 복원과 같은 계약, routes/post_revisions.js)
//   권한 = 결과물 편집 권한과 동일 (담당자 · 플랫폼관리자 · 워크스페이스 admin — routes/tasks.js FIELD_RULES.body)
// ─────────────────────────────────────────────
router.post('/:id/deliverable-versions/:vid/restore', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await canAccessTask(task, req.user.id))) return errorResponse(res, 'forbidden', 403);
    // 되돌리기 규칙(권한·비파괴 박제·트랜잭션)은 행동 계층 단일 착지점에 있다.
    //   라우트가 트랜잭션을 열면 도메인 로직이 새고, 같은 판정이 Cue 경로와 갈라진다.
    const result = await actions.restoreDeliverable(task, actorFrom(req), { versionId: req.params.vid });
    return sendResult(res, result, (d) => {
      require('../services/auditService').logAudit(req, {
        action: 'task.deliverable_restore',
        targetType: 'task',
        targetId: d.task.id,
        businessId: d.task.business_id,
        oldValue: { restored_from_round: d.restored_from_round, version_id: d.version_id },
        newValue: { title: d.task.title },
      });
      return successResponse(res, {
        id: d.task.id, body: d.task.body, restored_from_round: d.restored_from_round,
      });
    });
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
      history: historyJson,
    });
  } catch (err) { next(err); }
});

module.exports = router;
