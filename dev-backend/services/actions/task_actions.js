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
  Task, TaskReviewer, TaskStatusHistory, TaskComment, TaskEstimation,
  User, BusinessMember, Business, Client, Project,
} = require('../../models');
const { assertAssignable, getUserScope, canAccessTask } = require('../../middleware/access_scope');
const { getMemberMenuLevels } = require('../../middleware/menu_permission');
const { syncFocusOnTaskStatus } = require('../focusSync');
const {
  broadcastTask, canEnterStatus, submitForReview, cancelReview: cancelReviewTransition, getIO,
} = require('../taskTransition');
const { applyMemberDisplayName, applyMemberDisplayNameOne } = require('../displayName');

const fail = (code, http = 400) => ({ ok: false, code, http });
const done = (data) => ({ ok: true, data });

// ─────────────────────────────────────────────
// 위임 주체 (subject) — "트리거한 사람이 아니라 **위임자** 기준"
//
//   Cue 가 무언가를 만들 때, 권한은 Cue 가 아니라 그 일을 맡긴 사람의 것이다. 위임자가 없으면
//   아무것도 만들지 못한다(fail-closed). 위임자가 또 AI 면 거부 — AI→AI 로 권한을 세탁할 수 없다.
//   생성물의 created_by 도 subject(사람)다. "누가 실제로 손을 움직였나" 는 감사 로그에 남는다.
// ─────────────────────────────────────────────
async function resolveSubject(actor) {
  if (!actor || !actor.userId) return { ok: false, code: 'actor_required', http: 403 };
  if (actor.kind !== 'cue') {
    return { ok: true, subjectId: actor.userId, platformRole: actor.platformRole || null };
  }
  if (!actor.onBehalfOfUserId) return { ok: false, code: 'cue_delegator_required', http: 403 };
  const u = await User.findByPk(actor.onBehalfOfUserId, { attributes: ['id', 'is_ai', 'platform_role'] });
  if (!u) return { ok: false, code: 'delegator_not_found', http: 403 };
  if (u.is_ai) return { ok: false, code: 'delegator_is_ai', http: 403 };
  return { ok: true, subjectId: u.id, platformRole: u.platform_role || null };
}

// 메뉴 쓰기 권한 — 여태 생성 라우트가 이걸 전혀 안 봤다 (qtask='none' 인 멤버도 업무를 만들 수 있었다).
//   row 없음 = write (열린 문화 기본값). owner/admin/platform_admin 통과. 고객(Client)은 멤버가 아니라 비적용.
async function assertMenuWrite(subjectId, businessId, menuKey, platformRole = null) {
  if (platformRole === 'platform_admin') return { ok: true };
  const levels = await getMemberMenuLevels(businessId, subjectId);
  if (!levels) return { ok: true };   // 멤버가 아님 → 고객 규칙이 따로 판단한다
  if (levels.role === 'owner' || levels.role === 'admin') return { ok: true };
  if (levels.menus[menuKey] === 'write') return { ok: true };
  return { ok: false, code: `menu_forbidden:${menuKey}`, http: 403 };
}

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
// 행동 — 생성 (D-3 2A)
//
//   여태 업무 생성이 4곳에 복제돼 있었다: POST /tasks · ai-create/confirm · registerCandidate · copy.
//   같은 실패에 다른 에러 문자열, 같은 성공에 다른 부수효과(요청자 자동 컨펌자·Cue 실행·socket·알림)가
//   경로마다 미묘하게 달랐다. 여기로 모은다 — 단 **경로별로 의도된 차이**는 opts 로 보존한다
//   (통일 유혹 금지: 프론트가 그 차이에 기대고 있다).
// ─────────────────────────────────────────────

/** 새 업무를 만든다. 사람도 Cue 도 이 문을 지난다.
 *
 * @param actor   { kind, userId, onBehalfOfUserId?, platformRole?, req? }
 * @param params  업무 필드 (라우트가 파싱해서 넘긴다)
 * @param opts    경로별 차이:
 *   transaction        — 바깥 트랜잭션에 합류 (registerCandidate 가 candidate.update 와 원자적으로 묶는다)
 *   estimation         — { value, source, model } TaskEstimation 박제 (confirm 경로)
 *   autoAiEstimate     — 예측시간 미입력 시 백그라운드 AI 추정 (POST /tasks 만)
 *   keepEstimateForCue — 요청 업무라도 담당=Cue 면 예측시간 저장 (confirm 경로 §5.7 예외)
 *   demoteCueAssignee  — 담당=Cue 면 등록자로 강등 (registerCandidate — 실행 트리거가 없는 경로)
 *   autoReviewerIsClient — 요청자 자동 컨펌자의 is_client 값 (POST 는 실값, 나머지는 false)
 *   skipCueExecute     — Cue 자동 실행 트리거 억제
 */
