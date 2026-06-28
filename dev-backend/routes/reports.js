// 보고서 공유 (공개) — 인증 불필요. share_token 기반.
//
// /api/reports/share/:token  → PDF 직접 응답
//
// 토큰은 24바이트 hex (48자) — 추측 불가능. 발급 시점부터 영구 (만료 정책은 추후).
//
// 별도 라우트 파일로 분리한 이유:
//  - /api/stats/* 는 모두 authenticateToken 전제. 공유 링크는 인증 없이 접근해야 하므로 다른 마운트.

const express = require('express');
const fs = require('fs');
const router = express.Router();
const crypto = require('crypto');
const { Report, ReportShare, ReportUnit, Project, Department, Business } = require('../models');
const { errorResponse, successResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope } = require('../middleware/access_scope');
const { logAudit } = require('../services/auditService');
const { buildAutoSnapshot } = require('../services/reportUnitSnapshot');
const { buildIntegratedRollup } = require('../services/integratedRollup');
const { generateScrNarrative } = require('../services/reportNarrative');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');
const { mondayOfDateStr, addDaysStr, todayInTz } = require('../utils/datetime');

// #85 — AI SCR 요약 생성은 외부 비용(LLM) → per-user rate-limit
const narrativeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 8,
  keyGenerator: (req) => req.user?.id ? `rpt-narr-u${req.user.id}` : `rpt-narr-ip${ipKeyGenerator(req.ip)}`,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'AI 요약 생성을 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' },
});

// 리뷰 M5 — period_start 를 키 정규화(주=월요일/월=1일)해 비정규 입력의 중복 row·cron 불일치 차단.
function normalizePeriodStart(periodType, periodStart) {
  if (periodType === 'monthly') return `${periodStart.slice(0, 8)}01`;
  return mondayOfDateStr(periodStart);
}

router.get('/share/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 32) return errorResponse(res, 'invalid_token', 400);

    const report = await Report.findOne({ where: { share_token: token } });
    if (!report) return errorResponse(res, 'report_not_found', 404);
    if (report.status !== 'ready' || !report.pdf_url) {
      return errorResponse(res, `report_not_ready (${report.status})`, 409);
    }
    if (!fs.existsSync(report.pdf_url)) {
      return errorResponse(res, 'pdf_file_missing', 410);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(report.title || `report-${report.id}`)}.pdf"`);
    return fs.createReadStream(report.pdf_url).pipe(res);
  } catch (err) { next(err); }
});

// GET /public/integrated/:token — 통합보고서 공개 read-only (인증 불필요). 토큰→기간 매핑 후 롤업 재계산.
router.get('/public/integrated/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 32) return errorResponse(res, 'invalid_token', 400);
    const share = await ReportShare.findOne({ where: { token } });
    if (!share) return errorResponse(res, 'share_not_found', 404);
    const rollup = await buildIntegratedRollup(share.business_id, share.period_type, share.period_start);
    const biz = await Business.findByPk(share.business_id, { attributes: ['name', 'brand_name'] });
    const wsUnit = rollup.integrated?.id ? await ReportUnit.findByPk(rollup.integrated.id, { attributes: ['narrative'] }) : null;
    share.update({ last_viewed_at: new Date() }).catch(() => {});
    return successResponse(res, {
      ...rollup,
      workspace_name: biz?.brand_name || biz?.name || null,
      period_type: share.period_type,
      period_start: share.period_start,
      dim: share.dim,
      executive_summary: wsUnit?.narrative || '',
      read_only: true,
    });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// 책임 기반 단위 보고서 (R2, 마스터설계 §4·§6.2) — report_units
//   scope = project / department. 자동초안(GET, find-or-create) → 수정(PATCH) → 확정/되돌리기.
//   책임자: project owner_user_id / department lead_user_id / 워크스페이스 owner·admin.
// ════════════════════════════════════════════════════════════════

const VALID_SCOPE = ['project', 'member'];
const VALID_PERIOD = ['weekly', 'monthly'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 멤버 이상 + client 차단. platform_admin 은 getUserScope 가 isPlatformAdmin 만 세팅하고
//   isOwner/isMember 는 false 로 둔 채 early-return 하므로(다른 라우트는 checkBusinessAccess
//   platformAdminAs:'owner' 로 처리) 여기서 isPlatformAdmin 을 명시 포함해야 403 회귀 차단.
async function loadScope(req, businessId) {
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  const member = scope.isPlatformAdmin || scope.isOwner || scope.isAdmin || scope.isMember || scope.isAi;
  return { scope, member, ownerOrAdmin: scope.isPlatformAdmin || scope.isOwner || scope.isAdmin };
}

// 책임자 판정 — owner/admin 은 oversight 로 전권. 프로젝트=PM(owner_user_id) / 개인=본인.
async function isResponsible(scope, scopeStr, refId, businessId, ownerOrAdmin) {
  if (ownerOrAdmin) return true;
  if (scopeStr === 'project') {
    const p = await Project.findOne({ where: { id: refId, business_id: businessId }, attributes: ['owner_user_id'] });
    return !!p && Number(p.owner_user_id) === Number(scope.userId);
  }
  if (scopeStr === 'member') {
    return Number(refId) === Number(scope.userId);  // 본인 보고만 편집·확정
  }
  return false;
}

// auto_snapshot + edited_overrides 병합 (overrides 가 top-level 키 교체) + 책임자 플래그
function mergedView(unit, responsible) {
  const auto = unit.auto_snapshot || {};
  const ov = unit.edited_overrides || {};
  return {
    id: unit.id, scope: unit.scope, ref_id: unit.scope_ref_id,
    period_type: unit.period_type, period_start: unit.period_start,
    status: unit.status, confirmed_by: unit.confirmed_by, confirmed_at: unit.confirmed_at, finalized_by: unit.finalized_by,
    narrative: unit.narrative || '',
    snapshot: { ...auto, ...ov },
    has_overrides: Object.keys(ov).length > 0,
    can_edit: responsible,
  };
}

function broadcastReport(req, businessId, unit, reason) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`business:${businessId}`).emit('report:updated', {
    id: unit.id, scope: unit.scope, ref_id: unit.scope_ref_id,
    period_type: unit.period_type, period_start: unit.period_start,
    status: unit.status, reason, actor_user_id: req.user.id,
  });
}

