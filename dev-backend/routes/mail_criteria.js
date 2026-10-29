// 메일 분류 기준 — 공개·끄기 API (docs/MAIL_CRITERIA_DESIGN.md §3.4)
//
// Irene 2026-10-15: *"상세 조건들을 모두 설정에 나오게 하고 우리끼리 가지고 있지 말고 투명하게 공개하자.
//   그리고 그에 대해 학습하며 업데이트 하는 걸 안내하고 싫으면 삭제하고 추가도 할 수 있게 하자."*
//
//   GET  /:businessId/mail-criteria               기준 목록(엔진과 같은 카탈로그) + 켜짐 + 30일 적중 수 + 최근 학습
//   POST /:businessId/mail-criteria/:id/preview   저장하지 않고 «끄면/켜면 지금 받은 메일 N건이 옮겨진다» 세기
//   PUT  /:businessId/mail-criteria/:id {enabled} 끄기/켜기 → 이미 받은 메일에도 소급 (owner/admin)
//
// ★ 내장 기준 하나를 끄면 워크스페이스 전원의 폴더가 바뀐다 — 워크스페이스 정책이라 owner/admin 만 고친다(설계 결정 ⑤).
//   보기는 Q mail 읽기 권한 전원. 사용자 규칙(주소·문구) 추가·삭제는 routes/mail_rules.js — 종전대로 멤버.
const express = require('express');
const router = express.Router();
const { Op, fn, col } = require('sequelize');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { getUserScope } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../middleware/audit');
const CAT = require('../services/mailCriteriaCatalog');
const MC = require('../services/mailCriteria');

/** 기준을 끄고 켤 수 있는 사람 — owner·워크스페이스 관리자·플랫폼 관리자. 화면은 응답의 can_edit 만 본다. */
async function canEditCriteria(req, businessId) {
  const scope = await getUserScope(req.user.id, businessId, req.user.platform_role);
  return !!(scope && (scope.isPlatformAdmin || scope.isOwner || scope.isAdmin));
}

router.get('/:businessId/mail-criteria',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const { Business, EmailThread, MailSenderRule } = require('../models');
      const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
      const { off } = MC.criteriaOf(biz);
      // 적중 수 — 내가 볼 수 있는 메일함만 센다(남의 개인 메일함 건수를 세어 보이지 않는다).
      const { accessibleAccountIds } = require('../services/mailIdentity');
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const rows = acctIds.length ? await EmailThread.findAll({
        where: { business_id: businessId, account_id: { [Op.in]: acctIds }, last_message_at: { [Op.gte]: since }, triage_criterion: { [Op.ne]: null } },
        attributes: ['triage_criterion', [fn('COUNT', col('id')), 'n']],
        group: ['triage_criterion'], raw: true,
      }) : [];
      const hits = Object.fromEntries(rows.map((r) => [r.triage_criterion, Number(r.n) || 0]));
      const items = CAT.listCatalog().map((c) => ({ ...c, enabled: !off.includes(c.id), hits_30d: hits[c.id] || 0 }));
      const learned = await MailSenderRule.findAll({
        where: { business_id: businessId, source: 'learned' },
        order: [['created_at', 'DESC']], limit: 3,
        attributes: ['id', 'pattern', 'pattern_type', 'verdict', 'evidence', 'created_at'],
      });
      const rules = require('../services/mailSenderRules');
      return successResponse(res, {
        items,
        can_edit: await canEditCriteria(req, businessId),
        // 사칭 검사의 «안전한 도메인»(관계사) — services/mailTrustedDomains
        trusted_domains: require('../services/mailTrustedDomains').listOf(biz),
        rule_hits_30d: hits.rule || 0, manual_hits_30d: hits.manual || 0,
        learning: {
          dismiss: rules.DISMISS_THRESHOLD, spam: rules.SPAM_THRESHOLD, mark: rules.MARK_THRESHOLD,
          domain_promote: rules.DOMAIN_PROMOTE_THRESHOLD,
          recent: learned.map((r) => r.toJSON()),
        },
      });
    } catch (err) { next(err); }
  }
);

/** 끄기/켜기 뒤의 off 목록 — 정규화 한 함수(normalizeMailCriteria)를 지난다. */
function nextOff(currentOff, id, enabled) {
  const set = new Set(currentOff);
  if (enabled) set.delete(id); else set.add(id);
  return MC.normalizeMailCriteria({ off: [...set] }).off;
}

router.post('/:businessId/mail-criteria/:id/preview', // audit-exempt: 세기만 한다 — 저장하지 않는다
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const id = String(req.params.id);
      if (!CAT.TOGGLEABLE.has(id)) return errorResponse(res, 'criterion_locked', 400);
      const enabled = req.body?.enabled !== false;
      const { Business } = require('../models');
      const biz = await Business.findByPk(businessId, { attributes: ['id', 'permissions'] });
      const before = MC.criteriaOf(biz).off;
      const after = nextOff(before, id, enabled);
      const r = await require('../services/mailRetriage').criterionImpact(businessId, id, new Set(before), new Set(after), { apply: false });
      return successResponse(res, { id, enabled, ...r });
    } catch (err) { next(err); }
  }
);

