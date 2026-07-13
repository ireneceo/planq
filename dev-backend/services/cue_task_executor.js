// 사이클 P8 — Cue 가 task assignee 로 지정되면 자동 실행 + 결과물 생성.
//
// ★ 에이전트 권한 모델 (P0) — Cue 는 "권한 없는 시스템 프로세스" 가 아니라 위임받은 팀원이다.
//   위임 주체(principal) = 업무 요청자(request_by_user_id || created_by).
//   Cue 의 유효 권한 = 그 사람의 권한(access_scope) 을 넘지 않는다. scope 를 못 구하면 실행 거부(fail-closed).
//   - 읽기: 대화방·KB 를 principal 의 권한으로만 조회 (여태 business_id 만 보고 긁어 IDOR)
//   - 쓰기: services/taskTransition.js 단일 착지점 경유 (사람과 같은 reviewer 가드·이력·알림·broadcast)
//   - 감사: audit_logs.acting_for_user_id 에 "누구 권한으로 행동했는가" 기록
//   - 재무: Cue 는 청구·결제 모델을 절대 쓰지 않는다 (Irene 확정 — scripts/guard-invariants.js 가 강제)
//
// 흐름:
//   1) Task 생성/업데이트 시 assignee_id === business.cue_user_id 검사
//   2) principal 해석 + scope 확보 (없으면 거부)
//   3) cue_kind 별 처리 (summarize / draft_reply / categorize / research)
//   4) 결과 task.body 저장 + 컨펌 라운드 시작 (status='reviewing') — taskTransition 경유
//   5) 실패 시 status 유지 + audit 로그

const { Task, Business, Message, Conversation, User, AuditLog } = require('../models');
const { getUserScope, canAccessConversation, canAccessTask, kbDocumentsListWhereByLevel } = require('../middleware/access_scope');
const { submitForReview } = require('./taskTransition');

// LLM 호출 — 게이트웨이(services/llm.js) 경유. 반환값에 token usage 포함 (cue_usage recordUsage 용).
//   이 호출부는 실패를 삼키지 않는다 — Cue 가 업무를 "했다" 고 빈 결과를 남기면 안 된다 (옛 동작: throw).
const { callLLM, isEnabled } = require('./llm');

async function llm(system, user, maxTokens = 800) {
  if (!isEnabled()) throw new Error('OPENAI_API_KEY missing');
  const r = await callLLM({
    purpose: 'cue_task',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
    fallback: '',
  });
  if (r.fallback) throw new Error('LLM 호출 실패 (게이트웨이 재시도 후에도)');
  return {
    content: (r.content || '').trim(),
    input_tokens: r.input_tokens || 0,
    output_tokens: r.output_tokens || 0,
  };
}

// HTML 으로 wrap (TipTap 호환)
function htmlWrap(text) {
  const safe = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = safe.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('');
  return paragraphs;
}

// 감사 로그 — Cue 의 모든 기록은 위임자(acting_for)를 함께 남긴다.
function audit({ task, cueUserId, actingForUserId, action, value }) {
  return AuditLog.create({
    user_id: cueUserId,
    acting_for_user_id: actingForUserId || null,
    business_id: task.business_id,
    action,
    target_type: 'Task',
    target_id: task.id,
    new_value: value || null,
  }).catch(() => null);
}

// ─── 위임 주체(principal) 해석 ────────────────────────────
// Cue 는 업무를 맡긴 사람의 권한으로 행동한다. 트리거한 사람(댓글 작성자·수정요청 컨펌자)이
// 아니라 위임자 기준 — 트리거로 권한이 커지는 escalation 을 원천 차단.
async function resolvePrincipal(task) {
  const principalId = task.request_by_user_id || task.created_by;
  if (!principalId) return { ok: false, reason: 'no_principal' };

  const user = await User.findByPk(principalId, { attributes: ['id', 'is_ai', 'platform_role'] });
  if (!user) return { ok: false, reason: 'principal_not_found' };
  if (user.is_ai) return { ok: false, reason: 'principal_is_ai' };   // AI 가 AI 에게 위임 = 권한 세탁

  // platform_role 을 넘겨야 platform_admin 위임자가 scope 를 얻는다 (BM row 가 없어도 인정).
  // 안 넘기면 isMember=false 로 계산돼 fail-closed 에 걸린다 — [[feedback_verify_platform_admin_role]]
  const scope = await getUserScope(principalId, task.business_id, user.platform_role).catch(() => null);
  if (!scope) return { ok: false, reason: 'principal_scope_unavailable' };
  if (!scope.isMember && !scope.isOwner && !scope.isAdmin && !scope.isClient && !scope.isPlatformAdmin) {
    return { ok: false, reason: 'principal_not_in_workspace' };      // 퇴사·탈퇴한 위임자
  }
  // 위임자가 그 업무 자체를 볼 수 없으면 Cue 도 못 한다
  const canSee = await canAccessTask(principalId, task, scope).catch(() => false);
  if (!canSee) return { ok: false, reason: 'principal_cannot_access_task' };

  return { ok: true, principalId, scope };
}

