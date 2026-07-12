// 업무 상태 전이의 단일 착지점.
//
// 왜 있는가 — 여태 status 전이가 라우트마다 인라인이었고, Cue(AI)는 아예 라우트를 통과하지 않고
// `task.update({ status: 'reviewing' })` 로 직접 썼다. 그래서 사람에게만 걸린 가드(reviewer 0명이면
// reviewing 금지)를 Cue 만 우회했고, 상태 이력(TaskStatusHistory)·알림(notify)·소켓 broadcast·
// Focus 세션 정리가 전부 누락됐다 (= Cue 가 일을 끝내도 아무도 모르고 화면도 안 갱신됨).
//
// 여기를 지나면 사람이든 AI든 같은 가드·같은 부수효과를 받는다.
// P1 '행동 계층(Action Layer)' 의 첫 절단면 — 나머지 전이도 점진적으로 이 파일로 모은다.

const { sequelize } = require('../config/database');
const { Task, TaskReviewer, TaskStatusHistory, Business } = require('../models');
const { syncFocusOnTaskStatus } = require('./focusSync');

// 라우트(req.app.get('io'))가 없는 실행 경로(Cue·cron)에서도 broadcast 하기 위한 global ref.
// server.js 가 부팅 시 설정 (N+63 부터 notify() 가 쓰던 것과 같은 참조).
function getIO() {
  return global.__planqIo || null;
}

// CLAUDE.md §16 (b) — 데이터 변경은 반드시 broadcast. Cue 경로에서도 동일.
function broadcastTask(task, event = 'task:updated') {
  const io = getIO();
  if (!io) return;
  const data = task.toJSON();
  if (task.project_id) io.to(`project:${task.project_id}`).emit(event, data);
  io.to(`business:${task.business_id}`).emit(event, data);
  io.to(`business:${task.business_id}`).emit('inbox:refresh', {
    reason: 'task_transition', task_id: task.id, event,
  });
}

async function workspaceName(businessId) {
  try {
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    return biz?.brand_name || biz?.name || null;
  } catch { return null; }
}

function taskLink(taskId) {
  return `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${taskId}`;
}

// 검토 단계(reviewing / revision_requested) 진입 가드 — 컨펌자 0명이면 진입 금지.
// 사이클 N+6 에 사람 라우트(tasks.js PUT · task_workflow revert-status)에만 걸려 있던 규칙을
// 여기로 올려 Cue 를 포함한 모든 경로가 같은 함수를 지나게 한다.
const REVIEW_STATUSES = ['reviewing', 'revision_requested'];

async function canEnterStatus(taskId, toStatus, transaction) {
  if (!REVIEW_STATUSES.includes(toStatus)) return { ok: true };
  const count = await TaskReviewer.count({ where: { task_id: taskId }, transaction });
  if (count === 0) return { ok: false, reason: 'no_reviewers_assigned' };
  return { ok: true, reviewerCount: count };
}