async function createTask(actor, params = {}, opts = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const subjectId = subj.subjectId;

  const businessId = Number(params.businessId);
  const title = String(params.title || '').trim();
  if (!businessId) return fail('business_id required');
  if (!title) return fail('title required');

  // 워크스페이스 접근권 — 멤버(owner/member/admin) 또는 고객(Client)
  const bm = await BusinessMember.findOne({ where: { user_id: subjectId, business_id: businessId } });
  let isClient = false;
  if (!bm) {
    const cl = await Client.findOne({ where: { user_id: subjectId, business_id: businessId } });
    if (!cl) return fail('forbidden', 403);
    isClient = true;
  }

  // 메뉴 권한 (신설 봉합) — 고객은 비적용(위 Client 규칙이 판단)
  if (!isClient) {
    const menu = await assertMenuWrite(subjectId, businessId, 'qtask', subj.platformRole);
    if (!menu.ok) return menu;
  }

  // source / request_by 자동 판정: 담당자 ≠ 생성자 → 내부 요청 (생성자가 요청자)
  //   담당자 미지정 → 등록자 본인 (옛 POST /tasks · confirm 동작: `assignee_id || req.user.id`).
  //   단 후보 등록 경로만 '미배정'(명시적 null)을 남길 수 있다 — 옛 registerCandidate 동작.
  let finalAssignee = params.assigneeId || (opts.allowUnassigned ? null : subjectId);
  const projectId = params.projectId || null;

  // 고객은 자기 자신에게 업무를 만들 수 없다 — 멤버에게 '요청' 만 가능
  if (isClient && Number(finalAssignee) === Number(subjectId)) {
    return fail('Clients can only request tasks to members, not assign to themselves.', 403);
  }

  // 담당자 배정 게이트 — 본인 외를 담당자로 지정할 때만. 멤버=전체 / 외부 파트너=그 프로젝트 참여자만 /
  //   그 외(타 워크스페이스·유령)=차단. 에러 문자열 `cannot_assign:` 은 계약이다 (caller 들이 regex 분기).
  if (finalAssignee && Number(finalAssignee) !== Number(subjectId)) {
    const chk = await assertAssignable(finalAssignee, businessId, projectId);
    if (!chk.ok) return fail(`cannot_assign:${chk.reason}`, 403);
  }

  // Cue 를 담당자로 승격 금지 (등록 경로 전용) — 그 경로엔 실행 트리거가 없어 아무도 안 하는 좀비 업무가 된다.
  const biz = await Business.findByPk(businessId, {
    attributes: ['cue_user_id', 'name', 'brand_name'],
    ...(opts.transaction ? { transaction: opts.transaction } : {}),
  });
  const cueUserId = biz?.cue_user_id || null;
  if (opts.demoteCueAssignee && cueUserId && Number(cueUserId) === Number(finalAssignee)) {
    finalAssignee = subjectId;   // 책임 주체는 사람
  }

  // 미배정 업무는 '요청' 이 아니다 — source·request_by 도, 자동 컨펌자도 붙지 않는다 (옛 `finalAssignee && ...` 가드)
  const isInternalRequest = !!finalAssignee && Number(finalAssignee) !== Number(subjectId);
  const assigneeIsCue = cueUserId && Number(finalAssignee) === Number(cueUserId);

  // PERMISSION_MATRIX §5.7 — 남에게 요청하는 업무의 예측시간·반복설정은 요청자가 정하지 않는다
  //   (담당자가 ack 후 본인 캐파에 맞춰 정한다). 단 담당=Cue 면 예외 — AI 에겐 캐파 협상이 없다.
  const keepEstimate = !isInternalRequest || (opts.keepEstimateForCue && assigneeIsCue);
  const effectiveEstimatedHours = keepEstimate ? (params.estimatedHours || null) : null;
  const effectiveRecurrenceRule = isInternalRequest ? null : (params.recurrenceRule || null);
  if (isInternalRequest && (params.estimatedHours || params.recurrenceRule) && !keepEstimate) {
    console.warn(`[createTask] requester=${subjectId} assignee=${finalAssignee} — 예측시간/반복설정 sanitize (책임선 분리)`);
  }

  // 그룹(워크스트림) 배치 — 그 프로젝트 소속인지 검증 (멀티테넌트·오배치 차단)
  let effectiveWorkstreamId = null;
  if (params.workstreamId != null) {
    if (!projectId) return fail('invalid_workstream');
    const { ProjectWorkstream } = require('../../models');
    const prj = await Project.findOne({ where: { id: projectId, business_id: businessId } });
    if (!prj) return fail('invalid_workstream');
    const ws = await ProjectWorkstream.findOne({ where: { id: params.workstreamId, project_id: projectId } });
    if (!ws) return fail('invalid_workstream');
    effectiveWorkstreamId = params.workstreamId;
  }

  // 정기업무 — due_date 필수, RRULE 검증, 다음 발생일 계산
  let nextOccurrenceAt = null;
  if (effectiveRecurrenceRule) {
    if (!params.dueDate) {
      return fail('due_date is required for recurring tasks (it serves as the first occurrence)');
    }
    const { RRule } = require('rrule');
    const { computeNextOccurrence } = require('../recurringTaskGenerator');
    try {
      RRule.parseString(effectiveRecurrenceRule);
    } catch (e) {
      return fail(`Invalid recurrence_rule: ${e.message}`);
    }
    const next = computeNextOccurrence(effectiveRecurrenceRule, params.dueDate, 1);
    nextOccurrenceAt = next ? next.toISOString().slice(0, 10) : null;
  }

  // ── 쓰기 (외부 트랜잭션이 있으면 합류, 없으면 자체 개설) ──
  const external = !!opts.transaction;
  const t = opts.transaction || await sequelize.transaction();
  let task;
  try {
    task = await Task.create({
      business_id: businessId,
      project_id: projectId,
      title,
      description: params.description !== undefined ? params.description : null,
      assignee_id: finalAssignee,
      status: params.status || 'not_started',
      due_date: params.dueDate || null,
      start_date: params.startDate || null,
      estimated_hours: effectiveEstimatedHours,
      category: params.category || null,
      priority: params.priority || undefined,
      source_message_id: params.sourceMessageId || null,
      conversation_id: params.conversationId || null,
      email_thread_id: params.emailThreadId || null,
      source_email_message_id: params.sourceEmailMessageId || null,
      client_id: params.clientId || null,
      qnote_session_id: params.qnoteSessionId || null,
      planned_week_start: params.plannedWeekStart || null,
      workstream_id: effectiveWorkstreamId,
      from_candidate_id: params.fromCandidateId || null,
      body: params.body || undefined,
      progress_percent: params.progressPercent || undefined,
      created_by: subjectId,
      source: isInternalRequest ? 'internal_request' : (params.source || 'manual'),
      request_by_user_id: isInternalRequest ? subjectId : null,
      cue_kind: params.cueKind || null,
      cue_context_ref: params.cueContextRef || null,
      recurrence_rule: effectiveRecurrenceRule,
      recurrence_parent_id: null,
      next_occurrence_at: nextOccurrenceAt,
    }, { transaction: t });

    // 요청 업무 — 요청자를 컨펌자로 자동 등록. 담당자가 곧장 '완료' 하지 못하고 요청자 승인을 거친다.
    //   (책임선 = 권한선 — 발주자가 결과물 컨펌 권한을 가진다)
    if (isInternalRequest) {
      await TaskReviewer.findOrCreate({
        where: { task_id: task.id, user_id: subjectId },
        defaults: {
          task_id: task.id, user_id: subjectId,
          is_client: opts.autoReviewerIsClient !== undefined ? !!opts.autoReviewerIsClient : isClient,
          added_by_user_id: subjectId,
        },
        transaction: t,
      });
    }

    // AI 추천 예측값 박제 (confirm 경로 — 이미 값을 갖고 왔다).
    //   예측시간이 §5.7 로 sanitize 됐으면(요청 업무) 예측 row 도 남기지 않는다 — 옛 동작 그대로.
    if (opts.estimation && opts.estimation.value && effectiveEstimatedHours) {
      await TaskEstimation.create({
        task_id: task.id,
        business_id: businessId,
        value: opts.estimation.value,
        source: opts.estimation.source || 'ai',
        model: opts.estimation.model || null,
      }, { transaction: t });
    }

    if (!external) await t.commit();
  } catch (e) {
    if (!external) await t.rollback();
    throw e;
  }

  // ── 부수효과 — 커밋된 뒤에만 발화한다 ──
  //    외부 트랜잭션이면 그쪽이 커밋할 때 실행되도록 afterCommit 에 건다. 안 그러면 아직 없는 업무로
  //    알림이 나가거나(롤백 시 유령 알림), 롤백된 업무를 화면에 그린다.
  const fire = () => afterCreate({
    task, businessId, projectId, subjectId, actor, isInternalRequest,
    cueUserId, biz, opts, params,
  }).catch((e) => console.warn('[createTask afterCreate]', e.message));
  if (external) t.afterCommit(fire); else fire();

  // 응답 형태는 라우트가 고른다 — 경로마다 다르다 (bare task / includes 붙은 fullJson).
  return done({ task, businessId, projectId, isInternalRequest });
}

