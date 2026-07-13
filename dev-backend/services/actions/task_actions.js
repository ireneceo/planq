// 업무 행동 계층 (Action Layer) — 사람도 Cue 도 외부 에이전트도 **같은 문**을 지난다.
//
// 왜 있는가:
//   상태 전이가 12개 라우트에 인라인이었다. 그래서 라우트를 통과하지 않는 실행자(Cue·cron)는
//   가드(컨펌자 0명이면 검토 금지)·이력(TaskStatusHistory)·알림(notify)·소켓 broadcast·Focus 정리를
//   전부 건너뛸 수 있었다. 실제로 그랬다 — Cue 가 일을 끝내도 아무도 모르고 화면도 안 갱신됐다.
//
// 계약:
//   actor = { kind: 'user' | 'cue', userId, onBehalfOfUserId?, req? }
//     - kind      — 사람인가 AI 인가 (감사·알림 문구가 아니라 **책임 주체** 구분)
//     - userId    — 실제로 행동한 주체
//     - onBehalfOfUserId — Cue 가 누구의 권한으로 행동하는가 (위임자). 사람이면 null
//     - req       — HTTP 맥락(감사 로그의 IP)만을 위한 선택 값. 도메인 판단에 쓰지 않는다.
//
//   반환 = { ok: true, data } | { ok: false, code, http }
//     라우트는 code 를 그대로 errorResponse 에 넘긴다 — 에러 문자열도 계약이다 (프론트가 분기한다).
//
// 이 파일이 책임지지 않는 것: HTTP 파싱·응답 직렬화(고객 뷰 §8.5)·인증. 그건 라우트의 몫이다.

const { Op } = require('sequelize');
const { sequelize } = require('../../config/database');
const {
  Task, TaskReviewer, TaskStatusHistory, TaskComment, User, BusinessMember, Business,
} = require('../../models');
const { assertAssignable } = require('../../middleware/access_scope');
const { syncFocusOnTaskStatus } = require('../focusSync');
const {
  broadcastTask, canEnterStatus, submitForReview, cancelReview: cancelReviewTransition,
} = require('../taskTransition');
const { applyMemberDisplayNameOne } = require('../displayName');

const fail = (code, http = 400) => ({ ok: false, code, http });
const done = (data) => ({ ok: true, data });

// ─────────────────────────────────────────────
// 권한 — 라우트가 아니라 **여기서** 검사한다. 사람과 Cue 가 같은 문을 지나게 하는 핵심.
// ─────────────────────────────────────────────
async function isAssignee(task, userId) { return task.assignee_id === userId; }
async function isRequester(task, userId) {
  return task.request_by_user_id === userId || task.created_by === userId;
}
async function isOwner(task, userId) {
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  return bm?.role === 'owner';
}
// 컨펌자 관리(추가·제거·정책)를 할 수 있는 사람 — 담당자 / 요청자 / 오너
async function canManageReviewers(task, userId) {
  return (await isAssignee(task, userId)) || (await isRequester(task, userId)) || (await isOwner(task, userId));
}

// ─────────────────────────────────────────────
// 부수효과 헬퍼 (라우트에 흩어져 있던 것을 여기 한 곳으로)
// ─────────────────────────────────────────────
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

function taskLink(taskId) {
  return `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks?task=${taskId}`;
}

async function workspaceName(businessId) {
  try {
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    return biz?.brand_name || biz?.name || null;
  } catch { return null; }
}

// CLAUDE.md §13 — status 전이는 notify 강제. 라우트가 아니라 행동 계층이 부른다 → Cue 경로에서도 발송된다.
function notifyTask({ userId, task, title, body, ctaLabel, wsName, excludeUserId }) {
  if (!userId || (excludeUserId && userId === excludeUserId)) return;
  const { notify } = require('../../routes/notifications');
  notify({
    userId, businessId: task.business_id, eventKind: 'task',
    title, body: body || `"${task.title}"`,
    link: taskLink(task.id), ctaLabel: ctaLabel || '업무 보기',
    workspaceName: wsName, tag: `task:${task.id}`,
  }).catch((e) => console.warn('[task_actions notify]', e.message));
}

function audit(actor, entry) {
  require('../auditService').logAudit(actor?.req || null, { userId: actor?.userId || null, ...entry });
}