// GET /:biz/unit?scope=&ref_id=&period_type=&period_start= — find-or-create 자동 초안
router.get('/:biz/unit', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    if (!businessId) return errorResponse(res, 'business_id_required', 400);
    const { scope: uScope, member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);

    const scope = String(req.query.scope || '');
    const refId = Number(req.query.ref_id);
    const periodType = String(req.query.period_type || 'weekly');
    const periodStartRaw = String(req.query.period_start || '');
    if (!VALID_SCOPE.includes(scope)) return errorResponse(res, 'invalid_scope', 400);
    if (!refId) return errorResponse(res, 'ref_id_required', 400);
    if (!VALID_PERIOD.includes(periodType)) return errorResponse(res, 'invalid_period_type', 400);
    if (!DATE_RE.test(periodStartRaw)) return errorResponse(res, 'invalid_period_start', 400);
    const periodStart = normalizePeriodStart(periodType, periodStartRaw);

    const responsible = await isResponsible(uScope, scope, refId, businessId, ownerOrAdmin);

    // 개인 보고서 프라이버시 — 본인/owner/admin 만 조회. 다른 멤버 직접 API 조회 차단.
    // (project 보고서는 팀 공유물이라 멤버 누구나 열람 가능)
    if (scope === 'member' && !responsible) return errorResponse(res, 'forbidden', 403);

    // 대상 유효성 먼저 — 미존재/타 워크스페이스는 row 생성 없이 404
    const snap = await buildAutoSnapshot(businessId, scope, refId, periodType, periodStart);
    if (snap === null) return errorResponse(res, 'invalid_ref', 404);

    // 리뷰 LOW — 동시 첫 로드 race 방지: findOrCreate (uk_report_unit 충돌 시 500 차단)
    const [unit] = await ReportUnit.findOrCreate({
      where: { business_id: businessId, scope, scope_ref_id: refId, period_type: periodType, period_start: periodStart },
      defaults: { status: 'draft', auto_snapshot: snap },
    });
    // 확정본은 박제 — 그대로. draft 는 자동초안 live 재생성.
    if (unit.status === 'draft') await unit.update({ auto_snapshot: snap });

    return successResponse(res, mergedView(unit, responsible));
  } catch (err) { next(err); }
});

// PATCH /:biz/unit/:id — 책임자 수정 (narrative · edited_overrides). draft 만.
router.patch('/:biz/unit/:id', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { scope: uScope, member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    const unit = await ReportUnit.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!unit) return errorResponse(res, 'report_not_found', 404);
    if (!await isResponsible(uScope, unit.scope, unit.scope_ref_id, businessId, ownerOrAdmin)) return errorResponse(res, 'not_responsible', 403);
    if (unit.status === 'confirmed') return errorResponse(res, 'confirmed_reopen_first', 409);

    const patch = {};
    if (typeof req.body?.narrative === 'string') patch.narrative = req.body.narrative.slice(0, 20000);
    if (req.body?.edited_overrides && typeof req.body.edited_overrides === 'object') {
      patch.edited_overrides = { ...(unit.edited_overrides || {}), ...req.body.edited_overrides };
    }
    await unit.update(patch);
    broadcastReport(req, businessId, unit, 'edited');
    return successResponse(res, mergedView(unit, true));
  } catch (err) { next(err); }
});

