// Cue 오케스트레이터
// ─────────────────────────────────────────────────────────
// 고객 메시지 도착 시 호출되어:
//  1. 워크스페이스 cue_mode / cue_paused / conversation.cue_enabled 확인
//  2. cue_usage 월 한도 검사
//  3. 하이브리드 검색 (Pinned FAQ + KB chunks)
//  4. LLM 호출 (gpt-4.1-nano / gpt-4o-mini)
//  5. confidence + 민감 키워드 판정 → Auto/Draft 분기
//  6. Message 생성 (is_ai=true) + cue_usage 집계 + 감사 로그

const { sequelize } = require('../config/database');
const Business = require('../models/Business');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Client = require('../models/Client');
const CueUsage = require('../models/CueUsage');
const { createAuditLog } = require('../middleware/audit');
const kbService = require('./kb_service');

const MODEL_NANO = 'gpt-4.1-nano';
const MODEL_MINI = 'gpt-4o-mini';

// 비용 (1M tokens 기준, 2026-04 단가)
const PRICING = {
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 }
};

// 플랜 한도 — services/plan.js + config/plans.js 경유로 통합 (이 상수는 DEPRECATED, 제거 예정)
// 하위 호환을 위해 한 곳 남겨두되 실제 조회는 plan engine 사용
const planEngine = require('./plan');

// 민감 키워드 (감지 시 Auto 모드라도 Draft 강제)
const SENSITIVE_KEYWORDS_KO = ['환불', '계약 해지', '위약금', '소송', '변호사', '법적', '클레임', '불만'];
const SENSITIVE_KEYWORDS_EN = ['refund', 'cancel contract', 'penalty', 'lawsuit', 'legal', 'complaint', 'dispute'];

function isSensitive(text) {
  const lower = String(text || '').toLowerCase();
  for (const k of SENSITIVE_KEYWORDS_KO) if (lower.includes(k)) return true;
  for (const k of SENSITIVE_KEYWORDS_EN) if (lower.includes(k.toLowerCase())) return true;
  // 금액 100만원 이상
  if (/[1-9]\d{6,}/.test(lower.replace(/,/g, ''))) return true;
  return false;
}

// ─── 현재 월 ───
function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── 사용량 한도 검사 — plan engine 경유 ───
async function checkUsageLimit(businessId /*, plan */) {
  const ym = currentYearMonth();
  const rows = await CueUsage.findAll({ where: { business_id: businessId, year_month: ym } });
  const total = rows.reduce((s, r) => s + (r.action_count || 0), 0);
  const limit = await planEngine.getLimit(businessId, 'cue_actions_monthly');
  const effectiveLimit = limit === Infinity ? Number.MAX_SAFE_INTEGER : limit;
  return { total, limit: effectiveLimit, remaining: Math.max(0, effectiveLimit - total), over: total >= effectiveLimit };
}

// ─── 사용량 기록 (UPSERT) ───
async function recordUsage(businessId, actionType, model, inputTokens, outputTokens) {
  const ym = currentYearMonth();
  const pricing = PRICING[model] || PRICING[MODEL_NANO];
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output;

  const [row, created] = await CueUsage.findOrCreate({
    where: { business_id: businessId, year_month: ym, action_type: actionType },
    defaults: {
      action_count: 1,
      token_input: inputTokens,
      token_output: outputTokens,
      cost_usd: cost
    }
  });
  if (!created) {
    await row.update({
      action_count: (row.action_count || 0) + 1,
      token_input: (row.token_input || 0) + inputTokens,
      token_output: (row.token_output || 0) + outputTokens,
      cost_usd: Number(row.cost_usd || 0) + cost
    });
  }
  return { cost, ym };
}

// ─── LLM 호출 — 게이트웨이(services/llm.js) 로 위임 ───
//   시그니처(model, messages, opts)와 반환 형태는 그대로 둔다 — 내부 호출부 5곳 무변경.
//   재시도·타임아웃·입력상한은 이제 게이트웨이가 책임진다. 여기 남은 것은 Cue 의 폴백 문장뿐.
//   ※ 모델은 호출부가 고른 것(nano/mini)을 그대로 넘긴다 — 모델 선택 결과 1:1 보존.
const CUE_FALLBACK = '확인 후 답변드리겠습니다.';

async function callLLM(model, messages, opts = {}) {
  const { callLLM: gatewayCall } = require('./llm');
  const r = await gatewayCall({
    purpose: opts.purpose || 'cue_reply',
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens || 400,
    fallback: CUE_FALLBACK,
  });
  return {
    content: r.content,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    fallback: r.fallback,
  };
}

