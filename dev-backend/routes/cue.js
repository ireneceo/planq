// Cue Help — 컨텍스트 인식 도움말 LLM 챗.
// PlanQ 전체 화면에서 ⌘? / Ctrl+/ 단축키 또는 ⓘ "Cue 에게 묻기" 클릭으로 호출.
// 입력: { question, page_context }, 출력: { answer }
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

// LLM 호출은 게이트웨이 단일 지점을 지난다 (services/llm.js).
const { callLLM, isEnabled } = require('../services/llm');

// #81 Cue 대화형 실행 — 툴 카탈로그·검증·dispatch (services/cue_tools.js).
//   /help 는 스키마·컨텍스트만 가져가 LLM 에 제안시키고, 실행은 execute-action 에서만.
const cueTools = require('../services/cue_tools');
// 킬스위치 — 운영 중 오작동 시 CUE_TOOLS_ENABLED=0 + 재시작으로 즉시 옛 동작(답변만)으로 롤백.
const CUE_TOOLS_ENABLED = process.env.CUE_TOOLS_ENABLED !== '0';

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
- [컨텍스트] 에 'Q위키 문서' 가 있으면 그 내용을 최우선 근거로 답한다 (추측·창작 금지). 없으면 일반 사용법 안내.
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

// 비용폭탄 H-a — trust proxy=1 이므로 req.ip 가 신뢰된 프록시가 보고한 실 클라이언트 IP.
//   클라이언트가 위조한 x-forwarded-for 를 먼저 신뢰하면 게스트 rate-limit 이 스푸핑으로 무력화됨.
function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// 전역 일일 서킷브레이커 — IP 로테이션 봇넷이 게스트 IP캡을 우회해도 공개 LLM 호출 합산 상한(2000/일).
const { perUserDaily } = require('../middleware/costGuard');
let publicLlmDay = { key: '', count: 0 };
function publicLlmBudgetOk() {
  const dayKey = new Date().toISOString().slice(0, 10);
  if (publicLlmDay.key !== dayKey) publicLlmDay = { key: dayKey, count: 0 };
  if (publicLlmDay.count >= 2000) return false;
  publicLlmDay.count += 1;
  return true;
}
// qhelper/도움말 챗 per-user rate-limit — 플랜게이트는 걸지 않음(qhelper free 는 P7 제품 결정). 10/분 + 150/일.
const helpLimiter = perUserDaily('cue-help', { perMin: 10, perDay: 150, message: '도움말 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.' });

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

// KNOWLEDGE_LOOP 축2 — Q helper 질문 로그. 실패해도 응답 흐름은 막지 않는다.
async function logHelpQuestion(fields) {
  try {
    const { HelpQuestionLog } = require('../models');
    const row = await HelpQuestionLog.create(fields);
    return row.id;
  } catch (e) {
    console.warn('[cue] question log failed:', e.message);
    return null;
  }
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
      const logId = await logHelpQuestion({ mode: 'public', question: q, answered: true, lang: 'ko' });
      return successResponse(res, { answer: cached.answer, cached: true, log_id: logId });
    }

    if (!isEnabled()) {
      return successResponse(res, {
        answer: 'PlanQ 안내 챗봇 점검 중입니다. 문의 남기기 탭으로 알려주시면 바로 답변드립니다.',
        fallback: true,
      });
    }

    // 비용폭탄 H-a — 전역 일일 상한 초과 시 LLM 호출 없이 fallback (봇넷 IP 로테이션 방어).
    if (!publicLlmBudgetOk()) {
      return successResponse(res, {
        answer: 'PlanQ 안내 챗봇이 잠시 혼잡합니다. 문의 남기기 탭으로 알려주시면 바로 답변드립니다.',
        fallback: true,
      });
    }

    const { content, fallback } = await callLLM({
      purpose: 'kb_answer',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT_GUEST },
        { role: 'user', content: q },
      ],
      maxTokens: 400,
      temperature: 0.3,
      fallback: '',
    });
    if (fallback) return errorResponse(res, 'llm_error', 502);
    const answer = (content || '').trim();
    if (answer) {
      guestCache.set(hash, { answer, expiresAt: Date.now() + GUEST_CACHE_TTL_MS });
    }
    const logId = await logHelpQuestion({ mode: 'public', question: q, answered: !!answer, lang: 'ko' });
    return successResponse(res, { answer, cached: false, log_id: logId });
  } catch (e) { next(e); }
});

