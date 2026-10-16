// routes/survey_manage.js — 설문 v2 «발행» 관리 (`/api/surveys/:recordId/...`, 인증). 설계 docs/SURVEY_V2_DESIGN.md §5
//
// records.js 가 500줄에 닿아 새 파일로 뗐다. 마운트: server.js `/api/surveys` (무인증 `/api/survey` 와 다른 접두어 — 혼동 주의).
// ★ 권한은 services/surveyAccess.canManageSurvey 한 곳(설정 라우트 records.js 와 같은 함수) — 멤버 이상 ∧ 문서 편집 가능.
// ★ 개인 열쇠는 어느 응답에도 안 싣는다(serializeIssue · SurveyRecipient.toJSON). 관리 화면은 [다시 보내기]·[회수]만 한다.
// ★ 외부 발송 — 화면이 ConfirmDialog 로 주소를 보여 준 뒤에만 부른다(CLAUDE.md «외부 발송은 확인»). 서버는 판정·한도·기록.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const { logAudit } = require('../services/auditService');
const { blocksExternalShare } = require('../services/securityLevel');
const { canManageSurvey } = require('../services/surveyAccess');
const survey = require('../services/survey');
const issueSvc = require('../services/surveyIssue');

const sendLimit = perUserDaily('survey-send', { perMin: 5, perDay: 200 });

/** 공통 — 표 + 관리 권한 + 설문 문서인지. 실패는 응답을 쓰고 null. */
async function loadManaged(req, res) {
  const { QRecord } = require('../models');
  const id = Number(req.params.recordId);
  if (!Number.isInteger(id) || id <= 0) { errorResponse(res, 'not_found', 404); return null; }
  const record = await QRecord.findByPk(id);
  if (!record) { errorResponse(res, 'not_found', 404); return null; }
  const m = await canManageSurvey(req.user, record);
  if (!m.ok) { errorResponse(res, 'forbidden', 403); return null; }
  return { record, post: m.post };
}

async function quotaOf(businessId) {
  const plan = require('../services/plan');
  const limits = await plan.getEffectiveLimits(businessId);
  const max = limits.survey_sends_monthly === undefined ? Infinity : limits.survey_sends_monthly;
  const used = await plan.getSurveySendsThisMonth(businessId);
  return { limit: max === Infinity ? null : max, used, remaining: max === Infinity ? null : Math.max(0, max - used) };
}

// GET /:recordId/issues — 회차 목록(최신 먼저) + 이달 발송 한도
router.get('/:recordId/issues', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadManaged(req, res); if (!ctx) return undefined;
    const { SurveyIssue, SurveyRecipient } = require('../models');
    const issues = await SurveyIssue.findAll({ where: { q_record_id: ctx.record.id, business_id: ctx.record.business_id }, order: [['id', 'DESC']], limit: 200 });
    const recs = issues.length ? await SurveyRecipient.findAll({ where: { issue_id: issues.map((i) => i.id) }, order: [['id', 'ASC']] }) : [];
    const byIssue = new Map();
    for (const r of recs) { if (!byIssue.has(r.issue_id)) byIssue.set(r.issue_id, []); byIssue.get(r.issue_id).push(r); }
    return successResponse(res, {
      issues: issues.map((i) => issueSvc.serializeIssue(i, byIssue.get(i.id) || [])),
      quota: await quotaOf(ctx.record.business_id),
    });
  } catch (e) { return next(e); }
});