// POST /:biz/unit/:id/generate-narrative — #85 SCR(상황·문제·해결) 경영진 요약 AI 초안.
// 책임자만, draft 만. 저장 안 함 — 응답을 프론트 편집기에 채우고 사용자가 검토 후 PATCH 로 저장.
router.post('/:biz/unit/:id/generate-narrative', authenticateToken, narrativeLimiter, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { scope: uScope, member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    const unit = await ReportUnit.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!unit) return errorResponse(res, 'report_not_found', 404);
    if (!await isResponsible(uScope, unit.scope, unit.scope_ref_id, businessId, ownerOrAdmin)) return errorResponse(res, 'not_responsible', 403);
    if (unit.status === 'confirmed') return errorResponse(res, 'confirmed_reopen_first', 409);

    const snapshot = { ...(unit.auto_snapshot || {}), ...(unit.edited_overrides || {}) };
    const lang = (req.body?.lang === 'en') ? 'en' : 'ko';
    const periodLabel = `${unit.period_type} ${unit.period_start}`;
    let out;
    try {
      out = await generateScrNarrative({ snapshot, scopeLabel: unit.scope, periodLabel, lang });
    } catch (e) {
      console.error('[report narrative]', e.message);
      return errorResponse(res, 'ai_failed', 502, 'ai_failed');
    }
    return successResponse(res, out);
  } catch (err) { next(err); }
});

// POST /:biz/unit/:id/confirm — 확정 (책임자). 현재 자동초안 fresh 재생성 후 박제.
router.post('/:biz/unit/:id/confirm', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { scope: uScope, member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    const unit = await ReportUnit.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!unit) return errorResponse(res, 'report_not_found', 404);
    if (!await isResponsible(uScope, unit.scope, unit.scope_ref_id, businessId, ownerOrAdmin)) return errorResponse(res, 'not_responsible', 403);
    if (unit.status === 'confirmed') return errorResponse(res, 'already_confirmed', 409);

    // 확정 시점 fresh 스냅샷 박제 (이후 수치 변동 무관). 리뷰 LOW — 대상이 삭제됐으면 확정 거부(404).
    const fresh = await buildAutoSnapshot(businessId, unit.scope, unit.scope_ref_id, unit.period_type, unit.period_start);
    if (fresh === null) return errorResponse(res, 'invalid_ref', 404);
    await unit.update({
      auto_snapshot: fresh,
      status: 'confirmed', confirmed_by: req.user.id, confirmed_at: new Date(), finalized_by: 'manual',
    });
    logAudit(req, { action: 'report_unit.confirm', targetType: 'report_unit', targetId: unit.id, businessId, newValue: { scope: unit.scope, ref_id: unit.scope_ref_id, period_type: unit.period_type, period_start: unit.period_start } });
    broadcastReport(req, businessId, unit, 'confirmed');
    return successResponse(res, mergedView(unit, true));
  } catch (err) { next(err); }
});

