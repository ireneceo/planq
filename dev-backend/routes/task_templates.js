// 업무 템플릿 라우트 (사이클 N+1)
// GET    /api/task-templates                — 시스템 preset + 워크스페이스 템플릿 통합 목록
// GET    /api/task-templates/:id             — 상세 (items 포함)
// POST   /api/task-templates/:id/apply       — 템플릿 → task 일괄 생성 (end_date 기간 맞춤 · dry_run 미리보기)
// POST   /api/task-templates/:id/ai-refine   — AI 로 고쳐 넣기(바꿀 것만 — 미리보기)
// POST   /api/task-templates                 — 사용자 신규 저장 (Phase 3)
// POST   /api/projects/:id/save-as-template  — 기존 프로젝트 → 템플릿 (Phase 3, 별도 라우트)

const express = require('express');
const router = express.Router();
const { normalizeItemDetails } = require('../services/templateDetails');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { TaskTemplate, TaskTemplateItem, BusinessMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { requestScope, staleResponse } = require('../middleware/workspaceContext');
const { embedText, blobToFloats, cosineSimilarity } = require('../services/kb_service');
const { recomputeTemplateEmbedding } = require('../services/templateEmbedding');

// AI 추천 매칭 임계값 — text-embedding-3-small 코사인 보정값.
// 의미 유사 문장도 0.3~0.6 대라 0.80(raw)은 비현실적. 실 프롬프트로 보정 (docs/TASK_TEMPLATE_AI_RECOMMEND_DESIGN.md §4).
const RECOMMEND_MIN_SIM = 0.45;

// 워크스페이스 멤버 권한 확인
async function ensureMember(userId, businessId, platformRole) {
  if (platformRole === 'platform_admin') return true;
  const bm = await BusinessMember.findOne({ where: { user_id: userId, business_id: businessId } });
  return !!bm;
}

// 추천 호출 per-user rate-limit — 외부 임베딩 비용 라우트 (CLAUDE.md 운영안정성 #1).
// debounce(600ms) 입력이라 분당 수십 회 가능 → 사용자당 120/분 cap (IP NAT 우회 위해 user.id 키).
const recommendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ? `tpl-recommend-u${req.user.id}` : `tpl-recommend-ip${ipKeyGenerator(req.ip)}`,
  handler: (req, res) => errorResponse(res, 'rate_limited', 429),
});

// ==========================================
// GET /api/task-templates?business_id=X[&category=Y]
// 시스템 preset (business_id NULL & is_system=true) + 워크스페이스 템플릿
// ==========================================
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    // 범위: 명시값 → 창의 워크스페이스(X-Workspace-Id). 추측하지 않는다(middleware/workspaceContext).
    const wsScope = requestScope(req, req.query.business_id);
    if (wsScope.stale) return staleResponse(res, wsScope);
    const businessId = Number(wsScope.businessId);
    if (!businessId) return errorResponse(res, 'business_id required', 400);

    if (!(await ensureMember(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    const where = {
      [Op.or]: [
        { is_system: true, business_id: null },
        { business_id: businessId },
      ],
    };
    if (req.query.category) where.category = String(req.query.category);

    const templates = await TaskTemplate.findAll({
      where,
      order: [['is_system', 'DESC'], ['usage_count', 'DESC'], ['created_at', 'DESC']],
    });

    return successResponse(res, templates.map(t => t.toJSON()));
  } catch (err) { next(err); }
});