// ─── kind 별 실행 ──────────────────────────────────────────

function feedbackBlock(opts) {
  if (!opts) return '';
  const lines = [];
  if (opts.revisionNote) lines.push(`사용자 수정 요청: ${opts.revisionNote}`);
  if (opts.commentNote) lines.push(`사용자 추가 코멘트: ${opts.commentNote}`);
  return lines.length ? `\n\n# 이번 요청에 반영해야 할 사용자 피드백\n${lines.join('\n')}\n` : '';
}

async function execSummarize(task, ctx, opts = {}) {
  const seed = `${task.title}\n\n${(task.body || '').replace(/<[^>]+>/g, ' ').slice(0, 4000)}`;
  if (seed.trim().length < 30) {
    return { ok: false, reason: 'no_content_to_summarize' };
  }
  const r = await llm(
    '너는 회의 요약 전문가. 핵심 결정·액션 아이템·리스크를 3개 bullet 으로 요약. 한국어.',
    `다음 내용을 요약하세요.\n\n${seed}${feedbackBlock(opts)}`,
    600,
  );
  return { ok: true, body: htmlWrap(`# 자동 요약\n\n${r.content}`), input_tokens: r.input_tokens, output_tokens: r.output_tokens };
}

async function execDraftReply(task, ctx, opts = {}) {
  // cue_context_ref.conversation_id → 최근 5 고객 메시지 → 답장 초안
  const ref = task.cue_context_ref || {};
  if (!ref.conversation_id) return { ok: false, reason: 'conversation_id_required' };
  const conv = await Conversation.findByPk(ref.conversation_id);
  if (!conv || conv.business_id !== task.business_id) return { ok: false, reason: 'conversation_not_in_workspace' };

  // ★ 권한 게이트 — 위임자가 못 보는 대화방이면 Cue 도 못 읽는다.
  //   여태 business_id 만 비교해서, 그 대화방에 참여하지 않은 사람이 Cue 에게 업무를 맡기면
  //   Cue 가 남의 대화 내용을 요약해 task.body 에 적어줬다 (IDOR).
  const allowed = await canAccessConversation(ctx.principalId, conv, ctx.scope).catch(() => false);
  if (!allowed) return { ok: false, reason: 'principal_cannot_access_conversation' };

  const messages = await Message.findAll({
    where: { conversation_id: conv.id },
    order: [['created_at', 'DESC']],
    limit: 5,
    attributes: ['content', 'is_ai', 'created_at'],
  });
  if (messages.length === 0) return { ok: false, reason: 'no_messages' };
  const conversation = messages.reverse().map(m => `${m.is_ai ? 'Cue' : '고객'}: ${m.content}`).join('\n');

  const r = await llm(
    '너는 친절한 고객 응대 담당자. 정확하고 전문적이며 짧고 명확한 답장 초안. 한국어. 3~5문장.',
    `다음 대화에 대한 답장 초안을 작성하세요. 업무 지시: "${task.title}"\n\n${conversation}${feedbackBlock(opts)}`,
    500,
  );
  return { ok: true, body: htmlWrap(`# 답장 초안\n\n${r.content}`), input_tokens: r.input_tokens, output_tokens: r.output_tokens };
}

