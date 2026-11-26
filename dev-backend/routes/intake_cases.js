// routes/intake_cases.js — 접수 양식 응답 → [사건 만들기] (2026-11-26 · 설계 docs/INTAKE_AUTO_CASE_DESIGN.md §6)
//   판정·만들기는 services/intakeCase 한 곳 — 여기는 입력·응답 모양만.
//   권한: 로그인 + 그 응답을 볼 수 있는 멤버 이상(고객·AI·다른 워크스페이스는 404/403 — 서비스가 행→표→워크스페이스를 서버에서 다시 본다).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const intake = require('../services/intakeCase');

const fail = (res, next, e) => {
  if (e instanceof intake.IntakeError) {
    return res.status(e.status).json({ success: false, message: e.code, code: e.code, ...(e.extra || {}) });
  }
  return next(e);
};

// GET /api/intake/rows/:rowId — 미리보기(만들어질 이름·템플릿·고객 후보·이미 만든 사건)
router.get('/rows/:rowId', authenticateToken, async (req, res, next) => {
  try { return successResponse(res, await intake.preview(req.user, req.params.rowId)); } catch (e) { return fail(res, next, e); }
});

// POST /api/intake/rows/:rowId/case — { client_choice: 'link'|'new'|'none', client_id? }
router.post('/rows/:rowId/case', authenticateToken, // audit-exempt: services/intakeCase 가 intake.case_create(+ project.create)를 남긴다
  perUserLimiter('intake-case', { windowMs: 60 * 1000, max: 20 }),
  async (req, res, next) => {
    try {
      const r = await intake.createCase(req.user, req.params.rowId, req.body || {}, { req });
      return successResponse(res, r, r.replayed ? 'already_created' : 'created', r.replayed ? 200 : 201);
    } catch (e) { return fail(res, next, e); }
  });

// GET /api/intake/records/:recordId/cases?row_ids=1,2,3 — 응답 목록 줄마다 사건 표시
router.get('/records/:recordId/cases', authenticateToken, async (req, res, next) => {
  try {
    const { QRecord } = require('../models');
    const rid = Number(req.params.recordId);
    if (!Number.isInteger(rid) || rid <= 0) return errorResponse(res, 'not_found', 404);
    const record = await QRecord.findByPk(rid);
    if (!record) return errorResponse(res, 'not_found', 404);
    const { canViewSurveyResponses, isMemberUp } = require('../services/surveyAccess');
    const v = await canViewSurveyResponses(req.user, record);
    if (!v.ok) return errorResponse(res, 'not_found', 404);
    if (!(await isMemberUp(req.user, record.business_id))) return errorResponse(res, 'forbidden', 403);
    // 줄 id 는 화면이 보낸 것(최대 500) — 이 표의 줄만 남기는 것은 서비스가 한다
    const asked = String(req.query.row_ids || '').split(',');
    const settings = require('../services/survey').settingsOf(record);
    const it = intake.normalizeIntake(record, settings.intake, {});
    return successResponse(res, { enabled: it.mode === 'review', cases: await intake.casesForRows(record, asked), orphans: await intake.orphanCases(record) });
  } catch (e) { return next(e); }
});

module.exports = router;
