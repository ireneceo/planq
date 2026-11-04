// Q helper 두뇌 — PlanQ 사용법만 답한다(워크스페이스 업무·대화·문서는 읽지 않는다).
//
// 쓰는 곳: PlanQ 안내방(services/supportRoom.js, 2026-11-04 docs/PLANQ_GUIDE_ROOM_DESIGN.md).
// /api/cue/help 의 qhelper 모드와 같은 재료(시스템 지시 SYSTEM_PROMPT_QHELPER · 분류 꼬리표 · Q위키 검색 4건 · LLM 용도 kb_answer)를 쓴다.
// /help 라우트는 SSE·도구·워크스페이스 모드가 얽혀 있어 이번엔 손대지 않았다 — 재료 쪽(cuePrompts·wikiSearch·cueQuestionAnalysis)이 한 벌이다.
//
// usageContext 는 «사용 모양» 한 덩어리 문자열(지금 단계·안 한 설정)만 받는다 — 제목·본문은 넣지 않는다.
const { callLLM, isEnabled } = require('./llm');
const { SYSTEM_PROMPT_QHELPER } = require('./cuePrompts');
const cueQA = require('./cueQuestionAnalysis');

/**
 * @param {{ question: string, history?: Array<{q:string,a:string}>, usageContext?: string }} p
 * @returns {Promise<{ ok: boolean, answer: string, cls: object, answered: boolean, topArticleId: number|null, usage: object }>}
 */
async function answerQhelper({ question, history = [], usageContext = '' }) {
  const q = String(question || '').trim().slice(0, 1000);
  if (!q || !isEnabled()) return { ok: false, answer: '', cls: {}, answered: false, topArticleId: null, usage: {} };
  const retrievalQuery = history.length ? `${history[history.length - 1].q}\n${q}` : q;
  const { wikiSources, wikiTopArticleId, docBlocks } = await require('./wikiSearch').retrieveForAnswer(retrievalQuery, { limit: 4 });

  let ctxBlock = '';
  if (usageContext) ctxBlock += `# 이 워크스페이스의 사용 상태 (안내를 맞추는 데만 쓴다 — 사용자에게 숫자를 늘어놓지 않는다)\n${usageContext}`;
  if (docBlocks.length) ctxBlock += `\n\n# 도움말 문서 (이 내용만 근거로 답변)\n${docBlocks.join('\n\n')}`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT_QHELPER + cueQA.CLASSIFY_INSTRUCTION },
    ...(ctxBlock ? [{ role: 'system', content: `[컨텍스트]\n${ctxBlock}` }] : []),
    ...history.flatMap((h) => [{ role: 'user', content: h.q }, { role: 'assistant', content: h.a }]),
    { role: 'user', content: q },
  ];
  const r = await callLLM({ purpose: 'kb_answer', temperature: 0.3, fallback: '', cacheKey: 'planq-cue-qhelper', messages });
  if (r.fallback) return { ok: false, answer: '', cls: {}, answered: false, topArticleId: null, usage: {} };
  const cls = cueQA.parseClassification(r.content);
  return {
    ok: !!cls.answer,
    answer: cls.answer,
    cls,
    answered: wikiSources.length > 0,
    topArticleId: wikiTopArticleId,
    usage: { model: r.model, input_tokens: r.input_tokens || 0, output_tokens: r.output_tokens || 0 },
  };
}

module.exports = { answerQhelper };