async function execCategorize(task, ctx, opts = {}) {
  const text = `${task.title}\n\n${(task.body || '').replace(/<[^>]+>/g, ' ').slice(0, 2000)}`;
  const r = await llm(
    '너는 분류 전문가. JSON 만 출력. 형식: {"category":"...","tags":["...","..."]}',
    `다음 업무를 분류하고 태그를 추천하세요.\n\n${text}${feedbackBlock(opts)}`,
    200,
  );
  return { ok: true, body: htmlWrap(`# 자동 분류\n\n${r.content}`), input_tokens: r.input_tokens, output_tokens: r.output_tokens };
}

async function execResearch(task, ctx, opts = {}) {
  const { hybridSearch } = require('./kb_service');
  // ★ KB 도 위임자 권한으로 — docWhere 로 그 사람이 볼 수 있는 문서에만 검색을 건다.
  //   (여태 워크스페이스 전체를 긁어, 참여하지 않은 프로젝트의 KB 까지 답변 재료로 들어갔다)
  const results = await hybridSearch(task.business_id, task.title, {
    limit: 5,
    docWhere: kbDocumentsListWhereByLevel(ctx.scope),
  }).catch(() => null);
  let context = '';
  if (results?.kb_chunks?.length) {
    context = results.kb_chunks.map(c => `- ${c.content?.slice(0, 200)}`).join('\n');
  }
  const r = await llm(
    '너는 자료 조사 전문가. KB 자료를 인용하며 답변. 출처 없으면 솔직히 "자료 부족" 명시.',
    `질문: ${task.title}\n\n참조 자료:\n${context || '(없음)'}\n\n답변을 정리하세요.${feedbackBlock(opts)}`,
    600,
  );
  return { ok: true, body: htmlWrap(`# 자료 조사\n\n${r.content}`), input_tokens: r.input_tokens, output_tokens: r.output_tokens };
}

// #81 — Cue 담당자인데 cue_kind 가 비어 있으면 제목/내용/연결자료로 종류 추론.
//   대부분 사용자는 cue_kind 를 모르고 그냥 Cue 를 담당자로 지정 → 옛 코드는 아무것도 안 함.
//   이제 어떤 업무를 맡겨도 Cue 가 실제로 진행(기본 research = KB 검색 + 초안 작성).
function inferCueKind(task) {
  const ref = (task.cue_context_ref && typeof task.cue_context_ref === 'object') ? task.cue_context_ref : {};
  if (ref.meeting_id) return 'summarize';
  if (ref.conversation_id) return 'draft_reply';
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  if (/(요약|정리해|회의록|summar|minutes)/.test(text)) return 'summarize';
  if (/(답장|회신|답변 초안|reply|respond|메시지 보내)/.test(text)) return 'draft_reply';
  if (/(분류|카테고리|태그|classif|categor)/.test(text)) return 'categorize';
  return 'research';   // 일반 업무 — KB 검색 + 결과물 초안
}

// ─── 메인 entrypoint ──────────────────────────────────────