// ==========================================
// POST /api/task-templates/recommend
// body: { business_id, prompt, project_id? }
// 자연어 프롬프트 ↔ 저장 템플릿 임베딩 코사인 매칭. 임계 이상 1순위 1개만 반환.
// AI 업무 추가 모달에서 호출 — "이 템플릿과 거의 같아요" 보조 신호 (강제 아님).
// ==========================================
router.post('/recommend', authenticateToken, recommendLimiter, async (req, res, next) => {
  try {
    const wsScope = requestScope(req, req.body?.business_id);
    if (wsScope.stale) return staleResponse(res, wsScope);
    const businessId = Number(wsScope.businessId);
    const prompt = String(req.body?.prompt || '').trim();
    if (!businessId) return errorResponse(res, 'business_id required', 400);
    if (!(await ensureMember(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden — members only', 403);
    }
    // 너무 짧은 입력은 노이즈·비용 — 매칭 안 함 (배너 안 뜸)
    if (prompt.length < 6) return successResponse(res, { match: null });

    // 프롬프트 임베딩 (OPENAI 없거나 실패 시 graceful null → 배너 안 뜸)
    const qBlob = await embedText(prompt);
    if (!qBlob) return successResponse(res, { match: null });
    const qVec = blobToFloats(qBlob);
    if (!qVec) return successResponse(res, { match: null });

    // 워크스페이스 가용 템플릿 (preset + 현재 WS만 — 멀티테넌트 격리)
    const templates = await TaskTemplate.findAll({
      where: { [Op.or]: [{ is_system: true, business_id: null }, { business_id: businessId }] },
      include: [{ model: TaskTemplateItem, as: 'items', attributes: ['role_hint'] }],
    });

    let best = null;
    for (const tpl of templates) {
      if (!tpl.embedding) continue;                  // 임베딩 없는 옛 템플릿 skip (백필 전 안전)
      const tVec = blobToFloats(tpl.embedding);
      if (!tVec) continue;
      const sim = cosineSimilarity(qVec, tVec);
      if (!best || sim > best.sim) best = { tpl, sim };
    }

    if (!best || best.sim < RECOMMEND_MIN_SIM) {
      return successResponse(res, { match: null });
    }

    const roleHints = Array.from(new Set((best.tpl.items || [])
      .map(i => i.role_hint).filter(Boolean)));
    return successResponse(res, {
      match: {
        id: best.tpl.id,
        name: best.tpl.name,
        category: best.tpl.category,
        task_count: best.tpl.task_count,
        is_system: best.tpl.is_system,
        role_hints: roleHints,
        score: Number(best.sim.toFixed(3)),
      },
    });
  } catch (err) { next(err); }
});

// ==========================================
// GET /api/task-templates/:id — items 포함 상세
// ==========================================
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id, {
      include: [{ model: TaskTemplateItem, as: 'items' }],
    });
    if (!tpl) return errorResponse(res, 'not_found', 404);

    // 권한: 시스템 preset 은 모두 OK, 워크스페이스 템플릿은 멤버만
    if (!tpl.is_system) {
      if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }

    const data = tpl.toJSON();
    data.items = (data.items || []).sort((a, b) => a.order_index - b.order_index);
    // 옛 템플릿(날짜 읽기 버그로 오프셋이 전부 0) — 화면이 경고하고 «끝날짜 맞춤» 을 끈다. 저장하지 않는 계산 값.
    data.schedule_missing = require('../services/templateApply').scheduleMissing(data.items);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ==========================================
// POST /api/task-templates/:id/apply
// body: { business_id, project_id?, start_date, end_date?, assignee_map?, dry_run? }
//   end_date 를 주면 전체 일정을 그 날에 끝나게 비례 조정 · dry_run 이면 만들지 않고 계산한 날짜만(미리보기 한 벌)
// ==========================================
router.post('/:id/apply', authenticateToken, async (req, res, next) => {
  try {
    const { business_id, project_id, start_date, end_date, assignee_map, dry_run } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!start_date || !ymdRe.test(String(start_date).slice(0, 10))) return errorResponse(res, 'start_date required (YYYY-MM-DD)', 400);
    if (end_date && !ymdRe.test(String(end_date).slice(0, 10))) return errorResponse(res, 'invalid_end_date', 400);

    if (!(await ensureMember(req.user.id, business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden — members only', 403);
    }

    // 프로젝트는 이 워크스페이스 것 + 내가 볼 수 있는 것만 — 남의 프로젝트에 업무·그룹을 꽂지 못하게.
    if (project_id) {
      const { Project } = require('../models');
      const proj = await Project.findOne({ where: { id: project_id, business_id }, attributes: ['id'] });
      if (!proj) return errorResponse(res, 'project_not_found', 404);
      const { userCanSeeProject } = require('../middleware/access_scope');
      if (!(await userCanSeeProject(req.user.id, Number(business_id), Number(project_id), req.user.platform_role))) {
        return errorResponse(res, 'project_not_found', 404);
      }
    }

    const { applyTemplate } = require('../services/templateApply');
    const result = await applyTemplate({
      templateId: Number(req.params.id),
      businessId: Number(business_id),
      projectId: project_id || null,
      startDate: String(start_date).slice(0, 10),
      endDate: end_date ? String(end_date).slice(0, 10) : null,
      dryRun: dry_run === true,
      assigneeMap: assignee_map || {},
      actorUserId: req.user.id,
    });
    if (result.dryRun) {
      return successResponse(res, {
        items: result.items, scaled: result.scaled, reason: result.reason,
        span_days: result.span_days, schedule_missing: result.schedule_missing,
      });
    }

    // socket emit — Q Task 페이지 자동 반영
    const io = req.app.get('io');
    if (io && result.created.length > 0) {
      for (const t of result.created) {
        const payload = { ...t.toJSON(), actor_user_id: req.user.id };
        // 업무 방송은 한 문(services/taskRoom) — 공개 범위에 따라 볼 수 있는 사람에게만 행이 간다.
        require('../services/taskRoom').emitTask(io, 'task:new', payload, { businessId: business_id, projectId: project_id }).catch((e) => console.warn('[emitTask]', e.message));
      }
    }

    // N+63 — audit (운영 readiness 마무리). 템플릿 적용은 빈번 + 다수 task 생성이라 추적 필요.
    require('../services/auditService').logAudit(req, {
      action: 'task_template.apply',
      targetType: 'task_template',
      targetId: result.templateId,
      businessId: Number(business_id),
      newValue: { project_id: project_id || null, start_date, end_date: end_date || null, scaled: !!result.scaled, task_count: result.created.length },
    });

    return successResponse(res, {
      created: result.created.map(t => t.toJSON()),
      count: result.created.length,
      template_id: result.templateId,
      workstreams_created: result.workstreamsCreated || 0,
      scaled: !!result.scaled,
      reason: result.reason || null,
    });
  } catch (err) {
    if (err.message === 'end_before_start' || err.message === 'invalid_end_date') return errorResponse(res, err.message, 400);
    if (err.message === 'template_not_found') return errorResponse(res, 'template_not_found', 404);
    if (err.message === 'forbidden_template') return errorResponse(res, 'forbidden_template', 403);
    next(err);
  }
});

// ==========================================
// POST /api/task-templates/:id/ai-refine — 템플릿에서 «AI 로 고쳐 넣기» (미리보기, 저장 X)
// body: { business_id, project_id?, start_date, items[](현재 목록 전부), instructions[], language? }
//   AI 는 바꿀 것만(ops) 내고 서버가 원본 위에 얹는다 — services/templateAiRefine (docs/TASK_TEMPLATE_DETAIL_DESIGN.md §5)
// ==========================================
const refineLimiter = require('../middleware/costGuard').perUserDaily('tpl-ai-refine', { perMin: 6, perDay: 60, message: 'AI 고쳐 넣기를 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' });
router.post('/:id/ai-refine', authenticateToken, ...refineLimiter, async (req, res, next) => { // audit-exempt: 미리보기 — 저장하지 않는다(사용량은 cue_usage)
  try {
    const { business_id, project_id, start_date, items, instructions, language } = req.body;
    if (!business_id) return errorResponse(res, 'business_id required', 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start_date || ''))) return errorResponse(res, 'start_date required (YYYY-MM-DD)', 400);
    const { MAX_ITEMS, refineTemplateItems } = require('../services/templateAiRefine');
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return errorResponse(res, 'items required (1~40)', 400);
    const ins = (Array.isArray(instructions) ? instructions : []).map((x) => String(x || '').trim().slice(0, 1000)).filter(Boolean).slice(-10);
    if (!ins.length) return errorResponse(res, 'instruction required', 400);
    if (!(await ensureMember(req.user.id, business_id, req.user.platform_role))) return errorResponse(res, 'forbidden — members only', 403);
    const tpl = await TaskTemplate.findByPk(req.params.id, { attributes: ['id', 'business_id', 'is_system', 'workstreams'] });
    if (!tpl || (!tpl.is_system && Number(tpl.business_id) !== Number(business_id))) return errorResponse(res, 'template_not_found', 404);
    const planEngine = require('../services/plan');
    const planCan = await planEngine.can(business_id, 'use_cue', { actions: 1 });
    if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, business_id));
    // 그룹 이름 — 템플릿 그룹 + (프로젝트면) 그 프로젝트 그룹. 이 워크스페이스 프로젝트만.
    const groups = (Array.isArray(tpl.workstreams) ? tpl.workstreams : []).map((g) => g && g.title).filter(Boolean);
    if (project_id) {
      const { ProjectWorkstream } = require('../models');
      const rows = await ProjectWorkstream.findAll({ where: { project_id, business_id }, attributes: ['title'], limit: 30 });
      for (const w of rows) if (w.title && !groups.includes(w.title)) groups.push(w.title);
    }
    const r = await refineTemplateItems({
      businessId: Number(business_id), items, startDate: start_date, instructions: ins,
      language: language === 'en' ? 'en' : 'ko', workstreams: groups,
    });
    if (!r.ok) return errorResponse(res, r.code, r.http || 400);
    return successResponse(res, { items: r.items, applied: r.applied, rejected: r.rejected, note: r.note, notes: r.notes });
  } catch (err) { next(err); }
});

