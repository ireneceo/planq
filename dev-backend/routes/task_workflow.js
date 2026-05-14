// 업무 워크플로우 액션 — 멀티 컨펌 기반
//
// 역할 구분:
//   담당자   = tasks.assignee_id
//   요청자   = tasks.request_by_user_id (또는 created_by fallback)
//   컨펌자   = task_reviewers.user_id (멀티)
//   오너     = business_members.role='owner' or platform_admin
//
// 메인 상태 전이는 setMainStatusFromReviewers() 에서 정책(all/any)에 따라 자동 계산.

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  Task, TaskReviewer, TaskStatusHistory, TaskComment,
  User, Project, BusinessMember,
} = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

async function loadTaskOrFail(taskId, res) {
  const task = await Task.findByPk(taskId);
  if (!task) {
    errorResponse(res, 'task_not_found', 404);
    return null;
  }
  return task;
}

async function canAccessTask(task, userId) {
  // 같은 business_member 이거나, 담당자/요청자/컨펌자
  if (task.assignee_id === userId) return true;
  if (task.created_by === userId) return true;
  if (task.request_by_user_id === userId) return true;
  const rev = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: userId } });
  if (rev) return true;
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  return !!bm;
}

async function isAssignee(task, userId) { return task.assignee_id === userId; }
async function isRequester(task, userId) {
  return task.request_by_user_id === userId || task.created_by === userId;
}
async function isOwner(task, userId) {
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  return bm?.role === 'owner';
}

function logHistory({ taskId, eventType, fromStatus = null, toStatus = null, actorUserId, actorRole = null, targetUserId = null, round = null, note = null, transaction }) {
  return TaskStatusHistory.create({
    task_id: taskId,
    event_type: eventType,
    from_status: fromStatus,
    to_status: toStatus,
    actor_user_id: actorUserId,
    actor_role: actorRole,
    target_user_id: targetUserId,
    round,
    note,
  }, transaction ? { transaction } : undefined);
}

function broadcast(req, task, event = 'task:updated', payload = null) {
  const io = req.app.get('io');
  if (!io) return;
  const data = payload || task.toJSON();
  if (task.project_id) io.to(`project:${task.project_id}`).emit(event, data);
  io.to(`business:${task.business_id}`).emit(event, data);
}

// ─────────────────────────────────────────────
// 알림 헬퍼 — 모든 워크플로 액션에서 재사용
// CLAUDE.md §13 박제: status 전이 라우트는 notify 호출 강제.
// 사이클 N+13 회귀 fix — 이 파일의 모든 라우트가 notify 누락 상태였음.
//   → 확인요청 보내도 reviewer 에게 알림 0
//   → 수정요청 받아도 담당자에게 알림 0
//   → 컨펌 끝나도 요청자에게 알림 0
// ─────────────────────────────────────────────
function buildTaskLink(taskId) {
  return `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${taskId}`;
}

async function workspaceName(businessId) {
  try {
    const Business = require('../models').Business;
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    return biz?.brand_name || biz?.name || null;
  } catch { return null; }
}

// 단일 user 에게 task 알림
function notifyTask({ userId, task, title, body, ctaLabel, wsName, excludeUserId }) {
  if (!userId || (excludeUserId && userId === excludeUserId)) return;
  const { notify } = require('./notifications');
  notify({
    userId, businessId: task.business_id, eventKind: 'task',
    title, body: body || `"${task.title}"`,
    link: buildTaskLink(task.id), ctaLabel: ctaLabel || '업무 보기',
    workspaceName: wsName, tag: `task:${task.id}`,
  }).catch((e) => console.warn('[notify task]', e.message));
}

// 여러 user 에게 task 알림 (자기 자신 자동 제외)
function notifyTaskMany({ userIds, task, title, body, ctaLabel, wsName, excludeUserId }) {
  const list = (userIds || []).filter((id) => id && id !== excludeUserId);
  if (list.length === 0) return;
  const { notifyMany } = require('./notifications');
  notifyMany({
    userIds: list, businessId: task.business_id, eventKind: 'task',
    title, body: body || `"${task.title}"`,
    link: buildTaskLink(task.id), ctaLabel: ctaLabel || '업무 보기',
    workspaceName: wsName, tag: `task:${task.id}`,
  }).catch((e) => console.warn('[notify task many]', e.message));
}