async function executeForTask(taskId, opts = {}) {
  // opts.revisionNote  — revision_requested 시 사용자 피드백 (system prompt 에 포함)
  // opts.commentNote   — task 댓글에서 트리거된 경우 댓글 본문
  // opts.triggeredBy   — 이번 실행을 유발한 사람 (감사 기록용. 권한 주체가 아님 — 권한은 위임자 기준)
  const task = await Task.findByPk(taskId);
  if (!task) return { ok: false, reason: 'task_not_found' };

  // Cue user 검증 — 워크스페이스의 cue_user_id 와 assignee_id 일치
  const biz = await Business.findByPk(task.business_id, { attributes: ['id', 'cue_user_id'] });
  if (!biz?.cue_user_id || biz.cue_user_id !== task.assignee_id) {
    return { ok: false, reason: 'assignee_not_cue' };
  }
  const cueUserId = biz.cue_user_id;

  // ★ 권한 주체 확보 — 실패 시 실행 자체를 거부 (fail-closed)
  const principal = await resolvePrincipal(task);
  if (!principal.ok) {
    await audit({
      task, cueUserId, actingForUserId: null,
      action: 'cue.task_denied', value: { reason: principal.reason },
    });
    return { ok: false, reason: principal.reason };
  }
  const ctx = { principalId: principal.principalId, scope: principal.scope };

  // #81 — cue_kind 미지정이면 추론해서 진행
  if (!task.cue_kind) {
    const inferred = inferCueKind(task);
    await task.update({ cue_kind: inferred });
    task.cue_kind = inferred;
  }

  // 워크스페이스 월 Cue 한도 검사 — 초과 시 실행 skip (인박스 누적 방지)
  const cueOrch = require('./cue_orchestrator');
  try {
    const usage = await cueOrch.checkUsageLimit(biz.id);
    if (usage.over) {
      await audit({
        task, cueUserId, actingForUserId: ctx.principalId,
        action: 'cue.task_skipped_limit',
        value: { reason: 'usage_limit_exceeded', total: usage.total, limit: usage.limit },
      });
      return { ok: false, reason: 'usage_limit_exceeded', usage };
    }
  } catch { /* checkUsageLimit 실패 시 통과 (best-effort) */ }

  let result;
  try {
    switch (task.cue_kind) {
      case 'summarize':   result = await execSummarize(task, ctx, opts); break;
      case 'draft_reply': result = await execDraftReply(task, ctx, opts); break;
      case 'categorize':  result = await execCategorize(task, ctx, opts); break;
      case 'research':    result = await execResearch(task, ctx, opts); break;
      default:
        return { ok: false, reason: 'unknown_kind' };
    }
  } catch (err) {
    console.error('[cue_task_executor]', task.id, err.message);
    await audit({
      task, cueUserId, actingForUserId: ctx.principalId,
      action: 'cue.task_failed', value: { error: err.message.slice(0, 500) },
    });
    return { ok: false, reason: 'execution_failed', error: err.message };
  }

  if (!result.ok) {
    await audit({
      task, cueUserId, actingForUserId: ctx.principalId,
      action: 'cue.task_skipped', value: { reason: result.reason },
    });
    return result;
  }

  // ★ 쓰기 — 사람과 같은 문으로. taskTransition 단일 착지점.
  //   여기서 reviewer 가드·상태 이력·Focus 정리·소켓 broadcast·컨펌자 알림이 전부 붙는다.
  //   컨펌자가 0명이면 위임자를 컨펌자로 등록한다(전이와 같은 트랜잭션):
  //     Cue 는 자기 결과물을 스스로 완료 처리하지 않는다(책임 주체가 AI 가 되는 것을 차단).
  //     그렇다고 컨펌자 없이 두면 결과물이 reviewing 에 갇혀 아무도 승인할 수 없다
  //     (approve 라우트가 TaskReviewer row 를 요구 → 옛 코드의 실제 사망 지점).
  //     업무를 맡긴 사람 = 결과를 받을 사람이므로 그가 자연스러운 컨펌자다.
  const isInternal = !!(ctx.scope.isMember || ctx.scope.isOwner || ctx.scope.isAdmin || ctx.scope.isPlatformAdmin);
  const transition = await submitForReview({
    task,
    actorUserId: cueUserId,
    actorRole: 'assignee',
    actingForUserId: ctx.principalId,
    note: opts.revisionNote ? 'Cue 재작업 (수정요청 반영)' : 'Cue 자동 실행 결과',
    bodyUpdates: { body: result.body, progress_percent: 100 },
    autoReviewer: { userId: ctx.principalId, isClient: !isInternal },
  });

  if (!transition.ok) {
    await audit({
      task, cueUserId, actingForUserId: ctx.principalId,
      action: 'cue.task_transition_blocked', value: { reason: transition.reason },
    });
    return { ok: false, reason: transition.reason };
  }

  // cue_usage 기록 — task_execute 카테고리
  try {
    await cueOrch.recordUsage(biz.id, 'task_execute', 'gpt-4o-mini', result.input_tokens || 0, result.output_tokens || 0);
  } catch (e) { console.warn('[cue_task_executor] recordUsage failed', e.message); }

  if (transition.autoReviewerAdded) {
    await audit({
      task, cueUserId, actingForUserId: ctx.principalId,
      action: 'cue.reviewer_auto_added',
      value: { reason: 'no_reviewers_for_cue_result', reviewer_user_id: ctx.principalId },
    });
  }

  await audit({
    task, cueUserId, actingForUserId: ctx.principalId,
    action: 'cue.task_executed',
    value: {
      kind: task.cue_kind,
      body_len: result.body.length,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      triggered_by: opts.triggeredBy || null,
      reviewers_notified: transition.reviewerIds,
    },
  });

  return { ok: true, task_id: task.id, status: 'reviewing', acting_for: ctx.principalId };
}

module.exports = { executeForTask };