router.put('/:businessId/mail-criteria/:id',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const id = String(req.params.id);
      if (!CAT.BY_ID.has(id)) return errorResponse(res, 'criterion_not_found', 404);
      if (!CAT.TOGGLEABLE.has(id)) return errorResponse(res, 'criterion_locked', 400);
      if (typeof req.body?.enabled !== 'boolean') return errorResponse(res, 'invalid_enabled', 400);
      if (!(await canEditCriteria(req, businessId))) return errorResponse(res, 'forbidden', 403);
      const enabled = req.body.enabled;
      const { Business } = require('../models');
      const biz = await Business.findByPk(businessId);
      if (!biz) return errorResponse(res, 'business_not_found', 404);
      const before = MC.criteriaOf(biz).off;
      const after = nextOff(before, id, enabled);
      const changed = before.join(',') !== after.join(',');
      if (changed) {
        await biz.update({
          permissions: { ...(biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {}), mail_criteria: { off: after } },
        });
        MC.invalidate(businessId);
      }
      // 이미 받은 메일에도 적용 — 미리보기와 **같은 함수**(criterionImpact)라 미리보기 수 = 옮긴 수.
      const applied = changed
        ? await require('../services/mailRetriage').criterionImpact(businessId, id, new Set(before), new Set(after), { apply: true })
        : { scanned: 0, moved: 0, capped: false, samples: [], by: {} };
      if (changed) {
        createAuditLog({
          userId: req.user.id, businessId,
          action: 'mail_criteria.update', targetType: 'business', targetId: businessId,
          oldValue: { off: before }, newValue: { off: after, criterion: id, enabled, moved: applied.moved },
        });
        const io = req.app.get('io') || global.__planqIo;
        if (io) io.to(`business:${businessId}`).emit('mail:updated', require('../services/mailBroadcast').mailSignal({ bulk: true }));
      }
      return successResponse(res, { id, enabled, off: after, applied });
    } catch (err) { next(err); }
  }
);

// ── 안전한 도메인(관계사) — docs/MAIL_IMPERSONATION_DESIGN.md §10 ─────────────────────────────
//   POST   /:businessId/mail-trusted-domains {thread_id}  경고 스레드의 From 유사 도메인을 등록(도메인은 서버가 고른다)
//   DELETE /:businessId/mail-trusted-domains/:domain      빼기
//   owner/admin 만(기준 끄기와 같은 사람). 등록·빼기 뒤 사칭 판정이 있는 스레드를 다시 판정한다.
const TRUST_ERR = { thread_not_found: 404, not_found: 404, business_not_found: 404 };
router.post('/:businessId/mail-trusted-domains',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const threadId = Number(req.body?.thread_id);
      if (!Number.isInteger(threadId) || threadId <= 0) return errorResponse(res, 'invalid_thread_id', 400);
      if (!(await canEditCriteria(req, businessId))) return errorResponse(res, 'forbidden', 403);
      // 볼 수 없는 메일함의 스레드는 없는 것과 같다
      const { EmailThread } = require('../models');
      const { accessibleAccountIds } = require('../services/mailIdentity');
      const acctIds = await accessibleAccountIds(businessId, req.user.id);
      const th = await EmailThread.findOne({ where: { id: threadId, business_id: businessId, account_id: { [Op.in]: acctIds.length ? acctIds : [0] } }, attributes: ['id'] });
      if (!th) return errorResponse(res, 'thread_not_found', 404);
      const r = await require('../services/mailTrustedDomains').add(businessId, threadId);
      if (!r.ok) return errorResponse(res, r.code, TRUST_ERR[r.code] || 400);
      if (r.before.length !== r.list.length) {
        createAuditLog({
          userId: req.user.id, businessId, action: 'mail.trusted_domain.add', targetType: 'business', targetId: businessId,
          oldValue: { trusted_domains: r.before }, newValue: { trusted_domains: r.list, domain: r.domain, like: r.like, thread_id: threadId },
        });
      }
      const io = req.app.get('io') || global.__planqIo;
      if (io) io.to(`business:${businessId}`).emit('mail:updated', require('../services/mailBroadcast').mailSignal({ bulk: true }));
      return successResponse(res, { domain: r.domain, trusted_domains: r.list, reassessed: r.reassessed, cleared: r.cleared, released: r.released });
    } catch (err) { next(err); }
  }
);

router.delete('/:businessId/mail-trusted-domains/:domain',
  authenticateToken, checkBusinessAccess, requireMenu('qmail', 'read'),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      if (!(await canEditCriteria(req, businessId))) return errorResponse(res, 'forbidden', 403);
      const r = await require('../services/mailTrustedDomains').remove(businessId, req.params.domain);
      if (!r.ok) return errorResponse(res, r.code, TRUST_ERR[r.code] || 400);
      createAuditLog({
        userId: req.user.id, businessId, action: 'mail.trusted_domain.remove', targetType: 'business', targetId: businessId,
        oldValue: { trusted_domains: r.before }, newValue: { trusted_domains: r.list },
      });
      const io = req.app.get('io') || global.__planqIo;
      if (io) io.to(`business:${businessId}`).emit('mail:updated', require('../services/mailBroadcast').mailSignal({ bulk: true }));
      return successResponse(res, { trusted_domains: r.list, reassessed: r.reassessed });
    } catch (err) { next(err); }
  }
);

module.exports = router;