// 컨펌자들의 state 조합 + 정책을 보고 메인 status 재계산
// 정책 충족(전원/1명 승인) 시 자동으로 completed 전환 — done_feedback 단계 폐지
// completed/canceled 이 아니고 (reviewers 가 있는) 상태에서는 전이 가능
async function recalcStatusFromReviewers(task, transaction) {
  const reviewers = await TaskReviewer.findAll({ where: { task_id: task.id }, transaction });
  if (reviewers.length === 0) return task.status;
  if (['completed', 'canceled', 'not_started', 'waiting', 'in_progress'].includes(task.status)) return task.status;

  // 이 시점: reviewing / revision_requested 중 하나
  const hasRevision = reviewers.some((r) => r.state === 'revision');
  const approvedCount = reviewers.filter((r) => r.state === 'approved').length;
  const pendingCount = reviewers.filter((r) => r.state === 'pending').length;

  let target;
  let isPolicySatisfied = false;
  if (hasRevision) {
    target = 'revision_requested';
  } else if (task.review_policy === 'all') {
    isPolicySatisfied = approvedCount === reviewers.length;
    target = isPolicySatisfied ? 'completed' : 'reviewing';
  } else {
    // any: 1명이라도 approved 면 정책 충족 → 자동 completed
    isPolicySatisfied = approvedCount >= 1;
    target = isPolicySatisfied ? 'completed' : 'reviewing';
    if (pendingCount === reviewers.length) target = 'reviewing';
  }
  if (target !== task.status) {
    const updates = { status: target };
    if (target === 'completed' && !task.completed_at) updates.completed_at = new Date();
    if (target === 'completed') updates.progress_percent = 100;
    await task.update(updates, { transaction });
  }
  return target;
}

