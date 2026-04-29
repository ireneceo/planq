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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
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

// ─── LLM 호출 ───
async function callLLM(model, messages, opts = {}) {
  if (!OPENAI_API_KEY) {
    // 폴백: 자료 기반 고정 응답
    return {
      content: '확인 후 답변드리겠습니다.',
      input_tokens: 0,
      output_tokens: 0,
      fallback: true
    };
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens || 400
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.warn('[cue_orchestrator] LLM error', r.status, err.slice(0, 200));
      return { content: '확인 후 답변드리겠습니다.', input_tokens: 0, output_tokens: 0, fallback: true };
    }
    const data = await r.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
      fallback: false
    };
  } catch (err) {
    console.warn('[cue_orchestrator] LLM exception', err.message);
    return { content: '확인 후 답변드리겠습니다.', input_tokens: 0, output_tokens: 0, fallback: true };
  }
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
  const { buildCueContext } = require('./cue_context');
  const ctx = await buildCueContext({
    businessId: business.id,
    conversationId: conversation.id,
    projectId: conversation.project_id || null,
    clientId: conversation.client_id || (client?.id || null),
    query: message.content,
    businessTimezone: business.timezone,
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
      const tr = await translateForBilingual(llmResult.content, conversation.translation_languages);
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

module.exports = {
  respondToMessage,
  generateClientSummary,
  generateDocumentDraft,
  checkUsageLimit,
  recordUsage,
  isSensitive,
  buildSystemPrompt,
  PRICING
};