// 생성 직후 부수효과 — socket · 알림 · 감사 · Cue 실행 · AI 예측
async function afterCreate({ task, businessId, projectId, subjectId, actor, isInternalRequest, cueUserId, biz, opts, params }) {
  const io = getIO();
  const full = await Task.findByPk(task.id, {
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
      { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
    ],
  });
  if (!full) return;   // 검증 스크립트 등에서 즉시 삭제된 경우
  const fullJson = full.toJSON();
  await applyMemberDisplayName([fullJson], businessId, ['assignee', 'requester']);

  // socket — project room + business room 양쪽 (Q Task 페이지는 business room 을 듣는다)
  if (io) {
    const payload = { ...fullJson, actor_user_id: actor.userId };
    if (projectId) io.to(`project:${projectId}`).emit('task:new', payload);
    io.to(`business:${businessId}`).emit('task:new', payload);
    io.to(`business:${businessId}`).emit('inbox:refresh', { reason: 'task_new', task_id: task.id });
    if (projectId) io.to(`project:${projectId}`).emit('inbox:refresh', { reason: 'task_new', task_id: task.id });
  }

  // 알림 — 담당자 ≠ 생성자 일 때만 (본인이 본인에게 만든 업무는 noise)
  if (isInternalRequest && task.assignee_id) {
    const { notify } = require('../../routes/notifications');
    notify({
      userId: task.assignee_id,
      businessId,
      eventKind: 'task',
      title: '새 업무가 배정되었습니다',
      body: `"${task.title}"${task.due_date ? ` · 마감 ${String(task.due_date).slice(0, 10)}` : ''}`,
      link: taskLink(task.id),
      ctaLabel: '업무 보기',
      workspaceName: biz?.brand_name || biz?.name || null,
      // 자기 액션이 자기 토스트로 돌아오지 않게 (경로마다 달랐던 시그니처를 여기서 통일)
      actorUserId: actor.userId,
      entityType: 'task',
      entityId: task.id,
      ioApp: io || null,
    }).catch((e) => console.warn('[createTask notify]', e.message));
  }

  // 감사 — 생성은 CUD 다. 여태 3개 생성 경로 모두 감사 로그가 0건이었다.
  audit(actor, {
    action: 'task.create',
    targetType: 'task',
    targetId: task.id,
    businessId,
    newValue: {
      title: task.title,
      assignee_id: task.assignee_id,
      source: task.source,
      via: actor.kind === 'cue' ? 'cue' : 'user',
    },
  });

  // 담당 = Cue → 자동 실행 (이 트리거가 없으면 "Cue 에게 시켜줘" 로 만든 업무가 아무도 안 하는 업무가 된다)
  if (!opts.skipCueExecute && cueUserId && Number(task.assignee_id) === Number(cueUserId)) {
    const { executeForTask } = require('../cue_task_executor');
    executeForTask(task.id, { triggeredBy: actor.userId })
      .then((r) => console.log('[cue_task_executor]', task.id, r.ok ? 'ok' : `skip: ${r.reason}`))
      .catch((e) => console.error('[cue_task_executor] crash', e.message));
  }

  // 자동 AI 예측 — 예측시간이 비어 있고 Cue 업무가 아닐 때만 (POST /tasks 경로)
  if (opts.autoAiEstimate && full.title && (!full.estimated_hours || Number(full.estimated_hours) === 0) && !params.cueKind) {
    setImmediate(() => aiEstimateInBackground(task.id, businessId, projectId, actor.userId).catch(() => {}));
  }
}