// ─── 프롬프트 구성 ───
function buildSystemPrompt(business, searchResults) {
  const brandName = business.brand_name || business.name || 'Workspace';
  const brandToneEn = business.default_language === 'en';
  const lang = brandToneEn ? 'English' : 'Korean';

  let sources = '';
  if (searchResults?.pinned_faqs?.length) {
    sources += '\n\n## Pinned FAQ (prioritize these)\n';
    for (const f of searchResults.pinned_faqs.slice(0, 3)) {
      sources += `Q: ${f.question}\nA: ${f.answer}\n---\n`;
    }
  }
  if (searchResults?.kb_chunks?.length) {
    sources += '\n## Knowledge base snippets\n';
    for (const c of searchResults.kb_chunks.slice(0, 5)) {
      sources += `[${c.document_title}${c.section_title ? ' - ' + c.section_title : ''}]\n${c.snippet}\n---\n`;
    }
  }

  return `You are Cue, an AI teammate at "${brandName}". Reply in ${lang} in first-person plural when representing the workspace (e.g. "저희 ${brandName}에서는..." or "At ${brandName}, we...").

Rules:
1. NEVER say "I am an AI" or similar self-negations
2. Be concise (2-4 sentences max unless asked for detail)
3. If the provided sources contain the answer, use them verbatim and cite briefly
4. If sources don't cover the question, say something like "확인 후 답변드리겠습니다" / "Let me check and get back to you"
5. Be warm and professional, matching ${brandName}'s tone
${sources}`;
}

// ─── 메인: 고객 메시지에 Cue 응답 생성 ───
async function respondToMessage({ message, conversation, business, client }) {
  // 1. Cue 활성 확인
  if (business.cue_paused) return { skipped: true, reason: 'cue_paused_globally' };
  if (!conversation.cue_enabled) return { skipped: true, reason: 'cue_disabled_for_conversation' };

  // 2. suppressed 확인
  if (conversation.cue_suppressed_until && new Date(conversation.cue_suppressed_until) > new Date()) {
    return { skipped: true, reason: 'cue_suppressed' };
  }

  // 3. 월 한도 확인
  const usage = await checkUsageLimit(business.id);
  if (usage.over) {
    return { skipped: true, reason: 'usage_limit_exceeded', usage };
  }

  // 4. 전방위 컨텍스트 빌드 (사이클 G+) — KB 만이 아닌 프로젝트·대화 흐름·일정·고객 360°
  //   ★ scope 필수 — Cue 의 답변은 고객이 있는 대화방으로 나간다. 여태 scope 를 안 넘겨서
  //     스냅샷들이 business_id 만으로 긁혔고(남의 개인 일정·내부 업무·청구 내역), 그게 그대로
  //     LLM 프롬프트에 들어가 고객 답변 재료가 됐다. 질문한 사람(= 발화자)의 권한으로 격리한다.
  const { buildCueContext } = require('./cue_context');
  const { getUserScope } = require('../middleware/access_scope');
  const askerScope = message.sender_id
    ? await getUserScope(message.sender_id, business.id).catch(() => null)
    : null;
  const ctx = await buildCueContext({
    businessId: business.id,
    conversationId: conversation.id,
    projectId: conversation.project_id || null,
    clientId: conversation.client_id || (client?.id || null),
    userId: message.sender_id || null,
    query: message.content,
    businessTimezone: business.timezone,
    scope: askerScope,
  });
  const searchResults = ctx.kb || { has_results: false };

  // 5. LLM 호출 — system prompt 에 전방위 컨텍스트 + KB 결과 포함
  const systemPrompt = buildSystemPrompt(business, searchResults) + (ctx.markdown ? `\n\n# 워크스페이스 현황 (참고)\n${ctx.markdown}` : '');
  const llmModel = searchResults.has_results ? MODEL_MINI : MODEL_NANO;
  const llmResult = await callLLM(llmModel, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message.content }
  ], { temperature: 0.3, maxTokens: 400 });

  // 6. Confidence 판정 (간단: 검색 결과 점수 최대값 기반)
  const topFaqScore = searchResults.pinned_faqs?.[0]?.score || 0;
  const topChunkScore = searchResults.kb_chunks?.[0]?.score || 0;
  const confidence = Math.max(topFaqScore, topChunkScore);

  // 7. 소스 결정
  let aiSource = 'general';
  if (topFaqScore >= 0.4) aiSource = 'pinned_faq';
  else if (topChunkScore >= 0.4) aiSource = 'kb_rag';

  // 8. 민감 키워드 감지 → 강제 Draft
  const sensitive = isSensitive(message.content) || isSensitive(llmResult.content);

  // 9. 모드 분기
  let aiModeUsed;
  if (business.cue_mode === 'draft' || sensitive) {
    aiModeUsed = 'draft';
  } else if (business.cue_mode === 'smart') {
    aiModeUsed = confidence >= 0.5 ? 'auto' : 'draft';
  } else {
    aiModeUsed = 'auto';
  }

  // 10. 사용량 기록
  await recordUsage(business.id, 'answer', llmModel, llmResult.input_tokens, llmResult.output_tokens);

  // 11. 메시지 저장
  const aiSources = [
    ...(searchResults.pinned_faqs || []).slice(0, 3).map(f => ({
      type: 'pinned_faq',
      id: f.faq_id,
      title: 'Pinned FAQ',
      snippet: String(f.question).slice(0, 120),
      score: f.score
    })),
    ...(searchResults.kb_chunks || []).slice(0, 3).map(c => ({
      type: 'kb_chunk',
      id: c.chunk_id,
      title: c.document_title,
      section: c.section_title,
      snippet: c.snippet,
      score: c.score
    }))
  ];

  // 번역 hook — Conversation.translation_enabled 면 Cue 응답도 양 언어로 캐시
  // (사용자 메시지와 일관성 유지). draft 모드도 동일 처리.
  let cueTranslationFields = {};
  if (conversation.translation_enabled && Array.isArray(conversation.translation_languages)) {
    try {
      const { translateForBilingual } = require('./translation_service');
      const tr = await translateForBilingual(llmResult.content, conversation.translation_languages, conversation.business_id);
      if (!tr.fallback && tr.translations) {
        cueTranslationFields = { translations: tr.translations, detected_language: tr.detected_language };
      }
    } catch (e) { /* silent — 번역 실패해도 응답은 정상 발송 */ }
  }

  const cueMsg = await Message.create({
    conversation_id: conversation.id,
    sender_id: business.cue_user_id,
    content: llmResult.content,
    kind: 'text',
    is_ai: true,
    ai_confidence: Number(confidence.toFixed(3)),
    ai_source: aiSource,
    ai_sources: aiSources,
    ai_model: llmModel,
    ai_mode_used: aiModeUsed,
    ai_draft_approved: aiModeUsed === 'draft' ? null : true,
    is_internal: false,
    ...cueTranslationFields
  });

  await conversation.update({ last_message_at: new Date() });

  try {
    await createAuditLog({
      userId: business.cue_user_id,
      businessId: business.id,
      action: 'cue.message',
      targetType: 'Message',
      targetId: cueMsg.id,
      newValue: {
        mode: aiModeUsed,
        source: aiSource,
        confidence,
        model: llmModel,
        sensitive
      }
    });
  } catch (e) { /* audit failure non-fatal */ }

  return {
    skipped: false,
    message: cueMsg,
    confidence,
    mode: aiModeUsed,
    source: aiSource,
    sensitive,
    fallback: llmResult.fallback
  };
}