// POST /:biz/unit/:id/reopen — 되돌리기 (책임자). confirmed → draft.
router.post('/:biz/unit/:id/reopen', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { scope: uScope, member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    const unit = await ReportUnit.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
    if (!unit) return errorResponse(res, 'report_not_found', 404);
    if (!await isResponsible(uScope, unit.scope, unit.scope_ref_id, businessId, ownerOrAdmin)) return errorResponse(res, 'not_responsible', 403);
    if (unit.status !== 'confirmed') return errorResponse(res, 'not_confirmed', 409);

    await unit.update({ status: 'draft', confirmed_by: null, confirmed_at: null, finalized_by: null });
    logAudit(req, { action: 'report_unit.reopen', targetType: 'report_unit', targetId: unit.id, businessId });
    broadcastReport(req, businessId, unit, 'reopened');
    return successResponse(res, mergedView(unit, true));
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
// 통합 보고서 롤업 (R3, 마스터설계 §4.4·§6.2) — 확정본 자동 취합 + 통합확정
// ════════════════════════════════════════════════════════════════

// GET /:biz/integrated/periods?weeks=&months= — 기간별 보고서 목록(주간 N주 + 월간 N월) + 확정 상태
router.get('/:biz/integrated/periods', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    if (!businessId) return errorResponse(res, 'business_id_required', 400);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);

    const weeks = Math.min(Math.max(Number(req.query.weeks) || 8, 1), 26);
    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 24);
    const today = todayInTz('Asia/Seoul');
    const thisMonday = mondayOfDateStr(today);
    const weekStarts = Array.from({ length: weeks }, (_, i) => addDaysStr(thisMonday, -7 * i));
    const [y, m] = today.split('-').map(Number);
    const monthStarts = Array.from({ length: months }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
    });

    const units = await ReportUnit.findAll({
      where: {
        business_id: businessId, scope: 'workspace', scope_ref_id: 0,
        [Op.or]: [
          { period_type: 'weekly', period_start: { [Op.in]: weekStarts } },
          { period_type: 'monthly', period_start: { [Op.in]: monthStarts } },
        ],
      },
      attributes: ['period_type', 'period_start', 'status', 'confirmed_at', 'finalized_by'],
    });
    const key = (t, s) => `${t}:${String(s).slice(0, 10)}`;
    const map = new Map(units.map((u) => [key(u.period_type, u.period_start), u]));
    const row = (period_type) => (s) => {
      const u = map.get(key(period_type, s));
      return { period_type, period_start: s, status: u?.status || 'draft', confirmed_at: u?.confirmed_at || null, finalized_by: u?.finalized_by || null };
    };
    return successResponse(res, { weekly: weekStarts.map(row('weekly')), monthly: monthStarts.map(row('monthly')) });
  } catch (err) { next(err); }
});

// GET /:biz/integrated?period_type=&period_start= — 통합 롤업 (owner/admin 전용 view)
//   members[] 가 전 멤버 개인 보고 narrative 를 노출하므로 개인 프라이버시 게이트와 동일하게 owner/admin 한정.
router.get('/:biz/integrated', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    if (!businessId) return errorResponse(res, 'business_id_required', 400);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);

    const periodType = String(req.query.period_type || 'weekly');
    const periodStartRaw = String(req.query.period_start || '');
    if (!VALID_PERIOD.includes(periodType)) return errorResponse(res, 'invalid_period_type', 400);
    if (!DATE_RE.test(periodStartRaw)) return errorResponse(res, 'invalid_period_start', 400);
    const periodStart = normalizePeriodStart(periodType, periodStartRaw);

    const biz = await Business.findByPk(businessId, { attributes: ['report_integrated_confirm', 'monthly_finalize_enabled'] });
    const rollup = await buildIntegratedRollup(businessId, periodType, periodStart);
    // 통합 확정 단위의 서술(executive summary) 첨부
    const wsUnit = rollup.integrated.id ? await ReportUnit.findByPk(rollup.integrated.id, { attributes: ['narrative'] }) : null;
    return successResponse(res, {
      ...rollup,
      settings: { integrated_confirm: !!biz?.report_integrated_confirm, monthly_finalize: !!biz?.monthly_finalize_enabled },
      executive_summary: wsUnit?.narrative || '',
    });
  } catch (err) { next(err); }
});

// POST /:biz/integrated/share — 통합보고서 공개 링크 발급/재사용 (owner/admin). Body {period_type, period_start, dim?}
router.post('/:biz/integrated/share', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);
    const periodType = String(req.body?.period_type || 'weekly');
    const periodStartRaw = String(req.body?.period_start || '');
    const dim = req.body?.dim === 'member' ? 'member' : 'project';
    if (!VALID_PERIOD.includes(periodType)) return errorResponse(res, 'invalid_period_type', 400);
    if (!DATE_RE.test(periodStartRaw)) return errorResponse(res, 'invalid_period_start', 400);
    const periodStart = normalizePeriodStart(periodType, periodStartRaw);

    const [share] = await ReportShare.findOrCreate({
      where: { business_id: businessId, period_type: periodType, period_start: periodStart, dim },
      defaults: { token: crypto.randomBytes(24).toString('hex'), created_by: req.user.id },
    });
    logAudit(req, { action: 'report_integrated.share', targetType: 'report_share', targetId: share.id, businessId, newValue: { period_type: periodType, period_start: periodStart, dim } });
    const appUrl = process.env.APP_URL || 'https://dev.planq.kr';
    return successResponse(res, { token: share.token, share_url: `${appUrl}/public/report/${share.token}` });
  } catch (err) { next(err); }
});

