// Cue Help — 컨텍스트 인식 도움말 LLM 챗.
// PlanQ 전체 화면에서 ⌘? / Ctrl+/ 단축키 또는 ⓘ "Cue 에게 묻기" 클릭으로 호출.
// 입력: { question, page_context }, 출력: { answer }
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const SYSTEM_PROMPT_KO = `너는 Cue, PlanQ의 AI 팀원이야. PlanQ는 B2B SaaS — 고객 채팅(Q talk) + 업무 실행(Q task) + 회의 노트(Q note) + 문서·서명(Q docs) + 청구·세금계산서(Q bill) 통합 워크스페이스.

원칙:
- 사용자가 보고 있는 페이지의 작동 원리·기능·옵션을 설명한다
- 답변은 4문장 이내, 핵심부터
- "Cue 가 답해드릴게요" 같은 군더더기 X
- 사용자 질문이 영어면 영어로, 한국어면 한국어로
- 모르는 것은 솔직히 "현재 모릅니다, 운영팀에 문의해주세요" 라고 답변
- 코드 / API 엔드포인트는 노출 X — 사용자 관점의 설명만`;

router.post('/help', authenticateToken, async (req, res, next) => {
  try {
    const { question, page_context } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return errorResponse(res, 'question_required', 400);
    }
    const q = question.trim().slice(0, 1000);

    if (!OPENAI_API_KEY) {
      return successResponse(res, {
        answer: 'AI 도움말을 위해 OpenAI 키가 필요합니다. 운영자에게 문의해주세요.',
        fallback: true,
      });
    }

    // 페이지 컨텍스트 + 사용자 활성 워크스페이스 종합
    let ctxBlock = '';
    if (page_context && typeof page_context === 'object') {
      ctxBlock += `현재 페이지: ${page_context.path || '?'}${page_context.section ? ` · 섹션: ${page_context.section}` : ''}`;
    }

    // 사이클 G+: 사용자 활성 워크스페이스의 데이터 컨텍스트도 같이 주입
    try {
      // active_business_id 가 token 에 없으므로 BusinessMember 에서 첫 워크스페이스 fallback
      let businessId = req.user.active_business_id;
      if (!businessId) {
        const { BusinessMember } = require('../models');
        const bm = await BusinessMember.findOne({
          where: { user_id: req.user.id, removed_at: null },
          order: [['id', 'ASC']],
          attributes: ['business_id'],
        });
        businessId = bm?.business_id || null;
      }
      if (businessId) {
        const { buildCueContext } = require('../services/cue_context');
        // page_context.path 에서 project/client ID 추출 (/projects/p/X, /clients/Y 등)
        const path = page_context?.path || '';
        const projMatch = path.match(/\/projects\/p\/(\d+)/) || path.match(/\?project=(\d+)/);
        const clientMatch = path.match(/\?client=(\d+)/);
        const ctx = await buildCueContext({
          businessId,
          conversationId: null,  // 도움말 챗은 conversation 무관
          projectId: projMatch ? Number(projMatch[1]) : null,
          clientId: clientMatch ? Number(clientMatch[1]) : null,
          userId: req.user.id,  // 본인 스냅샷 (이번 주 task / 일정 / 인박스)
          query: q,
        });
        if (ctx.markdown) ctxBlock += `\n\n# 워크스페이스 현황\n${ctx.markdown}`;
      }
    } catch (e) {
      console.warn('[cue/help] context build failed:', e.message);
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT_KO + (ctxBlock ? `\n\n[컨텍스트]\n${ctxBlock}` : '') },
      { role: 'user', content: q },
    ];

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.3,
        max_tokens: 600,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[cue/help] LLM error', r.status, t.slice(0, 200));
      return errorResponse(res, 'llm_error', 502);
    }
    const j = await r.json();
    const answer = (j.choices?.[0]?.message?.content || '').trim();
    return successResponse(res, { answer });
  } catch (e) { next(e); }
});

module.exports = router;