// GET /:recordId/candidates?project_id= — 보내기 모달의 받는 사람 후보(이 워크스페이스 고객, 보낼 주소 유무 표시)
router.get('/:recordId/candidates', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadManaged(req, res); if (!ctx) return undefined;
    const { Client, ProjectClient, Project, User } = require('../models');
    const { primaryEmailOf, displayNameOf } = require('../services/clientContact');
    const bizId = ctx.record.business_id;
    let clientIds = null;
    const pid = Number(req.query.project_id);
    if (Number.isInteger(pid) && pid > 0) {
      const p = await Project.findOne({ where: { id: pid, business_id: bizId }, attributes: ['id'] });
      if (!p || !(await require('../middleware/access_scope').userCanSeeProject(req.user.id, bizId, p.id, req.user.platform_role))) return errorResponse(res, 'invalid project_id', 400);
      const pcs = await ProjectClient.findAll({ where: { project_id: pid, client_id: { [Op.ne]: null } }, attributes: ['client_id'] });
      clientIds = [...new Set(pcs.map((x) => x.client_id))];
    }
    const where = { business_id: bizId, status: { [Op.ne]: 'archived' } };
    if (clientIds) where.id = clientIds;
    const clients = await Client.findAll({ where, order: [['id', 'DESC']], limit: 1000 });
    const users = await User.findAll({ where: { id: clients.map((c) => c.user_id).filter(Boolean) }, attributes: ['id', 'email'] });
    const uById = new Map(users.map((u) => [u.id, u]));
    const out = [];
    for (const c of clients) {
      // eslint-disable-next-line no-await-in-loop
      const email = await primaryEmailOf(c, null, c.user_id ? (uById.get(c.user_id) || null) : null);
      out.push({ id: c.id, name: displayNameOf(c) || `#${c.id}`, company: c.company_name || null, email, status: c.status });
    }
    // 보이는 프로젝트만(2026-10-16 프로젝트 가시성 — access_scope 한 곳)
    const { getUserScope, projectScopeWhere } = require('../middleware/access_scope');
    const visP = projectScopeWhere(await getUserScope(req.user.id, bizId, req.user.platform_role), 'id');
    const projects = await Project.findAll({ where: { business_id: bizId, status: { [Op.ne]: 'closed' }, ...(visP ? { [Op.and]: [visP] } : {}) }, attributes: ['id', 'name'], order: [['id', 'DESC']], limit: 300 });
    return successResponse(res, { clients: out, projects: projects.map((p) => ({ id: p.id, name: p.name })), quota: await quotaOf(bizId) });
  } catch (e) { return next(e); }
});

// GET /:recordId/preview — 응답 화면 미리보기(공개 GET 과 같은 모양, 제출 불가)
router.get('/:recordId/preview', authenticateToken, async (req, res, next) => {
  try {
    const ctx = await loadManaged(req, res); if (!ctx) return undefined;
    const { Business } = require('../models');
    const biz = await Business.findByPk(ctx.record.business_id, { attributes: ['name', 'brand_name'] });
    const { questionnaireView } = require('./survey_public');
    return successResponse(res, { ...questionnaireView({ record: ctx.record, post: ctx.post, business: biz, settings: survey.settingsOf(ctx.record), recipient: null }), preview: true });
  } catch (e) { return next(e); }
});

// POST /:recordId/issues — 수동 보내기 { client_ids?, emails?, title?, message?, closes_at? }
router.post('/:recordId/issues', authenticateToken, sendLimit, async (req, res, next) => { // audit-exempt: 아래에서 logAudit(survey.issue_send)
  try {
    const ctx = await loadManaged(req, res); if (!ctx) return undefined;
    const { record, post } = ctx;
    if (post.kind !== 'survey') return errorResponse(res, 'not_survey', 409);
    if (post.status && post.status !== 'published') return errorResponse(res, 'not_published', 409);
    if (blocksExternalShare(post)) return errorResponse(res, 'security_level_blocks', 409);
    const body = req.body || {};
    let closesAt = null;
    if (body.closes_at) {
      const d = new Date(body.closes_at);
      if (Number.isNaN(d.getTime())) return errorResponse(res, 'invalid_closes_at', 400);
      if (d.getTime() <= Date.now()) return errorResponse(res, 'closes_at_past', 400);
      closesAt = d;
    }
    let recipients;
    try {
      recipients = await issueSvc.resolveRecipients(record.business_id, { clientIds: body.client_ids, emails: body.emails });
    } catch (e) {
      if (e instanceof issueSvc.IssueError) return res.status(e.status).json({ success: false, message: e.code, ...(e.extra || {}) });
      throw e;
    }
    const plan = require('../services/plan');
    const can = await plan.can(record.business_id, 'send_survey', { count: recipients.length });
    if (!can.ok) return res.status(409).json({ success: false, message: can.reason === 'survey_quota_exceeded' ? 'quota_exceeded' : can.reason, limit: can.limit ?? null, current: can.current ?? null });

    const r = await issueSvc.createManualIssue({
      record, post, userId: req.user.id, recipients,
      title: body.title ? String(body.title).trim() : null,
      message: body.message ? String(body.message).trim() : null,
      closesAt,
    });
    logAudit(req, { action: 'survey.issue_send', targetType: 'survey_issue', targetId: r.issue.id, businessId: record.business_id, newValue: { q_record_id: record.id, post_id: post.id, recipients: r.recipients } });
    const { SurveyRecipient } = require('../models');
    const recs = await SurveyRecipient.findAll({ where: { issue_id: r.issue.id }, order: [['id', 'ASC']] });
    return successResponse(res, { issue: issueSvc.serializeIssue(r.issue, recs), background: r.background }, 'sent', 201);
  } catch (e) { return next(e); }
});