// DELETE /:biz/integrated/share/:token — 공개 링크 취소 (owner/admin)
router.delete('/:biz/integrated/share/:token', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);
    const share = await ReportShare.findOne({ where: { token: String(req.params.token), business_id: businessId } });
    if (!share) return errorResponse(res, 'share_not_found', 404);
    await share.destroy();
    logAudit(req, { action: 'report_integrated.unshare', targetType: 'report_share', targetId: share.id, businessId });
    return successResponse(res, { revoked: true });
  } catch (err) { next(err); }
});

// GET /:biz/integrated/share?period_type=&period_start=&dim= — 현재 발급된 공유 토큰 조회 (owner/admin)
router.get('/:biz/integrated/share', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);
    const periodType = String(req.query.period_type || 'weekly');
    const periodStartRaw = String(req.query.period_start || '');
    const dim = req.query.dim === 'member' ? 'member' : 'project';
    if (!DATE_RE.test(periodStartRaw)) return errorResponse(res, 'invalid_period_start', 400);
    const periodStart = normalizePeriodStart(periodType, periodStartRaw);
    const share = await ReportShare.findOne({ where: { business_id: businessId, period_type: periodType, period_start: periodStart, dim } });
    if (!share) return successResponse(res, { token: null });
    const appUrl = process.env.APP_URL || 'https://dev.planq.kr';
    return successResponse(res, { token: share.token, share_url: `${appUrl}/public/report/${share.token}` });
  } catch (err) { next(err); }
});

// POST /:biz/integrated/confirm — 통합 확정 (owner/admin, report_integrated_confirm ON 일 때만)
router.post('/:biz/integrated/confirm', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);
    const periodType = String(req.body?.period_type || 'weekly');
    const periodStartRaw = String(req.body?.period_start || '');
    if (!VALID_PERIOD.includes(periodType)) return errorResponse(res, 'invalid_period_type', 400);
    if (!DATE_RE.test(periodStartRaw)) return errorResponse(res, 'invalid_period_start', 400);
    const periodStart = normalizePeriodStart(periodType, periodStartRaw);

    const biz = await Business.findByPk(businessId, { attributes: ['report_integrated_confirm'] });
    if (!biz?.report_integrated_confirm) return errorResponse(res, 'integrated_confirm_disabled', 409);

    const rollup = await buildIntegratedRollup(businessId, periodType, periodStart);
    const [unit] = await ReportUnit.findOrCreate({
      where: { business_id: businessId, scope: 'workspace', scope_ref_id: 0, period_type: periodType, period_start: periodStart },
      defaults: { status: 'draft', auto_snapshot: rollup },
    });
    const patch = {
      auto_snapshot: rollup, status: 'confirmed',
      confirmed_by: req.user.id, confirmed_at: new Date(), finalized_by: 'manual',
    };
    if (typeof req.body?.executive_summary === 'string') patch.narrative = req.body.executive_summary.slice(0, 20000);
    await unit.update(patch);
    logAudit(req, { action: 'report_integrated.confirm', targetType: 'report_unit', targetId: unit.id, businessId, newValue: { period_type: periodType, period_start: periodStart } });
    broadcastReport(req, businessId, unit, 'integrated_confirmed');
    return successResponse(res, { id: unit.id, status: unit.status });
  } catch (err) { next(err); }
});

// POST /:biz/integrated/reopen — 통합 확정 되돌리기 (owner/admin)
router.post('/:biz/integrated/reopen', authenticateToken, async (req, res, next) => {
  try {
    const businessId = Number(req.params.biz);
    const { member, ownerOrAdmin } = await loadScope(req, businessId);
    if (!member) return errorResponse(res, 'member_only', 403);
    if (!ownerOrAdmin) return errorResponse(res, 'owner_or_admin_only', 403);
    const periodType = String(req.body?.period_type || 'weekly');
    const periodStartRaw = String(req.body?.period_start || '');
    const periodStart = DATE_RE.test(periodStartRaw) ? normalizePeriodStart(periodType, periodStartRaw) : periodStartRaw;
    const unit = await ReportUnit.findOne({ where: { business_id: businessId, scope: 'workspace', scope_ref_id: 0, period_type: periodType, period_start: periodStart } });
    if (!unit || unit.status !== 'confirmed') return errorResponse(res, 'not_confirmed', 409);
    await unit.update({ status: 'draft', confirmed_by: null, confirmed_at: null, finalized_by: null });
    logAudit(req, { action: 'report_integrated.reopen', targetType: 'report_unit', targetId: unit.id, businessId });
    broadcastReport(req, businessId, unit, 'integrated_reopened');
    return successResponse(res, { id: unit.id, status: unit.status });
  } catch (err) { next(err); }
});

module.exports = router;