// ─── 고객 요약 생성 ───
async function generateClientSummary(clientId) {
  const client = await Client.findByPk(clientId);
  if (!client) throw new Error('Client not found');

  const business = await Business.findByPk(client.business_id);
  if (!business || business.cue_paused) return null;

  const usage = await checkUsageLimit(business.id);
  if (usage.over) return null;

  // 최근 40개 메시지 로드
  const conversations = await Conversation.findAll({
    where: { client_id: clientId, business_id: client.business_id }
  });
  const convIds = conversations.map(c => c.id);
  if (!convIds.length) return null;

  const messages = await Message.findAll({
    where: {
      conversation_id: convIds,
      is_deleted: false,
      is_internal: false
    },
    order: [['created_at', 'DESC']],
    limit: 40
  });
  if (!messages.length) return null;

  const historyText = messages.reverse()
    .map(m => `${m.is_ai ? 'Cue' : 'User'}: ${m.content}`)
    .join('\n')
    .slice(0, 6000);

  const result = await callLLM(MODEL_MINI, [
    {
      role: 'system',
      content: `You summarize a customer conversation in 3-5 short bullets. Format:
• Main interest: ...
• Pending issue: ...
• Next action: ...
Respond in ${business.default_language === 'en' ? 'English' : 'Korean'}.`
    },
    { role: 'user', content: historyText }
  ], { temperature: 0.2, maxTokens: 300 });

  await recordUsage(business.id, 'summary', MODEL_MINI, result.input_tokens, result.output_tokens);

  await client.update({
    summary: result.content,
    summary_updated_at: new Date(),
    summary_manual: false
  });

  return result.content;
}

