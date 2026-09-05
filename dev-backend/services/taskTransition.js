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
const { Task, TaskReviewer, TaskStatusHistory, Business, TaskAttachment, TaskDeliverableVersion } = require('../models');
const { syncFocusOnTaskStatus } = require('./focusSync');

// 라우트(req.app.get('io'))가 없는 실행 경로(Cue·cron)에서도 broadcast 하기 위한 global ref.
// server.js 가 부팅 시 설정 (N+63 부터 notify() 가 쓰던 것과 같은 참조).
function getIO() {
  return global.__planqIo || null;
}

// CLAUDE.md §16 (b) — 데이터 변경은 반드시 broadcast. Cue 경로에서도 동일.
//
// #277 — payload 는 serializeTaskForBroadcast 를 지난다. raw toJSON() 은 사람 정보가 없어
//   프론트의 spread 병합에서 표시명이 유실·역전되는 계열 결함을 만든다.
//   호출부 13곳은 전부 await 없는 단독 문장(fire-and-forget)이라 시그니처를 async 로 바꿔도
//   그대로 둔다 — 대신 **이 함수는 절대 reject 하지 않는다**(본문 전체 try/catch).
//   직렬화가 실패하면 raw payload 로라도 반드시 emit 한다(알림이 조용히 사라지는 것이 더 나쁘다).
// 운영 #278·#282 — actorUserId 를 반드시 싣는다.
//   프론트 NotificationToaster 는 `task.actor_user_id === me` 로 **본인이 한 액션의 토스터**를 거른다.
//   이 함수만 그 값을 안 실어서 필터가 영구 무력이었고, 그래서 "내가 승인했는데 나한테 완료 알림이
//   온다"(#282)·"같은 알림이 2개"(#278) 가 났다. 액션 계층 전 전이가 이 함수를 지나므로 여기가 급소다.
async function broadcastTask(task, event = 'task:updated', actorUserId = null) {
  // ★ 본문 전체를 감싼다 — 호출부 13곳이 await 없이 부르므로(fire-and-forget) 여기서 reject 하면
  //   unhandled rejection 이 된다. getIO()·task.toJSON() 이 try 밖에 있으면 위 주석의
  //   "절대 reject 하지 않는다" 가 거짓이 된다. 부분 try/catch 로는 그 보장이 성립하지 않는다.
  try {
    const io = getIO();
    if (!io) return;
    let data;
    try {
      const { serializeTaskForBroadcast } = require('./taskBroadcast');
      data = await serializeTaskForBroadcast(task.id, task.business_id);
    } catch (e) {
      console.warn('[broadcastTask serialize]', e.message);
    }
    if (!data) data = typeof task.toJSON === 'function' ? task.toJSON() : { ...task };
    if (actorUserId != null) data = { ...data, actor_user_id: actorUserId };
    if (task.project_id) io.to(`project:${task.project_id}`).emit(event, data);
    io.to(`business:${task.business_id}`).emit(event, data);
    io.to(`business:${task.business_id}`).emit('inbox:refresh', {
      reason: 'task_transition', task_id: task.id, event,
    });
  } catch (e) { console.warn('[broadcastTask]', e.message); }
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

// #206 진입 매트릭스 — 여기가 단일 원천. PUT·액션 계층·revert-status 가 전부 이 함수를 지난다.
//   보류(on_hold)는 활성 상태 어디서든. completed/canceled 는 "닫힌 일"이라 보류 대상이 아니다.
//   외부컨펌(external_review)은 **활성 상태 어디서든** — 옛 규칙은 in_progress 에서만 열었다.
//   ★ 그 제한의 이유는 "컨펌 라운드 중 외부로 빠지면 라운드가 오염된다" 였는데, 실제로 오염시킨 것은
//     진입이 아니라 **복귀**였다: resume 이 외부컨펌을 무조건 in_progress 로 되돌려 컨펌 라운드가
//     사라졌다. 복귀를 hold_prev_status(보류가 이미 쓰는 장치)로 바꾸면 라운드가 그대로 보존되므로
//     진입을 막을 이유가 없어진다.
//   운영 #302 — "요청을 받은 상태에서 외부컨펌을 추가로 진행해야 할 일도 있어. 내가 승인하거나
//     수정요청하기 전에 고객에게 컨펌을 요청해서 기다리기를 해야 할 수 있어." 컨펌 대기 중에
//     고객 확인을 받는 것은 정상 업무 흐름이다.
const HOLD_FROM = [
  'not_started', 'waiting', 'in_progress',
  'reviewing', 'revision_requested', 'external_review',
];
const EXTERNAL_FROM = ['in_progress', 'reviewing', 'revision_requested', 'external_review'];

// 결과물 본문(tasks.body)을 **고칠 수 있는 상태**. 여기가 단일 원천이다 (2026-09-05 결과물 버전 재설계).
//   컨펌 중(reviewing)·외부 확인 중(external_review)에는 밖에서 누가 그 내용을 보고 있다 —
//   그 사이 본문이 바뀌면 **읽은 것과 승인한 것이 달라진다.**
//   완료·취소는 이미 회차로 박제된 결과라, 조용히 덮이면 버전 기록이 거짓이 된다.
//   다시 쓰려면 화면의 "수정본 작성하기(v{n+1})" 로 편집 상태로 돌아온 뒤 쓴다.
//   ★ 이 목록을 고치면 프론트 TaskDetailDrawer 의 `bodyEditable` 도 같이 고쳐야 한다
//     (게이트 술어는 서버·프론트 양쪽이 같아야 한다 — 갈라지면 화면은 열려 있는데 저장이 409 다).
const BODY_EDIT_STATUSES = ['not_started', 'waiting', 'in_progress', 'revision_requested', 'on_hold'];
function canEditBodyInStatus(status) { return BODY_EDIT_STATUSES.includes(status); }

// opts: { fromStatus, transaction }
//   fromStatus 를 넘기면 on_hold/external_review 진입 가능 여부까지 검사한다.
//   넘기지 않으면 from 검사는 건너뛴다 (호출부가 이미 상태를 확정한 경우).
async function canEnterStatus(taskId, toStatus, opts = {}) {
  const { fromStatus = null, transaction } = opts;

  if (toStatus === 'on_hold') {
    if (fromStatus && !HOLD_FROM.includes(fromStatus)) {
      return { ok: false, reason: 'cannot_hold_closed_task' };
    }
    return { ok: true };
  }
  if (toStatus === 'external_review') {
    if (fromStatus && !EXTERNAL_FROM.includes(fromStatus)) {
      return { ok: false, reason: 'external_review_from_active_only' };
    }
    return { ok: true };
  }

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
    // ── #271·#307 결과물 박제 ──
    //   결과물은 tasks.body 한 칸이라 다시 제출하면 이전 것이 덮인다. 그래서 사람들이 댓글에
    //   결과물을 붙여 왔고 무엇이 최신인지·무엇이 반려된 버전인지 알 수 없었다.
    //   ★ 제출 = 버전. 저장할 때마다 박제하면 버전이 수십 개가 되어 "무엇이 제출본인가" 가 다시 흐려진다.
    //   ★ 같은 트랜잭션 안에서 — 전이는 됐는데 버전이 없는 상태가 생기면 이력이 거짓말을 한다.
    //   ★ 첨부는 id 만 담는다(파일 복제 X). 파일이 지워지면 그 버전에서도 자연히 빠진다.
    const bodySnapshot = (bodyUpdates && bodyUpdates.body !== undefined) ? bodyUpdates.body : task.body;
    let attachmentIds = null;
    try {
      const atts = await TaskAttachment.findAll({
        where: { task_id: task.id, context: 'task' },
        attributes: ['id'], transaction: t,
      });
      attachmentIds = atts.map(a => a.id);
    } catch (e) { /* 첨부 조회 실패가 제출을 막지 않는다 — 본문 박제가 본질이다 */ }
    // ★ 회차 번호는 **박제 목록의 최대치 +1** 로 붙인다. `review_round`(컨펌 라운드 수)를 쓰면
    //   되돌리기가 만든 백업 회차(max+1)와 번호가 겹쳐 목록에 **v2 가 두 줄** 나온다
    //   (Fable 게이트 2026-09-05 실측). 같은 값을 두 공식으로 구하면 반드시 갈라진다.
    //   컨펌 라운드는 task.review_round 그대로 두고, 여기서는 목록의 번호만 정한다.
    const maxRound = await TaskDeliverableVersion.max('round', { where: { task_id: task.id }, transaction: t });
    await TaskDeliverableVersion.create({
      task_id: task.id,
      round: (Number(maxRound) || 0) + 1,
      body: bodySnapshot ?? null,
      attachment_ids: attachmentIds,
      submitted_by: actorUserId || null,
      note: note ? String(note).slice(0, 1000) : null,
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
  broadcastTask(task, 'task:updated', actorUserId);

  // CLAUDE.md §13 — status 전이 라우트는 notify 강제
  const reviewerIds = reviewers.map((r) => r.user_id).filter((id) => id && id !== actorUserId);
  if (reviewerIds.length > 0) {
    const { notifyMany } = require('../routes/notifications');
    const wsName = await workspaceName(task.business_id);
    notifyMany({
      userIds: reviewerIds,
      businessId: task.business_id,
      eventKind: 'task',
      titleSpec: { feature: 'task', action: 'task_review_request', subject: `"${task.title}"` },
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
  broadcastTask(task, 'task:updated', actorUserId);

  const reviewerIds = reviewers.map((r) => r.user_id).filter((id) => id && id !== actorUserId);
  if (reviewerIds.length > 0) {
    const { notifyMany } = require('../routes/notifications');
    const wsName = await workspaceName(task.business_id);
    notifyMany({
      userIds: reviewerIds,
      businessId: task.business_id,
      eventKind: 'task',
      titleSpec: { feature: 'task', action: 'task_review_canceled', subject: `"${task.title}"` },
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
  canEditBodyInStatus,
  BODY_EDIT_STATUSES,
  submitForReview,
  cancelReview,
  REVIEW_STATUSES,
  HOLD_FROM,
  EXTERNAL_FROM,
  workspaceName,
  taskLink,
};