// POST /:recordId/issues/:issueId/resend { recipient_ids?: number[] } — 없으면 «미응답 전원»(보냄·실패, 회수 제외)
router.post('/:recordId/issues/:issueId/resend', authenticateToken, sendLimit, async (req, res, next) => { // audit-exempt: 아래에서 logAudit(survey.issue_resend)
  try {
    const ctx = await loadManaged(req, res); if (!ctx) return undefined;
    const { SurveyIssue, SurveyRecipient } = require('../models');
    if (blocksExternalShare(ctx.post)) return errorResponse(res, 'security_level_blocks', 409);
    const issue = await SurveyIssue.findOne({ where: { id: Number(req.params.issueId), q_record_id: ctx.record.id, business_id: ctx.record.business_id } });
    if (!issue) return errorResponse(res, 'not_found', 404);
    if (issue.status !== 'sent') return errorResponse(res, 'issue_not_sent', 409);
    if (issue.closes_at && new Date(issue.closes_at).getTime() <= Date.now()) return errorResponse(res, 'survey_closed', 409);
    const where = { issue_id: issue.id, token: { [Op.ne]: null }, status: { [Op.in]: ['sent', 'failed'] } };
    const ids = Array.isArray(req.body?.recipient_ids) ? req.body.recipient_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : null;
    if (ids) where.id = ids;
    const targets = await SurveyRecipient.findAll({ where, attributes: ['id'] });
    if (!targets.length) return errorResponse(res, 'no_recipients', 400);
    const result = await issueSvc.sendIssue(issue, { initiatedBy: req.user.id, only: targets.map((x) => x.id) });
    logAudit(req, { action: 'survey.issue_resend', targetType: 'survey_issue', targetId: issue.id, businessId: ctx.record.business_id, newValue: { count: targets.length } });
    const recs = await SurveyRecipient.findAll({ where: { issue_id: issue.id }, order: [['id', 'ASC']] });
    return successResponse(res, { issue: issueSvc.serializeIssue(issue, recs), ...result });
  } catch (e) { return next(e); }
});

// POST /:recordId/recipients/:recipientId/revoke — 이 사람의 개인 링크를 죽인다(받는 사람 줄은 남는다)
router.post('/:recordId/recipients/:recipientId/revoke', authenticateToken, async (req, res, next) => { // audit-exempt: 아래에서 logAudit(survey.recipient_revoke)
  try {
    const ctx = await loadManaged(req, res); if (!ctx) return undefined;
    const { SurveyIssue, SurveyRecipient } = require('../models');
    const rc = await SurveyRecipient.findOne({ where: { id: Number(req.params.recipientId), business_id: ctx.record.business_id } });
    if (!rc) return errorResponse(res, 'not_found', 404);
    const issue = await SurveyIssue.findOne({ where: { id: rc.issue_id, q_record_id: ctx.record.id } });
    if (!issue) return errorResponse(res, 'not_found', 404);
    if (rc.token) await rc.update({ token: null, revoked_at: new Date() });
    logAudit(req, { action: 'survey.recipient_revoke', targetType: 'survey_recipient', targetId: rc.id, businessId: ctx.record.business_id });
    const recs = await SurveyRecipient.findAll({ where: { issue_id: issue.id }, order: [['id', 'ASC']] });
    return successResponse(res, { issue: issueSvc.serializeIssue(issue, recs) });
  } catch (e) { return next(e); }
});

module.exports = router;