router.post('/help', authenticateToken, ...helpLimiter, async (req, res, next) => {
  try {
    const { question, page_context, mode } = req.body || {};
    if (!question || typeof question !== 'string' || !question.trim()) {
      return errorResponse(res, 'question_required', 400);
    }
    const q = question.trim().slice(0, 1000);
    let workspaceBizId = null;   // #81 — 툴 제안(로스터 주입·proposed_action)에 재사용

    if (!isEnabled()) {
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
          const { getUserScope } = require('../middleware/access_scope');
          const path = page_context?.path || '';
          const projMatch = path.match(/\/projects\/p\/(\d+)/) || path.match(/\?project=(\d+)/);
          const clientMatch = path.match(/\?client=(\d+)/);
          // #61 — 질문자 권한 scope 계산 → 전방위 검색을 권한 범위 내로 격리
          const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
          const ctx = await buildCueContext({
            businessId,
            conversationId: null,
            projectId: projMatch ? Number(projMatch[1]) : null,
            clientId: clientMatch ? Number(clientMatch[1]) : null,
            userId: req.user.id,
            query: q,
            scope,
          });
          if (ctx.markdown) ctxBlock += `\n\n# 워크스페이스 현황\n${ctx.markdown}`;
          workspaceBizId = businessId;
          // #81 — 툴 활성 시 오늘/시간대/멤버 로스터 주입 (담당자 이름 정확 해석의 핵심)
          if (CUE_TOOLS_ENABLED) {
            try { ctxBlock += `\n\n${await cueTools.buildToolSystemContext(businessId)}`; }
            catch (e) { console.warn('[cue/help tools ctx]', e.message); }
          }
        }
      } catch (e) {
        console.warn('[cue/help workspace] context build failed:', e.message);
      }
    }

    // qhelper 모드 — Q위키 article retrieval (FULLTEXT + 임베딩) → 근거 기반 RAG.
    // 응답에 sources[] 반환. (Q_WIKI_DESIGN §3, B5)
    let wikiSources = [];
    let wikiTopArticleId = null;
    if (finalMode === 'qhelper') {
      try {
        const { searchArticleIds, blocksToText } = require('../services/wikiSearch');
        const HelpArticle = require('../models/HelpArticle');
        const ids = await searchArticleIds(q, { onlyPublic: false, limit: 4 });
        if (ids.length) {
          const arts = await HelpArticle.findAll({ where: { id: ids, is_published: true } });
          const orderMap = new Map(ids.map((id, i) => [id, i]));
          arts.sort((a, b) => (orderMap.get(a.id) ?? 9) - (orderMap.get(b.id) ?? 9));
          wikiTopArticleId = arts[0]?.id || null;
          const docBlocks = [];
          for (const a of arts.slice(0, 3)) {
            const title = a.title_ko || a.title_en || '';
            const summary = a.summary_ko || a.summary_en || '';
            const body = blocksToText(a.body_ko, 'ko') || blocksToText(a.body_en, 'en') || '';
            docBlocks.push(`## ${title}\n${summary}\n${body}`.slice(0, 1500));
            wikiSources.push({ slug: a.slug, title });
          }
          if (docBlocks.length) {
            ctxBlock += `\n\n# Q위키 문서 (이 내용만 근거로 답변)\n${docBlocks.join('\n\n')}`;
          }
        }
      } catch (e) {
        console.warn('[cue/help qhelper] wiki retrieval failed:', e.message);
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt + (ctxBlock ? `\n\n[컨텍스트]\n${ctxBlock}` : '') },
      { role: 'user', content: q },
    ];

    // #81 — workspace 모드 + 킬스위치 on 이면 쓰기 툴을 제안하게 한다 (실행 X, 제안만).
    const useTools = CUE_TOOLS_ENABLED && finalMode === 'workspace' && !!workspaceBizId;
    const { content, fallback, tool_calls } = await callLLM({
      purpose: 'kb_answer',
      messages,
      maxTokens: 600,
      temperature: 0.3,
      fallback: '',
      ...(useTools ? { tools: cueTools.TOOL_SCHEMAS } : {}),
    });
    if (fallback) return errorResponse(res, 'llm_error', 502);
    const answer = (content || '').trim();

    // 툴 제안 → 확인 카드용 proposed_action (첫 유효 쓰기 툴 1건). 절대 실행 안 함.
    let proposedAction = null;
    if (useTools && Array.isArray(tool_calls) && tool_calls.length) {
      try { proposedAction = await cueTools.buildProposedAction(workspaceBizId, tool_calls); }
      catch (e) { console.warn('[cue/help buildProposedAction]', e.message); }
    }
    // KNOWLEDGE_LOOP 축2 — qhelper 질문 로그 (workspace 모드는 위키 개선 대상 아님)
    let logId = null;
    if (finalMode === 'qhelper') {
      logId = await logHelpQuestion({
        user_id: req.user.id,
        business_id: req.user.active_business_id || null,
        mode: 'qhelper',
        question: q,
        lang: String(req.body.lang || 'ko').slice(0, 5),
        answered: wikiSources.length > 0,
        top_article_id: wikiTopArticleId,
      });
    }
    return successResponse(res, {
      answer, mode: finalMode, sources: wikiSources, log_id: logId,
      ...(proposedAction ? { proposed_action: proposedAction } : {}),
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════
// #81 POST /api/cue/execute-action — 확인 카드 [추가] → 실행
//   actor = 사용자 본인. cue_tools.executeTool 이 검증 → 행동 계층 dispatch (메뉴 권한·assertAssignable·감사·broadcast).
//   execute-action 은 사용자가 이미 정상 라우트로 할 수 있는 것과 동일한 게이트된 행동을 부르는 대체 입구 —
//   새 권한 상승 경로 0. 그래서 confirm 을 서버에 저장하지 않는다(stateless, 클라 params 는 여기서 재검증).
// ═══════════════════════════════════════════════
router.post('/execute-action', authenticateToken, ...helpLimiter, async (req, res, next) => {
  try {
    if (!CUE_TOOLS_ENABLED) return errorResponse(res, 'tools_disabled', 403);
    const { tool, params } = req.body || {};
    if (!tool || !cueTools.WRITE_TOOLS.has(tool)) return errorResponse(res, 'unknown_tool', 400);

    // businessId 는 인증 컨텍스트에서 서버가 도출 (클라 business_id 불신). 행동 계층이 멤버십 재검증.
    let businessId = req.user.active_business_id;
    if (!businessId) {
      const { BusinessMember } = require('../models');
      const bm = await BusinessMember.findOne({
        where: { user_id: req.user.id, removed_at: null },
        order: [['id', 'ASC']], attributes: ['business_id'],
      });
      businessId = bm?.business_id || null;
    }
    if (!businessId) return errorResponse(res, 'no_workspace', 400);

    // 플랜 쿼터 — 실행이 유일한 계량점(제안 /help 는 무과금)
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(businessId, 'use_cue', { actions: 1 });
    if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));

    const actor = { kind: 'user', userId: req.user.id, platformRole: req.user.platform_role, req };
    const r = await cueTools.executeTool(actor, businessId, tool, params || {});
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);

    // 계량(관측) + 프로비넌스 감사 — actor=사용자라 행동 계층 create 감사와 별개로 "Cue 대화로 실행됨" 을 남긴다
    const { recordUsage } = require('../services/cue_orchestrator');
    recordUsage(businessId, 'tool_call', 'gpt-4o-mini', 0, 0).catch((e) => console.warn('[cue tool_call usage]', e.message));
    require('../services/auditService').logAudit(req, {
      action: 'cue.tool_execute', targetType: r.data.entity_type, targetId: r.data.entity_id,
      businessId, newValue: { tool, entity_type: r.data.entity_type, entity_id: r.data.entity_id },
    });

    return successResponse(res, {
      tool, entity_type: r.data.entity_type, entity_id: r.data.entity_id, entity: r.data.entity,
    }, 'executed', 201);
  } catch (e) { next(e); }
});

// KNOWLEDGE_LOOP 축2 — 답변 피드백 (도움됐어요/아니요). 공개 위키챗도 허용 — guest rate 재사용.
router.post('/help-feedback', async (req, res, next) => {
  try {
    const { log_id, feedback } = req.body || {};
    if (!Number.isInteger(log_id) || !['helpful', 'not_helpful'].includes(feedback)) {
      return errorResponse(res, 'invalid_request', 400);
    }
    const rate = checkGuestRate(getClientIp(req));
    if (!rate.ok) return errorResponse(res, 'rate_limit', 429);
    const { HelpQuestionLog } = require('../models');
    const row = await HelpQuestionLog.findByPk(log_id);
    if (!row) return errorResponse(res, 'not_found', 404);
    if (row.feedback) return errorResponse(res, 'already_submitted', 409);
    await row.update({ feedback, feedback_at: new Date() });
    return successResponse(res, { ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
