// Task 예측시간 이력 + AI 추천.
// POST /api/tasks/:taskId/estimate/ai — LLM 추천값 생성 + DB 저장
// GET /api/tasks/:taskId/estimations — 이력 (AI / user 둘 다)
const express = require('express');
const router = express.Router();
const { Task, TaskEstimation, Project } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AI_MODEL = 'gpt-4o-mini';

// 워크스페이스 패턴 few-shot — 같은 workspace 의 최근 사용자 확정 추정을 prompt 에 포함.
// 사이클 N+20 — 워크스페이스별 업무 패턴 정확도 향상 (옷가게 vs 개발사 vs 컨설팅 — 같은 단어라도 추정 다름).
async function loadWorkspacePatterns(businessId, limit = 12) {
  if (!businessId) return [];
  try {
    const { Op } = require('sequelize');
    const rows = await TaskEstimation.findAll({
      where: { business_id: businessId, source: 'user', value: { [Op.gt]: 0 } },
      include: [{ model: Task, attributes: ['title'], required: true }],
      order: [['created_at', 'DESC']],
      limit,
    });
    return rows.map(r => ({ title: r.Task?.title || '', hours: Number(r.value) })).filter(p => p.title);
  } catch (e) {
    console.warn('[ai-estimate] loadWorkspacePatterns failed:', e.message);
    return [];
  }
}

// AI 추천 — 제목 + 설명 기반. 0.25 단위 반올림. businessId 주면 워크스페이스 패턴 few-shot 사용.
async function callAiEstimate(title, description, businessId = null) {
  if (!OPENAI_API_KEY) return null;
  let sys = `너는 PlanQ Cue, 업무 시간 추정 전문가야.
업무 제목·설명을 보고 평균적으로 몇 시간이 걸릴지 추정한다.
- 0.25 단위로 반올림
- 0.25 ~ 40 시간 범위
- 단순한 의사결정/메시지 회신: 0.25 ~ 0.5h
- 일반 문서/슬라이드 한 건: 1 ~ 4h
- 분석/디자인/연구: 4 ~ 16h
- 큰 프로젝트성 산출물: 16 ~ 40h

응답은 JSON 한 줄: {"hours": <number>, "reason": "<짧은 한 줄 근거>"}
다른 텍스트 X.`;
  const patterns = await loadWorkspacePatterns(businessId);
  if (patterns.length >= 3) {
    sys += `\n\n이 워크스페이스의 최근 사용자 확정 추정 사례 (참고):\n` +
      patterns.map(p => `- "${p.title.slice(0, 60)}" → ${p.hours}h`).join('\n') +
      `\n위 사례 패턴을 우선 고려해서 일관성 있게 추정.`;
  }
  // KNOWLEDGE_LOOP 축1 — 카테고리별 실측(actual) 소요시간 통계 (확정 추정과 별개의 실측 근거)
  try { sys += await require('../services/cueKnowledge').getWorkPatternPromptBlock(businessId); } catch { /* noop */ }
  const user = `제목: ${title}${description ? `\n설명: ${description.slice(0, 600)}` : ''}`;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 100,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    let hours = Number(parsed.hours);
    if (!Number.isFinite(hours)) return null;
    hours = Math.max(0.25, Math.min(40, Math.round(hours * 4) / 4));
    return { hours, reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 100) : '' };
  } catch (e) {
    console.error('[ai-estimate]', e.message);
    return null;
  }
}

// POST /api/tasks/estimate-preview — 작성 중인 task (id 없음) 의 AI 추정.
//   바디: { title, description? } — 캐시 없음, 단순 LLM 호출.
//   업무 추가 폼에서 "AI 추천" 버튼용.
router.post('/estimate-preview', authenticateToken, async (req, res, next) => {
  try {
    const { title, description, business_id } = req.body || {};
    if (!title || !String(title).trim()) {
      return errorResponse(res, 'title_required', 400);
    }
    // business_id 전달 시 워크스페이스 패턴 few-shot 학습 활성
    const ai = await callAiEstimate(String(title).trim(), String(description || ''), business_id || null);
    if (!ai) return errorResponse(res, 'ai_unavailable', 503);
    return successResponse(res, { value: ai.hours, reason: ai.reason, model: AI_MODEL });
  } catch (e) { next(e); }
});

// POST /api/tasks/:taskId/estimate/ai
router.post('/:taskId/estimate/ai', authenticateToken, async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (!taskId) return errorResponse(res, 'invalid_task', 400);
    const task = await Task.findByPk(taskId, { attributes: ['id', 'title', 'description', 'business_id'] });
    if (!task) return errorResponse(res, 'not_found', 404);

    // 캐시: 같은 task 의 ai 추천이 1시간 이내 있으면 재사용 (LLM 비용 절감)
    const recent = await TaskEstimation.findOne({
      where: { task_id: taskId, source: 'ai' },
      order: [['created_at', 'DESC']],
    });
    const oneHour = 60 * 60 * 1000;
    const recentAt = recent?.createdAt || recent?.created_at;
    if (recent && recentAt && Date.now() - new Date(recentAt).getTime() < oneHour) {
      return successResponse(res, { value: Number(recent.value), model: recent.model, cached: true });
    }

    const ai = await callAiEstimate(task.title || '', task.description || '', task.business_id);
    if (!ai) return errorResponse(res, 'ai_unavailable', 503);
    const row = await TaskEstimation.create({
      task_id: taskId,
      business_id: task.business_id,
      value: ai.hours,
      source: 'ai',
      model: AI_MODEL,
    });
    return successResponse(res, { value: Number(row.value), reason: ai.reason, model: AI_MODEL });
  } catch (e) { next(e); }
});

// GET /api/tasks/:taskId/estimations
router.get('/:taskId/estimations', authenticateToken, async (req, res, next) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    if (!taskId) return errorResponse(res, 'invalid_task', 400);
    const list = await TaskEstimation.findAll({
      where: { task_id: taskId },
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    return successResponse(res, list.map(r => ({
      id: r.id, value: Number(r.value), source: r.source, model: r.model,
      created_at: r.createdAt, created_by_user_id: r.created_by_user_id,
    })));
  } catch (e) { next(e); }
});

// 사용자 확정 이력 — tasks.estimated_hours PATCH 핸들러에서 호출 (외부 export).
// 사이클 N+20 — business_id 함께 저장 (워크스페이스별 패턴 학습).
async function recordUserEstimate(taskId, value, userId) {
  if (value == null || !Number.isFinite(Number(value))) return;
  try {
    const task = await Task.findByPk(taskId, { attributes: ['business_id'] });
    if (!task) return;
    await TaskEstimation.create({
      task_id: taskId,
      business_id: task.business_id,
      value: Number(value),
      source: 'user',
      created_by_user_id: userId,
    });
  } catch (e) {
    console.error('[recordUserEstimate]', e.message);
  }
}

module.exports = router;
module.exports.recordUserEstimate = recordUserEstimate;
module.exports.callAiEstimate = callAiEstimate;
module.exports.AI_MODEL = AI_MODEL;
