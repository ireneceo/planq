// 사이클 P8 — Cue 가 task assignee 로 지정되면 자동 실행 + 결과물 생성.
// 흐름:
//   1) Task 생성/업데이트 시 assignee_id === business.cue_user_id 검사
//   2) cue_kind 가 정의된 종류면 비동기 실행
//   3) cue_kind 별 처리:
//      - summarize    : cue_context_ref.meeting_id → Q Note 세션 본문 요약
//      - draft_reply  : cue_context_ref.conversation_id → 마지막 고객 메시지 답장 초안
//      - categorize   : task.title/body → 카테고리 분류 + 추천 태그
//      - research     : KB 검색 + 답변 정리
//   4) 결과 task.body (HTML) 에 저장 + status='reviewing' (사용자 컨펌 대기)
//   5) 실패 시 status='not_started' 유지 + audit 로그

const { Task, Business, Message, Conversation, KbDocument, AuditLog } = require('../models');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// LLM 호출 (gpt-4o-mini)
async function llm(system, user, maxTokens = 800) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`LLM ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  return (j.choices?.[0]?.message?.content || '').trim();
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

// ─── kind 별 실행 ──────────────────────────────────────────

async function execSummarize(task) {
  // cue_context_ref.meeting_id 로 Q Note 세션의 utterances 가져와 요약
  // Q Note 는 별도 Python — Node 백엔드에서 직접 접근 어려움.
  // 단순화: task.title/body 만으로 요약 (사용자가 본문에 회의록 붙여넣은 케이스)
  const seed = `${task.title}\n\n${(task.body || '').replace(/<[^>]+>/g, ' ').slice(0, 4000)}`;
  if (seed.trim().length < 30) {
    return { ok: false, reason: 'no_content_to_summarize' };
  }
  const out = await llm(
    '너는 회의 요약 전문가. 핵심 결정·액션 아이템·리스크를 3개 bullet 으로 요약. 한국어.',
    `다음 내용을 요약하세요.\n\n${seed}`,
    600,
  );
  return { ok: true, body: htmlWrap(`# 자동 요약\n\n${out}`) };
}

async function execDraftReply(task) {
  // cue_context_ref.conversation_id → 최근 5 고객 메시지 → 답장 초안
  const ref = task.cue_context_ref || {};
  if (!ref.conversation_id) return { ok: false, reason: 'conversation_id_required' };
  const conv = await Conversation.findByPk(ref.conversation_id);
  if (!conv || conv.business_id !== task.business_id) return { ok: false, reason: 'conversation_not_in_workspace' };

  const messages = await Message.findAll({
    where: { conversation_id: conv.id },
    order: [['created_at', 'DESC']],
    limit: 5,
    attributes: ['content', 'is_ai', 'created_at'],
  });
  if (messages.length === 0) return { ok: false, reason: 'no_messages' };
  const conversation = messages.reverse().map(m => `${m.is_ai ? 'Cue' : '고객'}: ${m.content}`).join('\n');

  const out = await llm(
    '너는 친절한 고객 응대 담당자. 정확하고 전문적이며 짧고 명확한 답장 초안. 한국어. 3~5문장.',
    `다음 대화에 대한 답장 초안을 작성하세요. 업무 지시: "${task.title}"\n\n${conversation}`,
    500,
  );
  return { ok: true, body: htmlWrap(`# 답장 초안\n\n${out}`) };
}

async function execCategorize(task) {
  // task.title + body → 카테고리 + 태그 추천
  const text = `${task.title}\n\n${(task.body || '').replace(/<[^>]+>/g, ' ').slice(0, 2000)}`;
  const out = await llm(
    '너는 분류 전문가. JSON 만 출력. 형식: {"category":"...","tags":["...","..."]}',
    `다음 업무를 분류하고 태그를 추천하세요.\n\n${text}`,
    200,
  );
  return { ok: true, body: htmlWrap(`# 자동 분류\n\n${out}`) };
}

async function execResearch(task) {
  // task.title 을 query 로 KB 검색 → LLM 정리
  const { hybridSearch } = require('./kb_service');
  const results = await hybridSearch(task.business_id, task.title, { topK: 5 }).catch(() => null);
  let context = '';
  if (results?.kb_chunks?.length) {
    context = results.kb_chunks.map(c => `- ${c.content?.slice(0, 200)}`).join('\n');
  }
  const out = await llm(
    '너는 자료 조사 전문가. KB 자료를 인용하며 답변. 출처 없으면 솔직히 "자료 부족" 명시.',
    `질문: ${task.title}\n\n참조 자료:\n${context || '(없음)'}\n\n답변을 정리하세요.`,
    600,
  );
  return { ok: true, body: htmlWrap(`# 자료 조사\n\n${out}`) };
}

// ─── 메인 entrypoint ──────────────────────────────────────

async function executeForTask(taskId) {
  const task = await Task.findByPk(taskId);
  if (!task) return { ok: false, reason: 'task_not_found' };
  if (!task.cue_kind) return { ok: false, reason: 'cue_kind_not_set' };

  // Cue user 검증 — 워크스페이스의 cue_user_id 와 assignee_id 일치
  const biz = await Business.findByPk(task.business_id, { attributes: ['id', 'cue_user_id'] });
  if (!biz?.cue_user_id || biz.cue_user_id !== task.assignee_id) {
    return { ok: false, reason: 'assignee_not_cue' };
  }

  let result;
  try {
    switch (task.cue_kind) {
      case 'summarize':   result = await execSummarize(task); break;
      case 'draft_reply': result = await execDraftReply(task); break;
      case 'categorize':  result = await execCategorize(task); break;
      case 'research':    result = await execResearch(task); break;
      default:
        return { ok: false, reason: 'unknown_kind' };
    }
  } catch (err) {
    console.error('[cue_task_executor]', task.id, err.message);
    await AuditLog.create({
      user_id: biz.cue_user_id,
      business_id: task.business_id,
      action: 'cue.task_failed',
      target_type: 'Task',
      target_id: task.id,
      new_value: { error: err.message.slice(0, 500) },
    }).catch(() => null);
    return { ok: false, reason: 'execution_failed', error: err.message };
  }

  if (!result.ok) {
    await AuditLog.create({
      user_id: biz.cue_user_id,
      business_id: task.business_id,
      action: 'cue.task_skipped',
      target_type: 'Task',
      target_id: task.id,
      new_value: { reason: result.reason },
    }).catch(() => null);
    return result;
  }

  // 결과물 task.body 에 저장 + status='reviewing' (사용자 컨펌 대기)
  await task.update({
    body: result.body,
    status: 'reviewing',
    progress_percent: 100,
  });

  await AuditLog.create({
    user_id: biz.cue_user_id,
    business_id: task.business_id,
    action: 'cue.task_executed',
    target_type: 'Task',
    target_id: task.id,
    new_value: { kind: task.cue_kind, body_len: result.body.length },
  }).catch(() => null);

  return { ok: true, task_id: task.id, status: 'reviewing' };
}

module.exports = { executeForTask };
