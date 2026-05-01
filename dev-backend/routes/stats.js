// 사이클 Q-G — Insights 통계 페이지 (`/insights`) API.
//
// 네임스페이스: /api/stats/* (기존 /api/insights/* Cue 인박스 카드와 분리)
// MVP: GET /:businessId/tasks (Tasks & Time 탭)
// Phase 2: people / overview / revenue / clients / projects
//
// 권한: authenticateToken + checkBusinessAccess (owner / member 모두 GET 가능. role 별 응답 필터링은 추후)
//
// 응답 표준: { success, data: { kpis, charts, insights, filters_applied, ... } }

const express = require('express');
const router = express.Router();
const { Op, fn, col, literal } = require('sequelize');
const {
  Task, TaskEstimation, BusinessMember, User, Project, sequelize,
} = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const stats = require('../services/stats');

// 기간 파싱 — ?from=YYYY-MM-DD&to=YYYY-MM-DD or ?range=30d|90d|month|prev-month|quarter
function parsePeriod(q) {
  const today = new Date();
  const toIso = (d) => d.toISOString().slice(0, 10);

  if (q.from && q.to) {
    return { from: q.from, to: q.to, label: `${q.from}~${q.to}` };
  }

  const range = String(q.range || '30d');
  const t = new Date(today);
  switch (range) {
    case '7d':  t.setDate(t.getDate() - 7); return { from: toIso(t), to: toIso(today), label: 'Last 7 days' };
    case '30d': t.setDate(t.getDate() - 30); return { from: toIso(t), to: toIso(today), label: 'Last 30 days' };
    case '90d': t.setDate(t.getDate() - 90); return { from: toIso(t), to: toIso(today), label: 'Last 90 days' };
    case 'month': {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toIso(m), to: toIso(today), label: 'This month' };
    }
    case 'prev-month': {
      const m = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: toIso(m), to: toIso(e), label: 'Last month' };
    }
    case 'quarter': {
      const q0 = Math.floor(today.getMonth() / 3) * 3;
      const m = new Date(today.getFullYear(), q0, 1);
      return { from: toIso(m), to: toIso(today), label: 'This quarter' };
    }
    default: {
      t.setDate(t.getDate() - 30);
      return { from: toIso(t), to: toIso(today), label: 'Last 30 days' };
    }
  }
}

// 같은 길이의 직전 기간 — 비교 모드 (compare=prev)
function prevPeriod(period) {
  const fromDt = new Date(period.from);
  const toDt = new Date(period.to);
  const days = Math.max(1, Math.round((toDt - fromDt) / 86400000));
  const prevTo = new Date(fromDt);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - days);
  const toIso = (d) => d.toISOString().slice(0, 10);
  return { from: toIso(prevFrom), to: toIso(prevTo) };
}

// ============================================
// GET /api/stats/:businessId/tasks
//
// 응답:
//   kpis: {
//     completed: { value, prev, delta_pct },
//     created:   { ... },
//     leadtime_p50_days: { ... },
//     leadtime_p90_days: { ... },
//     bias_pct:  { ... },   // (Σactual - Σuser_estimate) / Σactual × 100
//     ai_accuracy_pct: { ... }, // 1 - MAPE
//   }
//   scatter: [{ task_id, title, assignee_id, assignee_name, user_estimate, actual, accuracy_pct }]
//   ai_trend: [{ month, ai_mape, user_mape, n }]
//   funnel: { not_started, in_progress, reviewing, completed, canceled }
//   sources: { manual, internal_request, qtalk_extract }
//   categories_pareto: [{ category, count, pct, cumulative_pct }]
//   table: [{ task_id, title, assignee, category, user_est, ai_est, actual, accuracy_pct, bias, leadtime_days, status }]
//   insights: [{ severity, title, value, action_label, action_link }]
//   filters_applied: { from, to, assignee_id?, category?, source? }
// ============================================
router.get('/:businessId/tasks', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = req.businessId;
    const period = parsePeriod(req.query);
    const compare = req.query.compare === 'prev';
    const prev = compare ? prevPeriod(period) : null;

    const where = {
      business_id: businessId,
      created_at: { [Op.between]: [period.from + ' 00:00:00', period.to + ' 23:59:59'] },
    };
    if (req.query.assignee_id) where.assignee_id = Number(req.query.assignee_id);
    if (req.query.category) where.category = String(req.query.category);
    if (req.query.source) where.source = String(req.query.source);

    const tasks = await Task.findAll({
      where,
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name'], required: false },
      ],
      order: [['created_at', 'DESC']],
      limit: 2000, // 안전 가드
    });

    // 같은 task 의 ai 추정 — 가장 최신
    const taskIds = tasks.map((t) => t.id);
    let aiByTask = {};
    if (taskIds.length) {
      const ests = await TaskEstimation.findAll({
        where: { task_id: { [Op.in]: taskIds }, source: 'ai' },
        order: [['created_at', 'DESC']],
      });
      for (const e of ests) {
        if (!aiByTask[e.task_id]) aiByTask[e.task_id] = Number(e.value);
      }
    }

    // 비교 기간 (compare=prev) — completed/created 카운트만
    let prevAgg = null;
    if (prev) {
      prevAgg = await stats.aggregateTaskCounts(businessId, prev);
    }

    const result = stats.buildTasksTab({ tasks, aiByTask, period, prevAgg });
    return successResponse(res, result);
  } catch (err) { next(err); }
});

