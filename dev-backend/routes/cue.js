// Cue Help — 컨텍스트 인식 도움말 LLM 챗.
// PlanQ 전체 화면에서 ⌘? / Ctrl+/ 단축키 또는 ⓘ "Cue 에게 묻기" 클릭으로 호출.
// 입력: { question, page_context }, 출력: { answer }
const crypto = require('crypto');
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

// ─── 게스트 (비로그인) 도움말 ───
//   랜딩 / 공개 문서 / 가입 전 방문자 대상. PlanQ 마케팅 정보만.
//   비용은 마케팅비용으로 감안 (cue_usage 미기록). 어뷰즈 가드: IP rate limit + 24h 캐시 + max_tokens.
const SYSTEM_PROMPT_GUEST = `너는 PlanQ 안내 도우미. 가입 전 방문자에게 PlanQ 가 어떤 서비스인지 설명해.

PlanQ — B2B SaaS 통합 워크스페이스. 핵심 모듈:
• Q talk (대화) — 고객·팀과 채팅, 대화 자료 자동 정리
• Q task (할일) — 업무 추출·배정·진행률·정기 업무
• Q note (음성) — 회의 녹음·실시간 받아쓰기·요약
• Q docs (문서) — 견적·계약·제안서·서명 (외부 OTP)
• Q bill (청구) — 청구서·계좌이체/카드·세금계산서
• Cue — 워크스페이스 AI 팀원 (가입 후 사용)

플랜:
• Starter — 멤버 1, 고객 5, 프로젝트 5, Cue 50회/월, 저장공간 2GB
• Basic — 멤버 5, 고객 30, 프로젝트 30, Cue 300회/월, 50GB
• Pro — 멤버 15, 고객 무제한, 프로젝트 무제한, Cue 1,000회/월, 500GB
• 신규 가입 시 Starter 14일 체험 자동 적용

답변 형식 (반드시):
- 짧은 문단, 빈 줄 한 칸으로 분리
- 한 문단 최대 2문장
- 전체 3문단 이내 (게스트는 짧게 — 깊은 안내는 가입 후)
- 답변 마지막에 자연스러운 다음 행동 1줄 (예: "지금 14일 무료로 시작해보세요" / "더 자세한 내용은 문의 남기기 탭으로 알려주세요")

원칙:
- PlanQ 의 가격·기능·도입 효과 등 마케팅 정보만
- 워크스페이스 사용법 깊은 단계 (예: 특정 버튼 위치, 단축키) 가 오면: "가입 후 더 자세히 안내드립니다 → 14일 무료 체험"
- 다른 회사 제품 비교에 답변 X — "PlanQ 가 어떻게 도와줄지 말씀드릴게요" 로 전환
- 모르거나 답변 못 하는 건: "이건 사람에게 직접 묻는 게 빠릅니다 → 문의 남기기 탭"
- 영어 질문은 영어로, 한국어는 한국어로
- 코드/API 노출 X
- 본인을 "Cue" 라 부르지 말 것 — Cue 는 가입자의 워크스페이스 AI 팀원`;

// ─── 메모리 가드 (단일 프로세스) ───
//   Stage 0 트래픽 기준 — 분당 10/IP, 일 50/IP. 충분 + Redis 도입 시점은 트래픽 트리거.
const guestRate = new Map();    // ip -> { minute: [ts...], day: count, dayKey }
const guestCache = new Map();   // hash(question) -> { answer, expiresAt }
const GUEST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function getClientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.ip || req.connection?.remoteAddress || 'unknown';
}

function checkGuestRate(ip) {
  const now = Date.now();
  const minuteWindow = now - 60_000;
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const cur = guestRate.get(ip) || { minute: [], day: 0, dayKey };
  if (cur.dayKey !== dayKey) { cur.day = 0; cur.dayKey = dayKey; }
  cur.minute = cur.minute.filter(t => t > minuteWindow);
  if (cur.minute.length >= 10) return { ok: false, reason: 'minute' };
  if (cur.day >= 50) return { ok: false, reason: 'day' };
  cur.minute.push(now);
  cur.day += 1;
  guestRate.set(ip, cur);
  return { ok: true };
}

function guestQuestionHash(q) {
  return crypto.createHash('sha256').update(String(q).trim().toLowerCase()).digest('hex').slice(0, 32);
}

router.post('/help-public', async (req, res, next) => {
  try {
    const { question } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return errorResponse(res, 'question_required', 400);
    }
    const q = question.trim().slice(0, 500);

    const ip = getClientIp(req);
    const rate = checkGuestRate(ip);
    if (!rate.ok) {
      return errorResponse(
        res,
        rate.reason === 'minute' ? 'rate_limit_minute' : 'rate_limit_day',
        429,
      );
    }

    // 캐시 hit — LLM 호출 없이 바로 응답 (마케팅 비용 절감)
    const hash = guestQuestionHash(q);
    const cached = guestCache.get(hash);
    if (cached && cached.expiresAt > Date.now()) {
      return successResponse(res, { answer: cached.answer, cached: true });
    }

    if (!OPENAI_API_KEY) {
      return successResponse(res, {
        answer: 'PlanQ 안내 챗봇 점검 중입니다. 문의 남기기 탭으로 알려주시면 바로 답변드립니다.',
        fallback: true,
      });
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_GUEST },
          { role: 'user', content: q },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[cue/help-public] LLM error', r.status, t.slice(0, 200));
      return errorResponse(res, 'llm_error', 502);
    }
    const j = await r.json();
    const answer = (j.choices?.[0]?.message?.content || '').trim();
    if (answer) {
      guestCache.set(hash, { answer, expiresAt: Date.now() + GUEST_CACHE_TTL_MS });
    }
    return successResponse(res, { answer, cached: false });
  } catch (e) { next(e); }
});

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

    // 플랜 쿼터 — Cue 월간 액션 (workspace 모드에서만 차감, qhelper 는 free)
    const finalModeForGate = mode === 'workspace' ? 'workspace' : 'qhelper';
    if (finalModeForGate === 'workspace') {
      const bizId = req.user.active_business_id;
      if (bizId) {
        const planEngine = require('../services/plan');
        const planCan = await planEngine.can(bizId, 'use_cue', { actions: 1 });
        if (!planCan.ok) {
          return res.status(422).json(planEngine.buildQuotaError(planCan, bizId));
        }
      }
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