// 백그라운드 AI 예측 — 실패해도 업무 생성에는 영향 없다
async function aiEstimateInBackground(taskId, businessId, projectId, actorUserId) {
  const { callAiEstimate, AI_MODEL } = require('../../routes/task_estimations');
  const task = await Task.findByPk(taskId, { attributes: ['id', 'title', 'description'] });
  if (!task) return;
  const ai = await callAiEstimate(task.title, task.description || '');
  if (!ai || !ai.hours) return;
  const stillExists = await Task.findByPk(taskId, { attributes: ['id'] });
  if (!stillExists) return;   // 그 사이 삭제됨 (FK 에러 방지)

  await Task.update({ estimated_hours: ai.hours }, { where: { id: taskId } });
  await TaskEstimation.create({
    task_id: taskId, business_id: businessId, value: ai.hours, source: 'ai', model: AI_MODEL,
  });

  const io = getIO();
  if (!io) return;
  const updated = await Task.findByPk(taskId, {
    include: [
      { model: Project, attributes: ['id', 'name'], required: false },
      { model: User, as: 'assignee', attributes: ['id', 'name', 'name_localized'], required: false },
      { model: User, as: 'requester', attributes: ['id', 'name', 'name_localized'], required: false },
    ],
  });
  if (!updated) return;
  const payload = {
    ...updated.toJSON(),
    latest_estimation_source: 'ai',   // 방금 만든 row — toJSON 만으로는 이 파생 필드가 안 실린다
    actor_user_id: actorUserId,
    ai_estimate: true,
  };
  if (projectId) io.to(`project:${projectId}`).emit('task:updated', payload);
  io.to(`business:${businessId}`).emit('task:updated', payload);
  io.to(`business:${businessId}`).emit('inbox:refresh', { reason: 'task_ai_estimate', task_id: taskId });
}

