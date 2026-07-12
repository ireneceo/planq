// 메일 발신자 분류 규칙 (학습형) — 관리 API.
//
// 투명성이 이 기능의 핵심이다: 사용자가 모르는 사이 메일이 조용히 걸러지면 안 된다.
// 학습된 규칙과 그 근거를 항상 보여주고, 언제든 지울 수 있어야 한다.
// 규칙 삭제 = 즉시 원상복구 (규칙은 분류만 바꿀 뿐 원본 메일을 건드리지 않는다).
//
// 학습 로직 자체는 services/mailSenderRules.js — 여기는 조회·수동추가·삭제만.
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');

function broadcastMail(req, businessId, event, payload) {
  const io = req.app.get('io') || global.__planqIo;
  if (io) io.to(`business:${businessId}`).emit(event, payload);
}

// ─────────────────────────────────────────────
// 메일 발신자 분류 규칙 (학습형) — 투명성 화면용
//
//   GET    /:businessId/mail-rules          목록 (근거 포함)
//   POST   /:businessId/mail-rules          수동 추가
//   DELETE /:businessId/mail-rules/:ruleId  삭제 → 그 발신자 분류 즉시 원상복구
//
// 원칙: 사용자가 모르는 사이 메일이 사라지면 안 된다. 규칙은 항상 보이고 지울 수 있어야 한다.
// ─────────────────────────────────────────────
router.get('/:businessId/mail-rules',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { limit, page, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 300 });
      const { MailSenderRule } = require('../models');
      const { rows, count } = await MailSenderRule.findAndCountAll({
        where: { business_id: businessId },
        order: [['created_at', 'DESC']],
        limit, offset,
      });
      return paginatedResponse(res, rows.map((r) => r.toJSON()), count, { limit, page, offset });
    } catch (err) { next(err); }
  }
);

router.post('/:businessId/mail-rules',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const rules = require('../services/mailSenderRules');
      const { MailSenderRule } = require('../models');

      const raw = String(req.body?.pattern || '').trim().toLowerCase();
      const verdict = String(req.body?.verdict || '');
      if (!['no_reply', 'always_reply', 'marketing', 'spam'].includes(verdict)) {
        return errorResponse(res, 'invalid_verdict', 400);
      }
      // 주소 또는 도메인
      const addr = rules.normalizeEmail(raw);
      const isDomain = !addr && /^[^@\s]+\.[^@\s]+$/.test(raw);
      if (!addr && !isDomain) return errorResponse(res, 'invalid_pattern', 400);

      const [rule, created] = await MailSenderRule.findOrCreate({
        where: { business_id: businessId, pattern: addr || raw },
        defaults: {
          business_id: businessId,
          pattern: addr || raw,
          pattern_type: addr ? 'address' : 'domain',
          verdict,
          source: 'manual',
          created_by: req.user.id,
          evidence: { signal: 'manual', added_at: new Date().toISOString() },
        },
      });
      if (!created && rule.verdict !== verdict) await rule.update({ verdict, source: 'manual' });
      return successResponse(res, rule.toJSON(), created ? '규칙을 추가했습니다' : '규칙을 갱신했습니다');
    } catch (err) { next(err); }
  }
);

router.delete('/:businessId/mail-rules/:ruleId',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { MailSenderRule, EmailThread } = require('../models');
      const rule = await MailSenderRule.findOne({
        where: { id: req.params.ruleId, business_id: businessId },
      });
      if (!rule) return errorResponse(res, 'rule_not_found', 404);

      // 이 규칙으로 분류됐던 스레드의 표시를 원복 (원본 메일은 애초에 건드리지 않았다)
      const [restored] = await EmailThread.update(
        { rule_id: null },
        { where: { business_id: businessId, rule_id: rule.id } }
      );
      await rule.destroy();
      broadcastMail(req, businessId, 'mail:updated', { rule_deleted: Number(req.params.ruleId) });
      return successResponse(res, { deleted: true, restored: restored || 0 }, '규칙을 삭제했습니다');
    } catch (err) { next(err); }
  }
);


module.exports = router;