// 컨펌자들의 state + 정책 → 메인 status 재계산 (전이 규칙의 단일 원천).
//   정책 충족(전원/1명 승인) 시 자동 completed — done_feedback 단계는 2026-04-25 폐지.
async function recalcStatusFromReviewers(task, transaction) {
  const reviewers = await TaskReviewer.findAll({ where: { task_id: task.id }, transaction });
  if (reviewers.length === 0) return task.status;
  if (['completed', 'canceled', 'not_started', 'waiting', 'in_progress'].includes(task.status)) return task.status;

  // 이 시점: reviewing / revision_requested 중 하나
  const hasRevision = reviewers.some((r) => r.state === 'revision');
  const approvedCount = reviewers.filter((r) => r.state === 'approved').length;
  const pendingCount = reviewers.filter((r) => r.state === 'pending').length;

  let target;
  if (hasRevision) {
    target = 'revision_requested';
  } else if (task.review_policy === 'all') {
    target = approvedCount === reviewers.length ? 'completed' : 'reviewing';
  } else {
    // any: 1명이라도 승인하면 충족. 단 아무도 아직 안 봤으면 reviewing 유지.
    target = approvedCount >= 1 ? 'completed' : 'reviewing';
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
// 행동 — 담당자
// ─────────────────────────────────────────────

/** 담당자가 요청을 확인했다 (not_started → waiting) */
async function ack(task, actor) {
  if (!(await isAssignee(task, actor.userId))) return fail('only_assignee', 403);
  if (task.source === 'manual') return fail('not_required_for_manual');
  if (task.request_ack_at) return fail('already_acked');

  const t = await sequelize.transaction();
  try {
    await task.update({
      request_ack_at: new Date(),
      status: task.status === 'not_started' ? 'waiting' : task.status,
    }, { transaction: t });
    await logHistory({
      taskId: task.id, eventType: 'ack', actorUserId: actor.userId, actorRole: 'assignee', transaction: t,
    });
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  broadcastTask(task);
  notifyTask({
    userId: task.request_by_user_id || task.created_by,
    task, wsName: await workspaceName(task.business_id), excludeUserId: actor.userId,
    title: '담당자가 요청을 확인했습니다',
    ctaLabel: '업무 보기',
  });
  return done(task);
}

/** 담당자가 결과물을 제출하고 컨펌 라운드를 시작한다 */
async function submitReview(task, actor, { note = null } = {}) {
  if (!(await isAssignee(task, actor.userId))) return fail('only_assignee', 403);
  if (['completed', 'canceled'].includes(task.status)) return fail('task_closed');

  // 사람은 컨펌자를 명시적으로 지정해야 한다 (Cue 는 자동 등록 — taskTransition.autoReviewer).
  const reviewers = await TaskReviewer.count({ where: { task_id: task.id } });
  if (reviewers === 0) return fail('no_reviewers_add_first');

  const r = await submitForReview({
    task, actorUserId: actor.userId, actorRole: 'assignee',
    actingForUserId: actor.onBehalfOfUserId || null, note,
  });
  if (!r.ok) return fail(r.reason);
  return done(task);
}

/** 담당자가 컨펌 요청을 취소한다 (reviewing → in_progress) */
async function cancelReview(task, actor) {
  if (!(await isAssignee(task, actor.userId))) return fail('only_assignee', 403);
  const r = await cancelReviewTransition({ task, actorUserId: actor.userId });
  if (!r.ok) return fail(r.reason);
  return done(task);
}

/** 담당자 최종 완료 — 컨펌자가 있으면 이 문이 아니라 컨펌 라운드를 지나야 한다 */
async function complete(task, actor) {
  if (!(await isAssignee(task, actor.userId))) return fail('only_assignee', 403);

  const reviewerCount = await TaskReviewer.count({ where: { task_id: task.id } });
  // 컨펌자가 있으면 완료는 컨펌 정책 충족으로만 일어난다 (recalcStatusFromReviewers 가 자동 전이).
  //   담당자가 이 라우트로 컨펌을 건너뛸 수 없다.
  if (reviewerCount > 0) return fail('not_ready_for_complete');

  const fromStatus = task.status;
  const t = await sequelize.transaction();
  try {
    await task.update({ status: 'completed', completed_at: new Date() }, { transaction: t });
    await logHistory({
      taskId: task.id, eventType: 'completed',
      fromStatus, toStatus: 'completed',
      actorUserId: actor.userId, actorRole: 'assignee', transaction: t,
    });
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  // 완료 → 담당자 Focus 세션 종료 (안 하면 좌측 배너 "포커스 중" 이 남는다)
  await syncFocusOnTaskStatus(task, fromStatus, 'completed');
  broadcastTask(task);

  notifyTask({
    userId: task.request_by_user_id || task.created_by,
    task, wsName: await workspaceName(task.business_id), excludeUserId: actor.userId,
    title: '요청한 업무가 완료되었습니다',
    ctaLabel: '결과 확인',
  });
  return done(task);
}

// ─────────────────────────────────────────────
// 행동 — 컨펌자
// ─────────────────────────────────────────────

async function loadReviewer(task, userId) {
  return TaskReviewer.findOne({ where: { task_id: task.id, user_id: userId } });
}
function inReviewRound(task) {
  return task.status === 'reviewing' || task.status === 'revision_requested';
}

/** 컨펌자 승인 — 정책 충족 시 recalc 가 자동으로 completed 로 전이시킨다 */
async function approve(task, actor, { note = null } = {}) {
  const reviewer = await loadReviewer(task, actor.userId);
  if (!reviewer) return fail('not_a_reviewer', 403);
  if (!inReviewRound(task)) return fail('not_reviewing');

  let newStatus = task.status;
  const t = await sequelize.transaction();
  try {
    await reviewer.update({ state: 'approved', action_at: new Date() }, { transaction: t });
    await logHistory({
      taskId: task.id, eventType: 'approve',
      actorUserId: actor.userId, actorRole: 'reviewer',
      round: task.review_round, note, transaction: t,
    });
    if (note) {
      await TaskComment.create({
        task_id: task.id, user_id: actor.userId,
        content: note, visibility: reviewer.is_client ? 'shared' : 'internal',
        kind: 'system_approve',
      }, { transaction: t });
    }
    newStatus = await recalcStatusFromReviewers(task, t);
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  await task.reload();
  broadcastTask(task);

  const wsName = await workspaceName(task.business_id);
  if (task.status === 'completed') {
    notifyTask({
      userId: task.request_by_user_id || task.created_by,
      task, wsName, excludeUserId: actor.userId,
      title: '요청한 업무가 완료되었습니다', ctaLabel: '결과 확인',
    });
  } else {
    notifyTask({
      userId: task.assignee_id, task, wsName, excludeUserId: actor.userId,
      title: '컨펌자가 승인했습니다',
      body: `"${task.title}" — 다른 컨펌자 대기 중`,
      ctaLabel: '업무 보기',
    });
  }
  return done({ task, newStatus });
}

/** 컨펌자 수정 요청 — 댓글 필수. Cue 가 담당자면 수정 노트를 물고 자동 재실행된다 */
async function requestRevision(task, actor, { note } = {}) {
  const text = String(note || '').trim();
  if (!text) return fail('note_required_for_revision');

  const reviewer = await loadReviewer(task, actor.userId);
  if (!reviewer) return fail('not_a_reviewer', 403);
  if (!inReviewRound(task)) return fail('not_reviewing');

  let revisionComment = null;
  const t = await sequelize.transaction();
  try {
    await reviewer.update({ state: 'revision', action_at: new Date() }, { transaction: t });
    // 수정 요청은 댓글을 반드시 남긴다 (#112 — 이 댓글에 참고 파일을 첨부한다)
    revisionComment = await TaskComment.create({
      task_id: task.id, user_id: actor.userId,
      content: text, visibility: reviewer.is_client ? 'shared' : 'internal',
      kind: 'system_revision',
    }, { transaction: t });
    await logHistory({
      taskId: task.id, eventType: 'revision',
      actorUserId: actor.userId, actorRole: 'reviewer',
      round: task.review_round, note: text, transaction: t,
    });
    await recalcStatusFromReviewers(task, t);
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  await task.reload();
  broadcastTask(task);

  notifyTask({
    userId: task.assignee_id,
    task, wsName: await workspaceName(task.business_id), excludeUserId: actor.userId,
    title: '업무 수정 요청',
    body: text.length > 140 ? text.slice(0, 140) + '…' : text,
    ctaLabel: '수정 시작',
  });

  // Cue 가 담당자면 수정 노트를 물고 자동 재실행.
  //   triggeredBy = 수정을 요청한 컨펌자(감사용). Cue 의 실행 권한은 여전히 **업무 위임자** 기준이다
  //   (트리거한 사람의 권한으로 올라타지 못한다 — project_agent_permission_model).
  const triggeredBy = actor.userId;
  try {
    const biz = await Business.findByPk(task.business_id, { attributes: ['cue_user_id'] });
    if (biz?.cue_user_id && biz.cue_user_id === task.assignee_id && task.cue_kind) {
      const { executeForTask } = require('../cue_task_executor');
      setImmediate(() => {
        executeForTask(task.id, { revisionNote: text, triggeredBy })
          .then((r) => console.log('[cue_task_executor revision]', task.id, r.ok ? 'ok' : `skip: ${r.reason}`))
          .catch((e) => console.error('[cue_task_executor revision crash]', e.message));
      });
    }
  } catch (e) { console.warn('[task_actions revision cue check]', e.message); }

  return done({ task, revisionCommentId: revisionComment?.id || null });
}

/** 컨펌자가 자기 판단을 되돌린다 (라운드당 1회) */
async function revertReviewerState(task, actor) {
  const reviewer = await loadReviewer(task, actor.userId);
  if (!reviewer) return fail('not_a_reviewer', 403);
  if (reviewer.state === 'pending') return fail('nothing_to_revert');
  if (reviewer.reverted_once) return fail('already_reverted_this_round');

  const t = await sequelize.transaction();
  try {
    await reviewer.update({ state: 'pending', reverted_once: true, action_at: new Date() }, { transaction: t });
    await logHistory({
      taskId: task.id, eventType: 'revert',
      actorUserId: actor.userId, actorRole: 'reviewer',
      round: task.review_round, transaction: t,
    });
    await recalcStatusFromReviewers(task, t);
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  await task.reload();
  broadcastTask(task);
  return done(task);
}

// ─────────────────────────────────────────────
// 행동 — 단계 되돌리기 / 컨펌자 관리
// ─────────────────────────────────────────────

/** 업무 단계를 직전 상태로 되돌린다. 담당자 / admin / owner. */
async function revertStatus(task, actor) {
  const userId = actor.userId;
  const assignee = await isAssignee(task, userId);
  const bm = await BusinessMember.findOne({ where: { business_id: task.business_id, user_id: userId } });
  const adminOrOwner = bm?.role === 'owner' || bm?.role === 'admin'
    || actor.platformRole === 'platform_admin';
  if (!assignee && !adminOrOwner) return fail('forbidden_revert — 담당자 또는 관리자만 되돌릴 수 있습니다.', 403);

  const last = await TaskStatusHistory.findOne({
    where: { task_id: task.id, from_status: { [Op.ne]: null } },
    order: [['id', 'DESC']],
  });
  if (!last || !last.from_status || last.from_status === task.status) return fail('nothing_to_revert');

  const fromStatus = task.status;
  const target = last.from_status;
  // 검토 단계 진입 가드 — 규칙은 taskTransition.canEnterStatus 단일 원천 (사람·AI 공통)
  const gate = await canEnterStatus(task.id, target);
  if (!gate.ok) return fail(gate.reason);

  const t = await sequelize.transaction();
  try {
    await task.update({ status: target }, { transaction: t });
    await logHistory({
      taskId: task.id, eventType: 'revert',
      fromStatus, toStatus: target, actorUserId: userId, transaction: t,
    });
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  try { await syncFocusOnTaskStatus(task, fromStatus, target); }
  catch (e) { console.warn('[task_actions revert focusSync]', e.message); }

  await task.reload();
  broadcastTask(task);
  if (task.assignee_id && task.assignee_id !== userId) {
    notifyTask({
      userId: task.assignee_id, task,
      title: '업무 단계가 되돌려졌어요',
      wsName: await workspaceName(task.business_id), excludeUserId: userId,
    });
  }
  return done(task);
}

/** 컨펌자 추가 — is_client 는 클라 입력을 믿지 않고 서버가 도출한다 */
async function addReviewer(task, actor, { userId } = {}) {
  if (!(await canManageReviewers(task, actor.userId))) return fail('forbidden', 403);
  if (!userId) return fail('user_id_required');
  if (userId === task.assignee_id) return fail('assignee_cannot_be_reviewer');

  const existing = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: userId } });
  if (existing) return fail('already_reviewer', 409);

  // 배정 게이트 — 멤버는 전체 / 외부 파트너는 그 프로젝트 참여자만 / 그 외(타 워크스페이스·유령)는 차단
  const chk = await assertAssignable(userId, task.business_id, task.project_id);
  if (!chk.ok) return fail(`cannot_assign:${chk.reason}`, 403);
  const isClient = chk.kind === 'client';

  let rev;
  const t = await sequelize.transaction();
  try {
    rev = await TaskReviewer.create({
      task_id: task.id, user_id: userId,
      is_client: isClient, added_by_user_id: actor.userId,
    }, { transaction: t });
    // 진행 중인 라운드에 추가되면 전체 리셋 (아직 안 본 사람이 생겼다)
    if (inReviewRound(task)) {
      await TaskReviewer.update(
        { state: 'pending', reverted_once: false, action_at: null },
        { where: { task_id: task.id }, transaction: t }
      );
      await task.update({ status: 'reviewing' }, { transaction: t });
    }
    await logHistory({
      taskId: task.id, eventType: 'reviewer_add',
      actorUserId: actor.userId, actorRole: 'assignee', targetUserId: userId,
      note: isClient ? 'client' : 'internal', transaction: t,
    });
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  const full = await TaskReviewer.findByPk(rev.id, {
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'name_localized'] }],
  });
  broadcastTask(task);

  const isActive = inReviewRound(task);
  notifyTask({
    userId, task, wsName: await workspaceName(task.business_id), excludeUserId: actor.userId,
    title: isActive ? '업무 검토 요청' : '업무 컨펌자로 추가되었습니다',
    body: isActive ? `"${task.title}" 검토를 요청받았습니다` : `"${task.title}"`,
    ctaLabel: isActive ? '검토하기' : '업무 보기',
  });

  // 컨펌자 추가 = 책임선 변경 → 감사
  audit(actor, {
    action: 'task.reviewer_add', targetType: 'task', targetId: task.id, businessId: task.business_id,
    newValue: { task_title: task.title, reviewer_user_id: userId, is_client: isClient },
  });

  const json = full.toJSON();
  await applyMemberDisplayNameOne(json, task.business_id, ['user']);
  return done(json);
}

/** 컨펌자 제거 — 진행 중 라운드면 상태 재평가 */
async function removeReviewer(task, actor, { userId } = {}) {
  if (!(await canManageReviewers(task, actor.userId))) return fail('forbidden', 403);

  const rev = await TaskReviewer.findOne({ where: { task_id: task.id, user_id: userId } });
  if (!rev) return fail('reviewer_not_found', 404);

  const t = await sequelize.transaction();
  try {
    await rev.destroy({ transaction: t });
    if (inReviewRound(task)) await recalcStatusFromReviewers(task, t);
    await logHistory({
      taskId: task.id, eventType: 'reviewer_remove',
      actorUserId: actor.userId, actorRole: 'assignee', targetUserId: rev.user_id, transaction: t,
    });
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  await task.reload();
  broadcastTask(task);
  audit(actor, {
    action: 'task.reviewer_remove', targetType: 'task', targetId: task.id, businessId: task.business_id,
    oldValue: { reviewer_user_id: rev.user_id, is_client: rev.is_client },
    newValue: { task_title: task.title },
  });
  return done({ removed: true, user_id: Number(userId) });
}

/** 컨펌 정책 변경 (all ↔ any) — 통과 기준이 바뀌므로 진행 중이면 재계산 */
async function setPolicy(task, actor, { policy } = {}) {
  if (!(await canManageReviewers(task, actor.userId))) return fail('forbidden', 403);
  if (!['all', 'any'].includes(policy)) return fail('invalid_policy');

  const fromPolicy = task.review_policy;
  const t = await sequelize.transaction();
  try {
    await task.update({ review_policy: policy }, { transaction: t });
    if (inReviewRound(task)) await recalcStatusFromReviewers(task, t);
    await logHistory({
      taskId: task.id, eventType: 'policy_change',
      actorUserId: actor.userId, actorRole: 'assignee',
      note: `${fromPolicy} → ${policy}`, transaction: t,
    });
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }

  await task.reload();
  broadcastTask(task);
  audit(actor, {
    action: 'task.policy_change', targetType: 'task', targetId: task.id, businessId: task.business_id,
    oldValue: { review_policy: fromPolicy },
    newValue: { review_policy: policy, task_title: task.title },
  });
  return done(task);
}

module.exports = {
  // 행동
  ack, submitReview, cancelReview, complete,
  approve, requestRevision, revertReviewerState,
  revertStatus, addReviewer, removeReviewer, setPolicy,
  // 전이 규칙 (다른 도메인이 상태를 재평가해야 할 때 — 단일 원천)
  recalcStatusFromReviewers,
  // 권한 술어 (읽기 라우트가 재사용)
  isAssignee, isRequester, isOwner, canManageReviewers,
};
