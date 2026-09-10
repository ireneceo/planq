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

// POST /:businessId/mail-rules/preview — **저장하지 않고** 이 조건에 걸리는 메일을 세어 본다.
//   ★ 2026-09-10 (Irene): "구체적으로 조건을 구성하는 걸 선택하게 하면 어때?"
//     조건을 고르게 하려면 그 조건이 **무엇을 잡는지** 보여야 한다. 규칙을 만든 뒤 폴더를
//     열어 확인하는 것은 되돌리기 비용이 큰 확인 방식이다(수백 건이 옮겨진 뒤에 안다).
router.post('/:businessId/mail-rules/preview',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const rules = require('../services/mailSenderRules');
      const raw = String(req.body?.pattern || '').trim().toLowerCase();
      const wantKeyword = String(req.body?.pattern_type || '') === 'keyword';
      if (wantKeyword && raw.length < 2) return errorResponse(res, 'keyword_too_short', 400);
      let patternType = 'keyword';
      if (!wantKeyword) {
        const addr = rules.normalizeEmail(raw);
        const isDomain = !addr && /^[^@\s]+\.[^@\s]+$/.test(raw);
        if (!addr && !isDomain) return errorResponse(res, 'invalid_pattern', 400);
        patternType = addr ? 'address' : 'domain';
      }
      const matchField = ['from', 'subject', 'body', 'any'].includes(String(req.body?.match_field || ''))
        ? String(req.body.match_field) : (wantKeyword ? 'any' : 'from');
      const rows = await rules.threadsMatchingRule(businessId, {
        pattern: raw, pattern_type: patternType, match_field: matchField,
      }, { limit: 200 });
      return successResponse(res, {
        matched: rows.length,
        capped: rows.length >= 200,   // 200 에서 끊었다 — "정확히 200" 이라고 말하지 않는다
        samples: rows.slice(0, 5).map((t) => ({ id: t.id, subject: t.subject, status: t.status, reply_needed: !!t.reply_needed })),
      });
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
      if (!['no_reply', 'always_reply', 'marketing', 'spam', 'review'].includes(verdict)) {
        return errorResponse(res, 'invalid_verdict', 400);
      }
      // #344 — 문구 규칙. 주소가 아니라 제목·본문에서 찾을 말이다.
      const wantKeyword = String(req.body?.pattern_type || '') === 'keyword';
      const matchField = ['from', 'subject', 'body', 'any'].includes(String(req.body?.match_field || ''))
        ? String(req.body.match_field) : (wantKeyword ? 'any' : 'from');
      const markImportant = !!req.body?.mark_important;
      if (wantKeyword) {
        // 너무 짧은 말은 아무 메일이나 잡는다 — 규칙이 아니라 사고가 된다.
        if (raw.length < 2) return errorResponse(res, 'keyword_too_short', 400);
        const created = await MailSenderRule.create({
          business_id: businessId,
          pattern: raw.slice(0, 255),
          pattern_type: 'keyword',
          match_field: matchField,
          verdict,
          mark_important: markImportant,
          source: 'manual',
          evidence: { added_by: req.user.id, added_at: new Date() },
        });
        // 이미 받은 메일에도 적용한다 — 삭제(되돌리기)와 대칭. 아래 주소·도메인 분기와 같은 함수.
        const appliedKw = await rules.applyRuleToExisting(businessId, created).catch((e) => {
          console.warn('[mail-rules] 소급 적용 실패:', e.message); return { matched: 0, changed: 0 };
        });
        if (appliedKw.changed > 0) broadcastMail(req, businessId, 'mail:updated', { bulk: true, rule_applied: created.id });
        return successResponse(res, {
          id: created.id, pattern: created.pattern, pattern_type: 'keyword', match_field: matchField,
          verdict, mark_important: markImportant, applied: appliedKw,
        }, null, 201);
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
      if (markImportant && !rule.mark_important) await rule.update({ mark_important: true });
      // 이미 받은 메일에도 적용한다.
      //   ★ 여태 없던 문이다 — 규칙을 만들어도 **에어비앤비 알림은 자동·마케팅 폴더에 그대로** 있었다.
      //     삭제는 되돌리는데 추가는 소급이 없어, 사용자가 보기에 "만들었는데 아무 일도 안 일어난다".
      const applied = await rules.applyRuleToExisting(businessId, rule).catch((e) => {
        console.warn('[mail-rules] 소급 적용 실패:', e.message); return { matched: 0, changed: 0 };
      });
      if (applied.changed > 0) broadcastMail(req, businessId, 'mail:updated', { bulk: true, rule_applied: rule.id });
      return successResponse(res, { ...rule.toJSON(), applied },
        created ? '규칙을 추가했습니다' : '규칙을 갱신했습니다');
    } catch (err) { next(err); }
  }
);

router.delete('/:businessId/mail-rules/:ruleId',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'write'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { MailSenderRule } = require('../models');
      const rule = await MailSenderRule.findOne({
        where: { id: req.params.ruleId, business_id: businessId },
      });
      if (!rule) return errorResponse(res, 'rule_not_found', 404);

      // 이 규칙 때문에 바뀐 분류를 실제로 되돌린다 (뱃지만 지우면 그 메일들은 영영
      //   "답변 필요" 로 안 돌아온다 — Fable BLOCK 2). 답장 경로와 같은 함수를 공유한다.
      const { restoreThreadsForRule } = require('../services/mailSenderRules');
      const restored = await restoreThreadsForRule(businessId, rule.id, rule.verdict);
      await rule.destroy();
      broadcastMail(req, businessId, 'mail:updated', { rule_deleted: Number(req.params.ruleId) });
      return successResponse(res, { deleted: true, restored }, restored > 0 ? `규칙을 삭제하고 메일 ${restored}건을 답변 필요로 되돌렸습니다` : '규칙을 삭제했습니다');
    } catch (err) { next(err); }
  }
);


module.exports = router;