// ─── 문서 초안 생성 (Q docs D-3) ───
// 사용자 prompt + 고객·워크스페이스 컨텍스트 → AI 가 HTML 본문 생성.
// gpt-4o-mini 사용. CueUsage 'docs_generate' 카운터 증가.
async function generateDocumentDraft(businessId, { systemPrompt, userPrompt, maxTokens = 2500 }) {
  const usage = await checkUsageLimit(businessId);
  if (usage.over) {
    return { error: 'usage_limit_exceeded', usage };
  }
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const result = await callLLM(MODEL_MINI, messages, { temperature: 0.4, maxTokens });
  if (result.fallback) {
    return { error: 'llm_unavailable', fallback: true };
  }
  await recordUsage(businessId, 'docs_generate', MODEL_MINI, result.input_tokens, result.output_tokens);
  const newUsage = await checkUsageLimit(businessId);
  return {
    content: result.content,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    usage: newUsage,
  };
}

// ─── Q Mail M3-C — 이메일 답장 초안 (gpt-4o-mini, CueUsage 'email_reply') ───
// 마지막 inbound 메일 + 비즈니스 컨텍스트로 답장 본문 초안 생성. 사실 날조 금지 프롬프트.
async function generateEmailReplyDraft(businessId, { businessName, subject, latestInboundText, language = 'ko', faqContext = null }) {
  const usage = await checkUsageLimit(businessId);
  if (usage.over) return { error: 'usage_limit_exceeded', usage };
  const lang = language === 'en' ? 'English' : 'Korean';
  let systemPrompt = `You are an assistant drafting a professional email reply on behalf of "${businessName || 'our team'}". `
    + `Write a concise, polite reply in ${lang}. Only use information present in the incoming email`
    + (faqContext ? ` or in the registered FAQ answers below` : '') + `; `
    + `do NOT invent facts, prices, dates, or commitments. If something must be confirmed, say it will be checked and followed up. `
    + `Output ONLY the reply body text — no subject line, no greeting placeholder like [Name], no signature.`;
  // M4 — 등록 FAQ 답변을 권위 있는 근거로 주입 (정확한 사실. 질문과 무관하면 사용 X — 날조 금지 유지)
  if (faqContext) {
    systemPrompt += `\n\nRegistered FAQ answers (authoritative — base your reply on the matching one if the incoming email asks about it):\n${faqContext}`;
  }
  const userPrompt = `Incoming email${subject ? ` (subject: ${subject})` : ''}:\n\n${(latestInboundText || '').slice(0, 4000)}\n\nDraft a reply body.`;
  const result = await callLLM(MODEL_MINI, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.4, maxTokens: 600 });
  if (result.fallback) return { error: 'llm_unavailable', fallback: true };
  await recordUsage(businessId, 'email_reply', MODEL_MINI, result.input_tokens, result.output_tokens);
  return { content: result.content, usage: await checkUsageLimit(businessId) };
}

// N+87 Phase C — 메일 스레드 AI 요약. on-demand. 긴 스레드를 3~5줄 핵심으로.
//   사실만 요약(날조 금지), 결정·요청·다음 액션 위주. 워크스페이스 언어.
async function summarizeThread(businessId, { subject, threadText, language = 'ko' }) {
  const usage = await checkUsageLimit(businessId);
  if (usage.over) return { error: 'usage_limit_exceeded', usage };
  const lang = language === 'en' ? 'English' : 'Korean';
  const systemPrompt = `You summarize an email thread for the team. Write in ${lang}, 3-5 short bullet lines. `
    + `Capture only what's in the thread: the customer's request/situation, key decisions or commitments, and the next action needed. `
    + `Do NOT invent facts, prices, or dates. No greeting, no preamble — just the bullets (each line starts with "- ").`;
  const userPrompt = `Email thread${subject ? ` (subject: ${subject})` : ''}:\n\n${(threadText || '').slice(0, 6000)}\n\nSummarize.`;
  const result = await callLLM(MODEL_MINI, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ], { temperature: 0.3, maxTokens: 400 });
  if (result.fallback) return { error: 'llm_unavailable', fallback: true };
  await recordUsage(businessId, 'thread_summary', MODEL_MINI, result.input_tokens, result.output_tokens);
  return { content: (result.content || '').trim(), usage: await checkUsageLimit(businessId) };
}

module.exports = {
  respondToMessage,
  generateClientSummary,
  generateDocumentDraft,
  generateEmailReplyDraft,
  summarizeThread,
  checkUsageLimit,
  recordUsage,
  isSensitive,
  buildSystemPrompt,
  PRICING
};
