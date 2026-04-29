// Cue Help — 컨텍스트 인식 도움말 LLM 챗.
// PlanQ 전체 화면에서 ⌘? / Ctrl+/ 단축키 또는 ⓘ "Cue 에게 묻기" 클릭으로 호출.
// 입력: { question, page_context }, 출력: { answer }
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// 사이클 P7 — Q helper / Cue 모드 분리 (데이터 격리).
//   mode='qhelper' : PlanQ 매뉴얼 전담. 워크스페이스 컨텍스트 X.
//   mode='workspace' : 현재 활성 워크스페이스 컨텍스트 주입 (Cue 페르소나).
const SYSTEM_PROMPT_QHELPER = `너는 Q helper. PlanQ 제품 사용 안내 전담 도우미야.
PlanQ 는 B2B SaaS — Q talk (대화) · Q task (할일) · Q note (음성·요약) · Q docs (문서·서명) · Q bill (청구) · Q knowledge (지식) 통합 워크스페이스.

답변 형식 (반드시):
- 짧은 문단 + 빈 줄 한 칸으로 분리 (\\n\\n)
- 한 문단 최대 2문장
- 단계·옵션 나열 시 "• " bullet
- 전체 4문단 이내

원칙:
- 사용자가 보고 있는 페이지의 작동 원리·기능·옵션 설명
- "도와드릴게요" 군더더기 X — 본론부터
- 영어 질문은 영어로, 한국어는 한국어로
- 모르면 솔직히 "현재 모릅니다 — 우측 상단 '피드백 보내기'로 알려주시면 검토합니다"
- 코드/API 노출 X
- 본인을 "Cue" 라 부르지 말 것. Cue 는 사용자의 워크스페이스 AI 팀원이고, 너 (Q helper) 와는 별개 페르소나.
- 워크스페이스 데이터 (고객/업무/회의 등) 질문이 오면: "그 질문은 'Cue' 모드로 전환해서 물어보세요. 저는 PlanQ 사용법 전담입니다."`;

const SYSTEM_PROMPT_WORKSPACE = `너는 Cue, 사용자의 워크스페이스 AI 팀원이야.
이 워크스페이스의 고객·업무·일정·회의 등 사용자 비즈니스 데이터를 기반으로 답변해.
다른 워크스페이스 데이터는 절대 모름 — 오직 [컨텍스트] 에 있는 현재 워크스페이스 정보만 사용.

답변 형식 (반드시):
- 짧은 문단 + 빈 줄 한 칸 (\\n\\n)
- 한 문단 최대 2문장
- 단계·옵션 나열 시 "• " bullet
- 전체 4문단 이내

원칙:
- 컨텍스트에 있는 사실만 인용 (없는 정보 만들지 X)
- "지금 ○○ 프로젝트 / □□ 고객" 처럼 구체적으로
- 영어/한국어 질문 언어에 맞춰 답변
- PlanQ 사용법 질문이 오면: "그 질문은 'Q helper' 모드로 전환해서 물어보세요. 저는 이 워크스페이스의 데이터를 다룹니다."
- 모르면 솔직히 "이 워크스페이스 데이터에서는 찾지 못했습니다"`;

router.post('/help', authenticateToken, async (req, res, next) => {
  try {
    const { question, page_context, mode } = req.body || {};
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

    // 사이클 P7 — 모드 분리 (qhelper / workspace)
    const finalMode = mode === 'workspace' ? 'workspace' : 'qhelper';
    const systemPrompt = finalMode === 'workspace' ? SYSTEM_PROMPT_WORKSPACE : SYSTEM_PROMPT_QHELPER;

    // 페이지 컨텍스트는 두 모드 모두 공유 (현재 보고 있는 화면)
    let ctxBlock = '';
    if (page_context && typeof page_context === 'object') {
      ctxBlock += `현재 페이지: ${page_context.path || '?'}${page_context.section ? ` · 섹션: ${page_context.section}` : ''}`;
    }

    // workspace 모드만 워크스페이스 데이터 컨텍스트 주입 (격리)
    if (finalMode === 'workspace') {
      try {
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
          const path = page_context?.path || '';
          const projMatch = path.match(/\/projects\/p\/(\d+)/) || path.match(/\?project=(\d+)/);
          const clientMatch = path.match(/\?client=(\d+)/);
          const ctx = await buildCueContext({
            businessId,
            conversationId: null,
            projectId: projMatch ? Number(projMatch[1]) : null,
            clientId: clientMatch ? Number(clientMatch[1]) : null,
            userId: req.user.id,
            query: q,
          });
          if (ctx.markdown) ctxBlock += `\n\n# 워크스페이스 현황\n${ctx.markdown}`;
        }
      } catch (e) {
        console.warn('[cue/help workspace] context build failed:', e.message);
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt + (ctxBlock ? `\n\n[컨텍스트]\n${ctxBlock}` : '') },
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
    return successResponse(res, { answer, mode: finalMode });
  } catch (e) { next(e); }
});

module.exports = router;