// 담당자(사람 또는 Cue)가 결과물을 제출하고 컨펌 라운드를 시작한다.
//   actorUserId    — 실제로 행동한 주체 (Cue 실행이면 cue_user_id)
//   actingForUserId— 위임 원소유자 (Cue 가 누구 권한으로 일했는가). 사람이 직접 하면 null.
//   bodyUpdates    — status 외에 같이 커밋할 필드 (Cue 결과물 body 등)
// 반환: { ok, reason?, task, reviewerIds }
//   autoReviewer   — 컨펌자가 0명일 때 등록할 사람 { userId, isClient }. Cue 실행처럼 "결과물은 나왔는데
//                    컨펌자가 없어 아무도 승인할 수 없는" 교착을 막는다. 사람 라우트는 넘기지 않는다
//                    (사람은 컨펌자를 명시적으로 지정해야 한다 — 옛 no_reviewers_add_first 유지).
async function submitForReview({
  task, actorUserId, actorRole = 'assignee', actingForUserId = null,
  note = null, bodyUpdates = {}, autoReviewer = null,
}) {
  if (['completed', 'canceled'].includes(task.status)) {
    return { ok: false, reason: 'task_closed' };
  }

  let reviewers = await TaskReviewer.findAll({ where: { task_id: task.id } });
  if (reviewers.length === 0 && !autoReviewer) {
    return { ok: false, reason: 'no_reviewers_assigned' };
  }

  const fromStatus = task.status;
  const newRound = (task.review_round || 0) + 1;
  let autoReviewerAdded = false;

  const t = await sequelize.transaction();
  try {
    // 컨펌자 0명 + autoReviewer 지정 → 같은 트랜잭션 안에서 등록 (전이와 원자적으로)
    if (reviewers.length === 0) {
      await TaskReviewer.create({
        task_id: task.id,
        user_id: autoReviewer.userId,
        is_client: !!autoReviewer.isClient,
        state: 'pending',
        added_by_user_id: actorUserId,
      }, { transaction: t });
      autoReviewerAdded = true;
      reviewers = [{ user_id: autoReviewer.userId }];
    }
    // 새 라운드 — 모든 컨펌자 state 리셋
    await TaskReviewer.update(
      { state: 'pending', reverted_once: false, action_at: null },
      { where: { task_id: task.id }, transaction: t }
    );
    await task.update(
      { ...bodyUpdates, status: 'reviewing', review_round: newRound },
      { transaction: t }
    );
    await TaskStatusHistory.create({
      task_id: task.id,
      event_type: 'review_submit',
      from_status: fromStatus,
      to_status: 'reviewing',
      actor_user_id: actorUserId,
      actor_role: actorRole,
      round: newRound,
      note,
    }, { transaction: t });
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  // in_progress → reviewing: 담당자 Focus 세션 정리
  try { await syncFocusOnTaskStatus(task, fromStatus, 'reviewing'); }
  catch (e) { console.warn('[taskTransition focusSync]', e.message); }

  await task.reload();
  broadcastTask(task);

  // CLAUDE.md §13 — status 전이 라우트는 notify 강제
  const reviewerIds = reviewers.map((r) => r.user_id).filter((id) => id && id !== actorUserId);
  if (reviewerIds.length > 0) {
    const { notifyMany } = require('../routes/notifications');
    const wsName = await workspaceName(task.business_id);
    notifyMany({
      userIds: reviewerIds,
      businessId: task.business_id,
      eventKind: 'task',
      title: '업무 검토 요청',
      body: `"${task.title}" 검토를 요청받았습니다`,
      link: taskLink(task.id),
      ctaLabel: '검토하기',
      workspaceName: wsName,
      tag: `task:${task.id}`,
    }).catch((e) => console.warn('[taskTransition notify]', e.message));
  }

  return { ok: true, task, reviewerIds, round: newRound, actingForUserId, autoReviewerAdded };
}

// 담당자가 컨펌 요청을 취소한다 (reviewing → in_progress).
//   컨펌자 state 를 pending 으로 되돌리고, 이미 검토 화면을 연 사람들에게 취소를 알린다.
async function cancelReview({ task, actorUserId, actorRole = 'assignee' }) {
  if (task.status !== 'reviewing') return { ok: false, reason: 'not_in_review' };

  const reviewers = await TaskReviewer.findAll({
    where: { task_id: task.id }, attributes: ['user_id'],
  });

  const t = await sequelize.transaction();
  try {
    await task.update({ status: 'in_progress' }, { transaction: t });
    await TaskReviewer.update(
      { state: 'pending', action_at: null },
      { where: { task_id: task.id }, transaction: t }
    );
    await TaskStatusHistory.create({
      task_id: task.id,
      event_type: 'review_cancel',
      from_status: 'reviewing',
      to_status: 'in_progress',
      actor_user_id: actorUserId,
      actor_role: actorRole,
    }, { transaction: t });
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  // reviewing → in_progress: 담당자 Focus 세션 재시작 (focus_enabled 시)
  try { await syncFocusOnTaskStatus(task, 'reviewing', 'in_progress'); }
  catch (e) { console.warn('[taskTransition focusSync]', e.message); }

  await task.reload();
  broadcastTask(task);

  const reviewerIds = reviewers.map((r) => r.user_id).filter((id) => id && id !== actorUserId);
  if (reviewerIds.length > 0) {
    const { notifyMany } = require('../routes/notifications');
    const wsName = await workspaceName(task.business_id);
    notifyMany({
      userIds: reviewerIds,
      businessId: task.business_id,
      eventKind: 'task',
      title: '검토 요청이 취소되었습니다',
      body: `"${task.title}"`,
      link: taskLink(task.id),
      ctaLabel: '업무 보기',
      workspaceName: wsName,
      tag: `task:${task.id}`,
    }).catch((e) => console.warn('[taskTransition notify]', e.message));
  }

  return { ok: true, task, reviewerIds };
}

module.exports = {
  getIO,
  broadcastTask,
  canEnterStatus,
  submitForReview,
  cancelReview,
  REVIEW_STATUSES,
};