// ==========================================
// PUT /api/task-templates/:id — 메타 수정 (name/description/category/is_default)
// 시스템 preset 은 platform_admin 만 수정 가능. 워크스페이스 템플릿은 멤버.
// ==========================================
router.put('/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) {
      if (req.user.platform_role !== 'platform_admin') {
        return errorResponse(res, 'system_preset_readonly', 403);
      }
    } else {
      if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const { name, description, category, is_default } = req.body;
    const updates = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim().slice(0, 200);
    if (typeof description === 'string') updates.description = description.slice(0, 2000) || null;
    if (typeof category === 'string') updates.category = category.slice(0, 50) || null;
    if (typeof is_default === 'boolean') updates.is_default = is_default;
    const prev = { name: tpl.name, category: tpl.category, is_default: tpl.is_default };
    await tpl.update(updates);
    // name/description/category 가 매칭 텍스트 → 변경 시 임베딩 재계산 (background, best-effort)
    if (updates.name || updates.description !== undefined || updates.category !== undefined) {
      recomputeTemplateEmbedding(tpl.id).catch(() => null);
    }
    // N+63 — audit. 메타 수정
    require('../services/auditService').logAudit(req, {
      action: 'task_template.update',
      targetType: 'task_template',
      targetId: tpl.id,
      businessId: tpl.business_id,
      oldValue: prev,
      newValue: updates,
    });
    return successResponse(res, tpl.toJSON());
  } catch (err) { next(err); }
});