/** 업무 댓글. Cue 가 담당인 업무에 댓글이 달리면 Cue 가 읽고 결과를 갱신한다. */
async function createComment(actor, task, { content, visibility } = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const subjectId = subj.subjectId;

  const text = String(content || '').trim();
  if (!text) return fail('content_required');

  const scope = await getUserScope(subjectId, task.business_id, subj.platformRole);
  if (!(await canAccessTask(subjectId, task, scope))) return fail('forbidden', 403);

  // 고객은 shared 댓글만 — 내부 논의(internal)·개인 메모(personal)는 쓸 수 없다
  const allowed = ['personal', 'internal', 'shared'];
  let finalVis = allowed.includes(visibility) ? visibility : 'shared';
  if (scope.isClient) finalVis = 'shared';

  const comment = await TaskComment.create({
    task_id: task.id,
    user_id: subjectId,
    content: text,
    visibility: finalVis,
  });

  const full = await TaskComment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
  });
  const fullJson = full.toJSON();
  await applyMemberDisplayName([fullJson], task.business_id, ['author']);

  const io = getIO();
  if (io) io.to(`task:${task.id}`).emit('comment:new', fullJson);

  // 알림 — 개인 메모(personal)는 아무에게도 안 간다
  if (finalVis !== 'personal') {
    await notifyComment({ task, comment, subjectId, actor, io }).catch((e) => console.warn('[createComment notify]', e.message));
  }

  // Cue 가 담당이고 검토 중이면 — 댓글을 읽고 결과를 갱신한 뒤 답글을 남긴다.
  //   작성자가 Cue 자신이면 실행하지 않는다 (무한 루프).
  await maybeCueRespondToComment({ task, comment, subjectId, io }).catch((e) => console.warn('[createComment cue]', e.message));

  return done(fullJson);
}