// ─────────────────────────────────────────────
// POST /api/tasks/:id/ack — 담당자 요청 확인완료
// ─────────────────────────────────────────────
router.post('/:id/ack', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await isAssignee(task, req.user.id))) return errorResponse(res, 'only_assignee', 403);
    if (task.source === 'manual') return errorResponse(res, 'not_required_for_manual', 400);
    if (task.request_ack_at) return errorResponse(res, 'already_acked', 400);

    const t = await sequelize.transaction();
    try {
      await task.update({
        request_ack_at: new Date(),
        status: task.status === 'not_started' ? 'waiting' : task.status,
      }, { transaction: t });
      await logHistory({
        taskId: task.id, eventType: 'ack', actorUserId: req.user.id, actorRole: 'assignee', transaction: t,
      });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    broadcast(req, task);

    // 요청자에게 알림 — 담당자가 요청 확인했음
    const wsName = await workspaceName(task.business_id);
    notifyTask({
      userId: task.request_by_user_id || task.created_by,
      task, wsName, excludeUserId: req.user.id,
      title: '담당자가 요청을 확인했습니다',
      ctaLabel: '업무 보기',
    });

    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/submit-review — 담당자 컨펌 요청 (라운드 시작)
// 요청 바디: { note?: string }
// ─────────────────────────────────────────────
router.post('/:id/submit-review', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await isAssignee(task, req.user.id))) return errorResponse(res, 'only_assignee', 403);
    if (['completed', 'canceled'].includes(task.status)) return errorResponse(res, 'task_closed', 400);

    const reviewers = await TaskReviewer.findAll({ where: { task_id: task.id } });
    if (reviewers.length === 0) return errorResponse(res, 'no_reviewers_add_first', 400);

    const t = await sequelize.transaction();
    try {
      // 모든 리뷰어 state 리셋 (새 라운드)
      await TaskReviewer.update(
        { state: 'pending', reverted_once: false, action_at: null },
        { where: { task_id: task.id }, transaction: t }
      );
      const newRound = (task.review_round || 0) + 1;
      const fromStatus = task.status;
      await task.update({ status: 'reviewing', review_round: newRound }, { transaction: t });
      await logHistory({
        taskId: task.id, eventType: 'review_submit',
        fromStatus, toStatus: 'reviewing',
        actorUserId: req.user.id, actorRole: 'assignee',
        round: newRound, note: req.body?.note || null, transaction: t,
      });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    broadcast(req, task);

    // reviewers 전체에게 검토 요청 알림
    const wsName = await workspaceName(task.business_id);
    notifyTaskMany({
      userIds: reviewers.map((r) => r.user_id),
      task, wsName, excludeUserId: req.user.id,
      title: '업무 검토 요청',
      body: `"${task.title}" 검토를 요청받았습니다`,
      ctaLabel: '검토하기',
    });

    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/cancel-review — 담당자 컨펌 요청 취소
// ─────────────────────────────────────────────
router.post('/:id/cancel-review', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await isAssignee(task, req.user.id))) return errorResponse(res, 'only_assignee', 403);
    if (task.status !== 'reviewing') return errorResponse(res, 'not_in_review', 400);

    const reviewersBeforeCancel = await TaskReviewer.findAll({
      where: { task_id: task.id }, attributes: ['user_id'],
    });

    const t = await sequelize.transaction();
    try {
      await task.update({ status: 'in_progress' }, { transaction: t });
      await TaskReviewer.update(
        { state: 'pending', action_at: null },
        { where: { task_id: task.id }, transaction: t }
      );
      await logHistory({
        taskId: task.id, eventType: 'review_cancel',
        fromStatus: 'reviewing', toStatus: 'in_progress',
        actorUserId: req.user.id, actorRole: 'assignee', transaction: t,
      });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    broadcast(req, task);

    // reviewers 에게 취소 알림 (이미 검토 화면 열어둔 사람 위해)
    const wsName = await workspaceName(task.business_id);
    notifyTaskMany({
      userIds: reviewersBeforeCancel.map((r) => r.user_id),
      task, wsName, excludeUserId: req.user.id,
      title: '검토 요청이 취소되었습니다',
      ctaLabel: '업무 보기',
    });

    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/approve
// Body: { note?: string }
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/approve', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const reviewer = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: req.user.id } });
    if (!reviewer) return errorResponse(res, 'not_a_reviewer', 403);
    if (task.status !== 'reviewing' && task.status !== 'revision_requested') return errorResponse(res, 'not_reviewing', 400);

    const t = await sequelize.transaction();
    let newStatus = task.status;
    try {
      await reviewer.update({ state: 'approved', action_at: new Date() }, { transaction: t });
      await logHistory({
        taskId: task.id, eventType: 'approve',
        actorUserId: req.user.id, actorRole: 'reviewer',
        round: task.review_round, note: req.body?.note || null, transaction: t,
      });
      // 시스템 승인 댓글 (선택 입력 있으면 생성)
      if (req.body?.note) {
        await TaskComment.create({
          task_id: task.id, user_id: req.user.id,
          content: req.body.note, visibility: reviewer.is_client ? 'shared' : 'internal',
          kind: 'system_approve',
        }, { transaction: t });
      }
      newStatus = await recalcStatusFromReviewers(task, t);
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    await task.reload();
    broadcast(req, task);

    // 라운드가 끝나 completed 로 전이됐으면 요청자에게 완료 알림.
    // 그렇지 않으면 (다른 reviewer 들이 아직 pending) 담당자에게 부분 승인 알림.
    const wsName = await workspaceName(task.business_id);
    if (task.status === 'completed') {
      notifyTask({
        userId: task.request_by_user_id || task.created_by,
        task, wsName, excludeUserId: req.user.id,
        title: '요청한 업무가 완료되었습니다',
        ctaLabel: '결과 확인',
      });
    } else {
      // 담당자에게 부분 승인 (다른 reviewer 들 대기 중)
      notifyTask({
        userId: task.assignee_id,
        task, wsName, excludeUserId: req.user.id,
        title: '컨펌자가 승인했습니다',
        body: `"${task.title}" — 다른 컨펌자 대기 중`,
        ctaLabel: '업무 보기',
      });
    }

    return successResponse(res, { task: task.toJSON(), new_status: newStatus });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/revision
// Body: { note: string (필수) }
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/revision', authenticateToken, async (req, res, next) => {
  try {
    const note = (req.body?.note || '').trim();
    if (!note) return errorResponse(res, 'note_required_for_revision', 400);

    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const reviewer = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: req.user.id } });
    if (!reviewer) return errorResponse(res, 'not_a_reviewer', 403);
    if (task.status !== 'reviewing' && task.status !== 'revision_requested') return errorResponse(res, 'not_reviewing', 400);

    const t = await sequelize.transaction();
    try {
      await reviewer.update({ state: 'revision', action_at: new Date() }, { transaction: t });
      // 수정요청은 댓글 필수 생성
      await TaskComment.create({
        task_id: task.id, user_id: req.user.id,
        content: note, visibility: reviewer.is_client ? 'shared' : 'internal',
        kind: 'system_revision',
      }, { transaction: t });
      await logHistory({
        taskId: task.id, eventType: 'revision',
        actorUserId: req.user.id, actorRole: 'reviewer',
        round: task.review_round, note, transaction: t,
      });
      await recalcStatusFromReviewers(task, t);
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    await task.reload();
    broadcast(req, task);

    // 담당자에게 수정 요청 알림 — note 첨부
    const wsName = await workspaceName(task.business_id);
    notifyTask({
      userId: task.assignee_id,
      task, wsName, excludeUserId: req.user.id,
      title: '업무 수정 요청',
      body: note.length > 140 ? note.slice(0, 140) + '…' : note,
      ctaLabel: '수정 시작',
    });

    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers/me/revert — 본인 state 되돌리기 (라운드당 1회)
// ─────────────────────────────────────────────
router.post('/:id/reviewers/me/revert', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    const reviewer = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: req.user.id } });
    if (!reviewer) return errorResponse(res, 'not_a_reviewer', 403);
    if (reviewer.state === 'pending') return errorResponse(res, 'nothing_to_revert', 400);
    if (reviewer.reverted_once) return errorResponse(res, 'already_reverted_this_round', 400);

    const t = await sequelize.transaction();
    try {
      await reviewer.update({ state: 'pending', reverted_once: true, action_at: new Date() }, { transaction: t });
      await logHistory({
        taskId: task.id, eventType: 'revert',
        actorUserId: req.user.id, actorRole: 'reviewer',
        round: task.review_round, transaction: t,
      });
      await recalcStatusFromReviewers(task, t);
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    await task.reload();
    broadcast(req, task);
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/complete — 담당자 최종 완료
// ─────────────────────────────────────────────
router.post('/:id/complete', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await isAssignee(task, req.user.id))) return errorResponse(res, 'only_assignee', 403);

    const reviewers = await TaskReviewer.findAll({ where: { task_id: task.id } });
    if (reviewers.length > 0 && task.status !== 'done_feedback') {
      return errorResponse(res, 'not_ready_for_complete', 400);
    }

    const t = await sequelize.transaction();
    try {
      const fromStatus = task.status;
      await task.update({ status: 'completed', completed_at: new Date() }, { transaction: t });
      await logHistory({
        taskId: task.id, eventType: 'completed',
        fromStatus, toStatus: 'completed',
        actorUserId: req.user.id, actorRole: 'assignee', transaction: t,
      });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    broadcast(req, task);

    // 요청자에게 완료 알림
    const wsName = await workspaceName(task.business_id);
    notifyTask({
      userId: task.request_by_user_id || task.created_by,
      task, wsName, excludeUserId: req.user.id,
      title: '요청한 업무가 완료되었습니다',
      ctaLabel: '결과 확인',
    });

    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// POST /api/tasks/:id/reviewers — 컨펌자 추가
// Body: { user_id, is_client?: boolean }
// ─────────────────────────────────────────────
router.post('/:id/reviewers', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await isAssignee(task, req.user.id)) && !(await isRequester(task, req.user.id)) && !(await isOwner(task, req.user.id))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { user_id, is_client } = req.body || {};
    if (!user_id) return errorResponse(res, 'user_id_required', 400);
    if (user_id === task.assignee_id) return errorResponse(res, 'assignee_cannot_be_reviewer', 400);

    const existing = await TaskReviewer.findOne({ where: { task_id: task.id, user_id } });
    if (existing) return errorResponse(res, 'already_reviewer', 409);

    const t = await sequelize.transaction();
    try {
      const rev = await TaskReviewer.create({
        task_id: task.id, user_id,
        is_client: !!is_client,
        added_by_user_id: req.user.id,
      }, { transaction: t });
      // 진행 중인 라운드에 추가되면 전체 리셋 (아직 안 본 사람 생긴 것)
      if (task.status === 'reviewing' || task.status === 'revision_requested') {
        await TaskReviewer.update(
          { state: 'pending', reverted_once: false, action_at: null },
          { where: { task_id: task.id }, transaction: t }
        );
        await task.update({ status: 'reviewing' }, { transaction: t });
      }
      await logHistory({
        taskId: task.id, eventType: 'reviewer_add',
        actorUserId: req.user.id, actorRole: 'assignee', targetUserId: user_id,
        note: is_client ? 'client' : 'internal', transaction: t,
      });
      await t.commit();
      const full = await TaskReviewer.findByPk(rev.id, { include: [{ model: User, as: 'user', attributes: ['id', 'name', 'name_localized'] }] });
      broadcast(req, task);

      // 새 컨펌자 본인에게 알림 — task 가 reviewing 중이면 "검토 요청", 아니면 "컨펌자로 추가됨"
      const wsName = await workspaceName(task.business_id);
      const isInActiveRound = task.status === 'reviewing' || task.status === 'revision_requested';
      notifyTask({
        userId: user_id, task, wsName, excludeUserId: req.user.id,
        title: isInActiveRound ? '업무 검토 요청' : '업무 컨펌자로 추가되었습니다',
        body: isInActiveRound ? `"${task.title}" 검토를 요청받았습니다` : `"${task.title}"`,
        ctaLabel: isInActiveRound ? '검토하기' : '업무 보기',
      });

      return successResponse(res, full.toJSON());
    } catch (e) { await t.rollback(); throw e; }
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// DELETE /api/tasks/:id/reviewers/:userId — 컨펌자 제거
// ─────────────────────────────────────────────
router.delete('/:id/reviewers/:userId', authenticateToken, async (req, res, next) => {
  try {
    const task = await loadTaskOrFail(req.params.id, res);
    if (!task) return;
    if (!(await isAssignee(task, req.user.id)) && !(await isRequester(task, req.user.id)) && !(await isOwner(task, req.user.id))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const rev = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: req.params.userId } });
    if (!rev) return errorResponse(res, 'reviewer_not_found', 404);

    const t = await sequelize.transaction();
    try {
      await rev.destroy({ transaction: t });
      // 진행 중 라운드에서 제거되면 상태 재평가
      if (task.status === 'reviewing' || task.status === 'revision_requested') {
        await recalcStatusFromReviewers(task, t);
      }
      await logHistory({
        taskId: task.id, eventType: 'reviewer_remove',
        actorUserId: req.user.id, actorRole: 'assignee', targetUserId: rev.user_id, transaction: t,
      });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    await task.reload();
    broadcast(req, task);
    return successResponse(res, { removed: true, user_id: Number(req.params.userId) });
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
    if (!(await isAssignee(task, req.user.id)) && !(await isRequester(task, req.user.id)) && !(await isOwner(task, req.user.id))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const { review_policy } = req.body || {};
    if (!['all', 'any'].includes(review_policy)) return errorResponse(res, 'invalid_policy', 400);

    const t = await sequelize.transaction();
    try {
      const fromPolicy = task.review_policy;
      await task.update({ review_policy }, { transaction: t });
      // 진행 중이면 상태 재계산 (정책 바뀌면 전이 기준 달라짐)
      if (task.status === 'reviewing' || task.status === 'revision_requested') {
        await recalcStatusFromReviewers(task, t);
      }
      await logHistory({
        taskId: task.id, eventType: 'policy_change',
        actorUserId: req.user.id, actorRole: 'assignee',
        note: `${fromPolicy} → ${review_policy}`, transaction: t,
      });
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }

    await task.reload();
    broadcast(req, task);
    return successResponse(res, task.toJSON());
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────
// GET /api/tasks/:id/workflow — 상세 (reviewers + history + comments)
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

    return successResponse(res, {
      task: task.toJSON(),
      reviewers: reviewers.map((r) => r.toJSON()),
      history: history.map((h) => h.toJSON()),
    });
  } catch (err) { next(err); }
});

module.exports = router;
