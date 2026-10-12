// routes/survey_public.js — 설문(#460·v2) **무인증** 표면 (`/api/survey/:token`). 설계 docs/SURVEY_DESIGN.md · docs/SURVEY_V2_DESIGN.md
// ★ 열쇠 두 종류(공개 링크·개인 열쇠)를 같은 두 라우트가 받는다 — 판정은 resolveSurveyToken 한 곳.
//
// ★ 할 수 있는 것은 정확히 두 가지 — 질문지 읽기, 응답 1건 쓰기. 응답을 읽는 경로는 없다.
// ★ 모든 판정은 services/survey.js 한 곳(resolveSurveyToken·validateAnswers). 여기는 한도·입력·응답 모양만.
// ★ 레이트리밋 주 키는 **토큰**이다(guest_common.guestLimiter) — 사무실·행사장 와이파이 50명이 한 IP 로 1분에
//   제출하는 것은 정상이다. IP 는 느슨한 보조 한도(Fable 수정 6).
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { guestLimiter } = require('./guest_common');
const survey = require('../services/survey');

const MAX_BODY = 64 * 1024;   // 전역 express.json(10mb) 이 먼저 읽으므로 content-length 로 미리 거른다

const ipLimiter = (name, windowMs, max) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (r) => `${name}-${ipKeyGenerator(r.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});

const fail = (res, next, e) => (e instanceof survey.SurveyError ? errorResponse(res, e.code, e.status) : next(e));

/**
 * 질문지 응답 모양 — 공개 GET 과 관리 미리보기(survey_manage.js)가 **같은 함수**를 쓴다(미리보기가 실제와 갈라지지 않게).
 * 설문(kind='survey')은 제목 = 문서 제목, 설명 = 문서 본문(HTML — 화면이 sanitize 한다). 옛 표-설문은 서랍의 제목·안내문.
 * 싣지 않는 것: 응답·응답 수·숫자 id·프로젝트 정보·열쇠.
 */
function questionnaireView({ record, post, business, settings, recipient }) {
  const isSurvey = post.kind === 'survey';
  let descriptionHtml = '';
  if (isSurvey) {
    try {
      const { richBodyToHtml } = require('../services/pdfTemplates');
      descriptionHtml = String(richBodyToHtml(post.content_json, null, null) || '').slice(0, 50000);
    } catch { descriptionHtml = ''; }
  }
  return {
    title: isSurvey ? (post.title || '') : (settings.title || post.title || ''),
    intro: isSurvey ? '' : (settings.intro || ''),
    description_html: descriptionHtml,
    // 수집 주체 고지 — 응답이 어디로 가는지 알아야 답할 수 있다
    workspace_name: business.brand_name || business.name || '',
    closes_at: settings.closes_at || null,
    thanks: settings.thanks || '',
    // 개인 열쇠이고 익명이 아닐 때만 «OO님» 인사
    hello_name: recipient && !settings.anonymous ? (recipient.display_name || null) : null,
    personal: !!recipient,
    questions: survey.questionsOf(record, post.kind),
  };
}

// ── GET /api/survey/:token — 질문지 ─────────────────────────────────────────
router.get('/:token',
  guestLimiter('survey-get', { windowMs: 60 * 1000, max: 120 }),
  ipLimiter('survey-get-ip', 60 * 1000, 120),
  async (req, res, next) => {
    try {
      const ctx = await survey.resolveSurveyToken(req.params.token);
      // 개인 열쇠 — 처음 연 시각만 남긴다(열람률). 값은 관리 화면 회차 행에만 보인다
      if (ctx.recipient && !ctx.recipient.opened_at) {
        ctx.recipient.update({ opened_at: new Date() }).catch(() => { /* 열람 기록 실패로 질문지를 막지 않는다 */ });
      }
      res.set('Cache-Control', 'no-store');
      // 회차 마감이 질문지 마감보다 이르면 그쪽을 보여 준다
      const view = questionnaireView(ctx);
      if (ctx.issue && ctx.issue.closes_at && (!view.closes_at || new Date(ctx.issue.closes_at) < new Date(view.closes_at))) view.closes_at = ctx.issue.closes_at;
      return successResponse(res, view);
    } catch (e) { return fail(res, next, e); }
  });

// ── POST /api/survey/:token/responses — 응답 1건 ────────────────────────────
router.post('/:token/responses', // audit-exempt: 응답 1건 원장은 q_record_audits(row.survey) — 외부 응답 값은 AuditLog 에 싣지 않는다(표의 기존 규칙)
  guestLimiter('survey-post', { windowMs: 60 * 1000, max: 60 }),
  guestLimiter('survey-post-day', { windowMs: 24 * 60 * 60 * 1000, max: 2000 }),
  ipLimiter('survey-post-ip', 60 * 1000, 20),
  ipLimiter('survey-post-ip-h', 60 * 60 * 1000, 300),
  async (req, res, next) => {
    try {
      if (Number(req.headers['content-length'] || 0) > MAX_BODY) return errorResponse(res, 'payload_too_large', 413);
      const ctx = await survey.resolveSurveyToken(req.params.token);
      const body = req.body || {};
      // 꿀단지 — 사람에게는 안 보이는 칸. 채워져 있으면 저장하지 않고 성공처럼 답한다(봇에게 신호를 주지 않는다)
      if (body.website) return successResponse(res, { ok: true }, 'received', 201);
      const values = survey.validateAnswers(survey.questionsOf(ctx.record, ctx.post.kind), body.answers);
      if (!Object.keys(values).length) return errorResponse(res, 'empty_response', 400);

      const { QRecordRow, QRecordAudit, SurveyRecipient } = require('../models');
      const { sequelize } = require('../config/database');
      // 개인 열쇠는 응답 1회 — «응답함» 표시를 조건부 UPDATE 로 먼저 잡는다(동시 두 번 제출이 둘 다 들어가지 않게).
      //   익명이면 줄에 받는 사람을 잇지 않는다(회차는 남긴다 — 응답률은 셀 수 있다, 설계 §5.2).
      const anonymous = !!ctx.settings.anonymous;
      const row = await sequelize.transaction(async (t) => {
        if (ctx.recipient) {
          const [n] = await SurveyRecipient.update(
            { status: 'responded', responded_at: new Date() },
            { where: { id: ctx.recipient.id, responded_at: null, token: req.params.token }, transaction: t },
          );
          if (n !== 1) throw new survey.SurveyError('already_responded', 410);
        }
        const last = await QRecordRow.max('position', { where: { q_record_id: ctx.record.id }, transaction: t });
        return QRecordRow.create({
          q_record_id: ctx.record.id, values, position: (last || 0) + 1, created_by: null,
          survey_issue_id: ctx.issue ? ctx.issue.id : null,
          survey_recipient_id: ctx.recipient && !anonymous ? ctx.recipient.id : null,
        }, { transaction: t });
      });
      // 감사 — 값은 싣지 않는다(표의 기존 규칙: 셀 값·비밀 칸은 감사 원장에 남기지 않는다)
      await QRecordAudit.create({ q_record_id: ctx.record.id, q_record_row_id: row.id, user_id: null, action: 'row.survey' });

      // 실시간 — 신호만(id 들). 받는 화면이 다시 읽는다
      try {
        const io = req.app.get('io');
        if (io) io.to(`business:${ctx.record.business_id}`).emit('record:row', { id: ctx.record.id, business_id: ctx.record.business_id, project_id: ctx.record.project_id || null });
      } catch { /* 방송 실패로 응답을 막지 않는다 */ }
      notifyOwner(req, ctx).catch((e) => console.warn('[survey notify]', e.message));
      return successResponse(res, { ok: true }, 'received', 201);
    } catch (e) { return fail(res, next, e); }
  });

// 새 응답 알림 — 켠 사람(떠났으면 문서 작성자)에게 앱 알림만. 같은 설문은 10분에 1건(DB 기준 — 재시작에도 두 통이 안 간다)
async function notifyOwner(req, { record, post, settings }) {
  const { Notification, BusinessMember } = require('../models');
  const { Op } = require('sequelize');
  let userId = settings.owner_id || null;
  if (userId) {
    const bm = await BusinessMember.findOne({ where: { business_id: record.business_id, user_id: userId, removed_at: null }, attributes: ['id'] });
    if (!bm) userId = null;
  }
  if (!userId) userId = post.author_id;
  if (!userId) return;
  const recent = await Notification.findOne({
    where: { user_id: userId, event_kind: 'survey', entity_type: 'q_record', entity_id: record.id, created_at: { [Op.gte]: new Date(Date.now() - 10 * 60 * 1000) } },
    attributes: ['id'],
  });
  if (recent) return;
  const { notify } = require('./notifications');
  const title = String(settings.title || post.title || '').slice(0, 80);
  await notify({
    userId,
    businessId: record.business_id,
    eventKind: 'survey',
    title: (lang) => (lang === 'en' ? `New survey response — ${title}` : `설문 새 응답 — ${title}`),
    body: (lang) => (lang === 'en' ? 'A new response has arrived. Open the survey to see it.' : '새 응답이 들어왔습니다. 응답에서 확인하세요.'),
    link: `/docs?post=${post.id}`,
    ctaLabel: (lang) => (lang === 'en' ? 'View responses' : '응답 보기'),
    entityType: 'q_record',
    entityId: record.id,
    skipChannels: ['email'],
    ioApp: req.app,
  });
}

module.exports = router;
module.exports.questionnaireView = questionnaireView;