// ============================================
// GET /api/stats/:businessId/overview
router.get('/:businessId/overview', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const period = parsePeriod(req.query);
    const data = await stats.buildOverviewTab(req.businessId, period);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// GET /api/stats/:businessId/profit
router.get('/:businessId/profit', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const period = parsePeriod(req.query);
    const data = await stats.buildProfitTab(req.businessId, period);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// GET /api/stats/:businessId/team
router.get('/:businessId/team', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const period = parsePeriod(req.query);
    const data = await stats.buildTeamTab(req.businessId, period);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// GET /api/stats/:businessId/finance
router.get('/:businessId/finance', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const period = parsePeriod(req.query);
    const data = await stats.buildFinanceTab(req.businessId, period);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// GET /api/stats/:businessId/reports
router.get('/:businessId/reports', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const data = await stats.buildReportsTab(req.businessId);
    return successResponse(res, data);
  } catch (err) { next(err); }
});

// POST /api/stats/:businessId/reports — 즉시 생성 (kind=monthly|quarterly|yearly|adhoc, 옵션: from/to)
router.post('/:businessId/reports', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const reportGenerator = require('../services/report_generator');
    const kind = String(req.body.kind || 'monthly');
    if (!['monthly', 'quarterly', 'yearly', 'adhoc'].includes(kind)) {
      return errorResponse(res, 400, 'invalid_kind');
    }
    const customPeriod = (req.body.from && req.body.to)
      ? { from: String(req.body.from), to: String(req.body.to) }
      : null;
    const report = await reportGenerator.generateReport({
      businessId: req.businessId,
      kind,
      period: customPeriod,
      generatedBy: req.user?.userId || req.user?.id || null,
    });
    return successResponse(res, {
      id: report.id,
      kind: report.kind,
      title: report.title,
      period_from: report.period_start,
      period_to: report.period_end,
      created_at: report.created_at,
      status: report.status,
      pdf_url: report.status === 'ready' ? `/api/stats/${req.businessId}/reports/${report.id}/pdf` : null,
      share_url: report.share_token ? `/api/reports/share/${report.share_token}` : null,
    });
  } catch (err) { next(err); }
});

// GET /api/stats/:businessId/reports/:id/pdf — 인증 사용자 다운로드
router.get('/:businessId/reports/:id/pdf', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { Report } = require('../models');
    const report = await Report.findOne({
      where: { id: Number(req.params.id), business_id: req.businessId },
    });
    if (!report) return errorResponse(res, 404, 'report_not_found');
    if (report.status !== 'ready' || !report.pdf_url) {
      return errorResponse(res, 409, `report_not_ready (${report.status})`);
    }
    const fs = require('fs');
    if (!fs.existsSync(report.pdf_url)) {
      return errorResponse(res, 410, 'pdf_file_missing');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(report.title || `report-${report.id}`)}.pdf"`);
    return fs.createReadStream(report.pdf_url).pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
