// 플랫폼 관리자 > Cue 질문 분석 (2026-10-07, Fable 판정 B5).
//   «무엇을 많이 묻는가» — 주제·의도·답변 여부 통계 + 분류 안 된 질문의 가명 원문(30일, 워크스페이스 opt-in 분).
//   ★ platform_admin 전용 · 내보내기 없음 · 화면은 텍스트로만 그린다(저장형 XSS 차단).
//   ★ 응답에 user_id·business_id 가 없다 — 원장에 애초에 없다(services/cueQuestionAnalysis.js).
//
//   GET    /api/admin/cue-questions?days=30     통계
//   GET    /api/admin/cue-questions/raw          가명 원문 목록(pagination)
//   PATCH  /api/admin/cue-questions/raw/:id      { topic } 라벨 보강 → 연결된 주제 행을 고치고 원문 행은 지운다
//   DELETE /api/admin/cue-questions/raw/:id      원문 행 삭제
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { CueQuestionTopic, CueQuestionRaw } = require('../models');
const { TOPICS, INTENTS, kstDate } = require('../services/cueQuestionAnalysis');
const { logAudit } = require('../services/auditService');

router.use(authenticateToken, requireRole('platform_admin'));

router.get('/', async (req, res, next) => {
  try {
    const days = Math.min(400, Math.max(1, Number(req.query.days) || 30));
    const since = kstDate(new Date(Date.now() - (days - 1) * 86400000));
    const q = async (sql) => (await sequelize.query(sql, { replacements: { since }, type: sequelize.QueryTypes.SELECT }));
    const where = 'FROM cue_question_topics WHERE stat_date >= :since';
    // 워크스페이스 수는 «하루 단위» 로만 셀 수 있다(해시가 날마다 바뀐다) — 날짜×해시 쌍의 수 = 워크스페이스·일.
    const [tot] = await q(`SELECT COUNT(*) n, SUM(classified) c, SUM(answered) a,
      COUNT(DISTINCT CASE WHEN ws_day_hash IS NOT NULL THEN CONCAT(stat_date, ws_day_hash) END) wd ${where}`);
    const topics = await q(`SELECT topic k, COUNT(*) n, SUM(answered) a,
      COUNT(DISTINCT CASE WHEN ws_day_hash IS NOT NULL THEN CONCAT(stat_date, ws_day_hash) END) wd ${where} GROUP BY topic ORDER BY n DESC`);
    const group = (col) => q(`SELECT COALESCE(${col}, '') k, COUNT(*) n ${where} GROUP BY ${col} ORDER BY n DESC`);
    const [intents, modes, plans, langs] = await Promise.all([group('intent'), group('mode'), group('plan_tier'), group('lang')]);
    const daily = await q(`SELECT DATE_FORMAT(stat_date, '%Y-%m-%d') d, COUNT(*) n ${where} GROUP BY stat_date ORDER BY stat_date`);
    const rawCount = await CueQuestionRaw.count();
    const num = (v) => Number(v || 0);
    return successResponse(res, {
      days, since,
      totals: { questions: num(tot.n), classified: num(tot.c), answered: num(tot.a), workspace_days: num(tot.wd), raw_pending: rawCount },
      topics: topics.map((r) => ({ key: r.k, count: num(r.n), answered: num(r.a), workspace_days: num(r.wd) })),
      intents: intents.map((r) => ({ key: r.k, count: num(r.n) })),
      modes: modes.map((r) => ({ key: r.k, count: num(r.n) })),
      plans: plans.map((r) => ({ key: r.k, count: num(r.n) })),
      langs: langs.map((r) => ({ key: r.k, count: num(r.n) })),
      daily: daily.map((r) => ({ date: r.d, count: num(r.n) })),
      topic_options: TOPICS.filter((t) => t !== 'other'),
      intent_options: INTENTS,
    });
  } catch (err) { next(err); }
});

router.get('/raw', async (req, res, next) => {
  try {
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
    const { rows, count } = await CueQuestionRaw.findAndCountAll({
      attributes: ['id', 'question', 'lang', 'created_at'],
      order: [['created_at', 'DESC']],
      limit, offset,
    });
    return paginatedResponse(res, rows.map((r) => ({ id: r.id, question: r.question, lang: r.lang, created_at: r.createdAt || r.get('created_at') || null })), count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.patch('/raw/:id', async (req, res, next) => {
  try {
    const { topic, intent } = req.body || {};
    if (!TOPICS.includes(topic) || topic === 'other') return errorResponse(res, 'invalid_topic', 400);
    if (intent !== undefined && intent !== null && !INTENTS.includes(intent)) return errorResponse(res, 'invalid_intent', 400);
    const row = await CueQuestionRaw.findByPk(req.params.id);
    if (!row) return errorResponse(res, 'not_found', 404);
    const patch = { topic, classified: true, ...(intent ? { intent } : {}) };
    if (row.topic_row_id) await CueQuestionTopic.update(patch, { where: { id: row.topic_row_id } });
    await row.destroy();   // 라벨을 붙였으면 원문은 쓸모가 끝났다 — 남기지 않는다
    logAudit(req, { action: 'cue_question.label', targetType: 'cue_question_raw', targetId: row.id, newValue: patch, businessId: null });
    return successResponse(res, { id: row.id, labeled: true });
  } catch (err) { next(err); }
});

router.delete('/raw/:id', async (req, res, next) => {
  try {
    const n = await CueQuestionRaw.destroy({ where: { id: { [Op.eq]: Number(req.params.id) || 0 } } });
    if (!n) return errorResponse(res, 'not_found', 404);
    logAudit(req, { action: 'cue_question.raw_delete', targetType: 'cue_question_raw', targetId: Number(req.params.id), businessId: null });
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