async function notifyComment({ task, comment, subjectId, actor, io }) {
  const { resolveMentions } = require('../mention_parser');
  const { notifyMany } = require('../../routes/notifications');
  const mentioned = await resolveMentions(comment.content, task.business_id, subjectId);
  const mentionedSet = new Set(mentioned);

  const biz = await Business.findByPk(task.business_id, { attributes: ['name', 'brand_name'] });
  const wsName = biz?.brand_name || biz?.name || null;
  const preview = comment.content.length > 140 ? comment.content.slice(0, 140) + '…' : comment.content;
  const link = taskLink(task.id);

  // (a) 멘션 — 별도 토글(comment_mention)
  if (mentioned.length > 0) {
    notifyMany({
      userIds: mentioned, businessId: task.business_id, eventKind: 'comment_mention',
      title: `업무 댓글에서 언급됨 — ${task.title}`,
      body: preview, link, ctaLabel: '댓글 보기', workspaceName: wsName,
      actorUserId: actor.userId, entityType: 'task', entityId: task.id, ioApp: io,
    }).catch((e) => console.warn('[notify comment_mention task]', e.message));
  }

  // (b) 일반 댓글 — 담당자 + 작성자 + 요청자 + 컨펌자 (본인·멘션됨 제외)
  const reviewers = await TaskReviewer.findAll({ where: { task_id: task.id }, attributes: ['user_id'] });
  const recipients = new Set();
  if (task.assignee_id) recipients.add(task.assignee_id);
  if (task.created_by) recipients.add(task.created_by);
  if (task.request_by_user_id) recipients.add(task.request_by_user_id);
  for (const r of reviewers) if (r.user_id) recipients.add(r.user_id);
  recipients.delete(subjectId);
  for (const m of mentionedSet) recipients.delete(m);
  if (recipients.size === 0) return;

  // 알림 제목의 작성자 이름 — 옛 코드가 이메일 앞부분을 썼다. 문구가 계약이라 그대로 재현한다.
  const author = await User.findByPk(subjectId, { attributes: ['email'] });
  const authorName = author?.email?.split('@')[0] || '누군가';
  notifyMany({
    userIds: [...recipients], businessId: task.business_id, eventKind: 'task',
    title: `${authorName} 님이 업무 댓글을 남김 — ${task.title}`,
    body: preview, link, ctaLabel: '댓글 보기', workspaceName: wsName,
    actorUserId: actor.userId, entityType: 'task', entityId: task.id, ioApp: io,
  }).catch((e) => console.warn('[notify task comment]', e.message));
}

async function maybeCueRespondToComment({ task, comment, subjectId, io }) {
  const biz = await Business.findByPk(task.business_id, { attributes: ['cue_user_id'] });
  const cueUserId = biz?.cue_user_id || null;
  const isCueAssigned = cueUserId && cueUserId === task.assignee_id && task.cue_kind;
  const authorIsNotCue = subjectId !== cueUserId;
  // 검토 중일 때만 — 아직 시작도 안 한 업무에 댓글 달았다고 Cue 가 뛰쳐나가지 않는다
  const isReviewable = task.status === 'reviewing' || task.status === 'revision_requested';
  if (!isCueAssigned || !authorIsNotCue || !isReviewable) return;

  setImmediate(async () => {
    try {
      const { executeForTask } = require('../cue_task_executor');
      const r = await executeForTask(task.id, { commentNote: comment.content, triggeredBy: comment.user_id });
      if (!r.ok) { console.log('[cue_task_executor comment]', task.id, 'skip:', r.reason); return; }

      const reply = await TaskComment.create({
        task_id: task.id, user_id: cueUserId,
        content: '댓글을 반영해 결과를 업데이트했어요. 위 본문을 확인해주세요.',
        visibility: 'shared',
      });
      const replyFull = await TaskComment.findByPk(reply.id, {
        include: [{ model: User, as: 'author', attributes: ['id', 'name', 'name_localized'] }],
      });
      const liveIo = io || getIO();
      if (liveIo && replyFull) {
        const replyJson = replyFull.toJSON();
        await applyMemberDisplayName([replyJson], task.business_id, ['author']);
        liveIo.to(`task:${task.id}`).emit('comment:new', replyJson);
      }
      console.log('[cue_task_executor comment]', task.id, 'ok');
    } catch (e) { console.error('[cue_task_executor comment crash]', e.message); }
  });
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
  // 행동 — 생성
  createTask, createComment,
  // 행동 — 전이
  ack, submitReview, cancelReview, complete,
  approve, requestRevision, revertReviewerState,
  revertStatus, addReviewer, removeReviewer, setPolicy,
  // 전이 규칙 (다른 도메인이 상태를 재평가해야 할 때 — 단일 원천)
  recalcStatusFromReviewers,
  // 권한 술어 (읽기 라우트가 재사용)
  isAssignee, isRequester, isOwner, canManageReviewers,
};