// ==========================================
// PUT /api/task-templates/:id/items — items 일괄 교체 (전체 재생성)
// body: { items: [{ title, description?, body?, start_offset_days(null=날짜 없음), duration_days, estimated_hours?, priority?, role_hint?,
//   workstream_title?, is_milestone?, category?, vlevel?, security_level?, recurrence_rule?, tag_names?, action_items?, depends_on_indexes? }] }
// 시스템 preset 은 platform_admin 만, 워크스페이스 템플릿은 멤버.
// ==========================================
router.put('/:id/items', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) {
      if (req.user.platform_role !== 'platform_admin') {
        return errorResponse(res, 'system_preset_readonly', 403);
      }
    } else {
      if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
        return errorResponse(res, 'forbidden', 403);
      }
    }
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!rawItems) return errorResponse(res, 'items array required', 400);
    // 본문 상한 — 업무 본문과 같은 값(task_actions BODY_MAX_CHARS 200,000자).
    if (rawItems.some((it) => it && it.body && String(it.body).length > 200000)) return errorResponse(res, 'body_too_long', 400);
    // 제목 없는 행은 빼되, 뒤 항목의 선행 번호가 어긋나지 않게 번호를 다시 맞춘다.
    const keepIdx = [];
    rawItems.forEach((it, i) => { if (String((it && it.title) || '').trim()) keepIdx.push(i); });
    const newOf = new Map(keepIdx.map((oldI, newI) => [oldI, newI]));
    const items = keepIdx.map((i) => ({
      ...rawItems[i],
      depends_on_indexes: Array.isArray(rawItems[i].depends_on_indexes)
        ? rawItems[i].depends_on_indexes.map((d) => newOf.get(Number(d))).filter((d) => d !== undefined) : null,
    }));

    // 기존 items 모두 삭제 후 재생성
    await TaskTemplateItem.destroy({ where: { template_id: tpl.id } });

    let totalDur = 0;
    let saved = 0;
    const savedItems = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const title = String(it.title || '').trim().slice(0, 500);
      if (!title) continue;
      // 디테일·날짜(null = 날짜 없음, 0 = 시작일에 마감)는 한 곳에서 정리한다(services/templateDetails — AI 고쳐 넣기와 같은 함수).
      const det = normalizeItemDetails(it, saved);
      const workstreamTitle = String(it.workstream_title || '').trim().slice(0, 200) || null;
      if (det.start_offset_days !== null && det.start_offset_days + det.duration_days > totalDur) totalDur = det.start_offset_days + det.duration_days;
      await TaskTemplateItem.create({
        template_id: tpl.id,
        title,
        description: it.description ? String(it.description).slice(0, 2000) : null,
        ...det,
        estimated_hours: Number.isFinite(Number(it.estimated_hours)) && Number(it.estimated_hours) > 0
          ? Number(it.estimated_hours) : null,
        priority: ['urgent', 'high', 'normal', 'low'].includes(it.priority) ? it.priority : 'normal',
        role_hint: it.role_hint ? String(it.role_hint).slice(0, 100) : null,
        workstream_title: workstreamTitle,
        order_index: saved,
      });
      saved += 1;
      savedItems.push({ workstream_title: workstreamTitle });
    }
    // 그룹 목록 — 남아 있는 이름만, 옛 순서·색 유지(templateWorkstreams.groupsForItems).
    const { groupsForItems } = require('../services/templateWorkstreams');
    const groups = groupsForItems(tpl.workstreams, savedItems);
    await tpl.update({ task_count: saved, total_duration_days: totalDur, workstreams: groups.length ? groups : null });
    // item title 들이 매칭 텍스트 핵심 → 임베딩 재계산 (background, best-effort)
    recomputeTemplateEmbedding(tpl.id).catch(() => null);

    const full = await TaskTemplate.findByPk(tpl.id, {
      include: [{ model: TaskTemplateItem, as: 'items' }],
    });
    const data = full.toJSON();
    data.items = (data.items || []).sort((a, b) => a.order_index - b.order_index);
    // N+63 — audit. items 갱신 (콘텐츠 mutation)
    require('../services/auditService').logAudit(req, {
      action: 'task_template.items_update',
      targetType: 'task_template',
      targetId: tpl.id,
      businessId: tpl.business_id,
      newValue: { task_count: saved, total_duration_days: totalDur },
    });
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// ==========================================
// DELETE /api/task-templates/:id — 워크스페이스 템플릿만 (시스템 preset X)
// ==========================================
router.delete('/:id', authenticateToken, async (req, res, next) => {
  try {
    const tpl = await TaskTemplate.findByPk(req.params.id);
    if (!tpl) return errorResponse(res, 'not_found', 404);
    if (tpl.is_system) return errorResponse(res, 'system_preset_readonly', 403);
    if (!(await ensureMember(req.user.id, tpl.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const snap = { name: tpl.name, category: tpl.category, business_id: tpl.business_id, is_system: tpl.is_system };
    await tpl.destroy(); // CASCADE 로 items 도 삭제
    // 사이클 N+54 — audit. 템플릿 삭제 = 콘텐츠 mutation (다른 사용자 적용 영향)
    require('../services/auditService').logAudit(req, {
      action: 'task_template.delete',
      targetType: 'task_template',
      targetId: tpl.id,
      businessId: snap.business_id,
      oldValue: snap,
    });
    return successResponse(res, { deleted: true, id: tpl.id });
  } catch (err) { next(err); }
});

// ==========================================
// POST /api/projects/:id/save-as-template — 기존 프로젝트 → 템플릿
// body: { name, description?, category? }
// 날짜(시작·마감 중 하나라도) 있는 업무를 가장 이른 날짜 기준 offset 으로 변환 · 추진과제(그룹) 이름·순서도 옮긴다.
// body.exclude_done=true 면 완료·취소 업무는 뺀다(화면 «완료 가리기»).
// 워크스페이스 템플릿 (is_system=false) 으로 생성.
// ==========================================
router.post('/from-project/:projectId', authenticateToken, async (req, res, next) => {
  try {
    const { Project } = require('../models');
    const projectId = Number(req.params.projectId);
    const { name, description, category } = req.body;
    // 완료 가리기 — 화면 «완료 가리기»(ProjectTaskFilters)와 같은 술어: 완료·취소를 뺀다.
    const excludeDone = req.body.exclude_done === true;
    if (!name || !String(name).trim()) return errorResponse(res, 'name required', 400);

    const project = await Project.findByPk(projectId);
    if (!project) return errorResponse(res, 'project_not_found', 404);

    if (!(await ensureMember(req.user.id, project.business_id, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }

    const built = await require('../services/templateFromProject').buildTemplateFromProject({
      project, userId: req.user.id, excludeDone,
      name, description, category,
    });
    if (built.error) return errorResponse(res, built.error, 400);
    const { tpl, datedTasks, groups, undatedSkipped, undated, privateSkipped } = built;

    const full = await TaskTemplate.findByPk(tpl.id, {
      include: [{ model: TaskTemplateItem, as: 'items' }],
    });
    // N+63 — audit. 프로젝트 → 템플릿 신규 생성
    require('../services/auditService').logAudit(req, {
      action: 'task_template.create_from_project',
      targetType: 'task_template',
      targetId: tpl.id,
      businessId: tpl.business_id,
      newValue: {
        name: tpl.name, source_project_id: project.id, task_count: datedTasks.length,
        workstream_count: groups.length, undated, private_skipped: privateSkipped, exclude_done: excludeDone,
      },
    });
    const data = full.toJSON();
    data.undated_skipped = undatedSkipped;
    data.undated = undated;               // 날짜 없이 담긴 업무 수(적용 때 날짜 없이 만든다)
    data.private_skipped = privateSkipped; // «나만 보기» 라 빠진 업무 수
    return successResponse(res, data, 'saved_as_template', 201);
  } catch (err) { next(err); }
});

module.exports = router;
