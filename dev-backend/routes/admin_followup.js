// 플랫폼 관리자 — 신규 고객 팔로업 (2026-11-06, docs/ADMIN_FOLLOWUP_DESIGN.md · Fable 설계 DESIGN-FIX 정본)
//
// Irene: "신규고객 팔로잉하는 히스토리 한번에 보는 화면 … 누가 누가 들어왔고 지금 어떤 상태이고 어떤 도움을 전하면 될지,
//   메시지도 직접 보내게 해줘서 밀착마크하게."
//
// ★ 범위: 지우지 않은 워크스페이스 ∧ (가입 N일 이내 ∨ 체험 중) − 우리 것(면제 internal). tester·partner 면제는 포함(칩).
// ★ 사용 모양만 — 제목·본문·파일명·대화방 이름 0. 보내기는 기존 안내방 문(POST /api/admin/support/rooms/:id/messages).
const express = require('express');
const router = express.Router();
const { Business } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse, paginatedResponse } = require('../middleware/errorHandler');
const { ownerOf, createdAtOf } = require('../services/adminSubscriptionView');
const { isExemptNow } = require('../services/billingExemptView');
const { summarize, followupCandidates: candidates, FOLLOWUP_BIZ_ATTRS: BIZ_ATTRS } = require('../services/followupSummary');
const followupRules = require('../services/followupRules');

router.use(authenticateToken, requireRole('platform_admin'));

const DAY_OPTIONS = [7, 30, 90];
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

function rowOf(b, s) {
  return {
    business: { id: b.id, name: b.brand_name || b.name, owner: ownerOf(b) },
    created_at: createdAtOf(b),
    subscription_status: b.subscription_status,
    plan: b.plan,
    trial_ends_at: b.trial_ends_at,
    trial_days_left: s.trial_days_left,
    exempt_kind: isExemptNow(b) ? (b.billing_exempt_kind || 'internal') : null,
    stage: s.stage,
    last_seen_at: s.last_seen_at,
    members: s.members,
    setup: s.setup,
    signals: s.signals,
    help: s.help,
    room: s.room,
    owner_lang: s.owner_lang,
  };
}

const helpRank = (s) => (s.help.length ? [-s.help.filter((h) => h.key !== 'welcome').length, s.help[0].priority] : [0, 99]);

// GET /api/admin/followup?days=30&sort=recent|help&q=&limit=25&offset=0
router.get('/followup', async (req, res, next) => {
  try {
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    if (!DAY_OPTIONS.includes(days)) return errorResponse(res, 'invalid_days', 400);
    const sort = req.query.sort === 'help' ? 'help' : 'recent';
    const q = String(req.query.q || '').trim().slice(0, 100);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const all = await candidates({ days, q });
    let page;
    let sums;
    if (sort === 'help') {
      sums = await summarize(all);
      const ordered = [...all].sort((a, b) => {
        const [ah, ap] = helpRank(sums.get(a.id));
        const [bh, bp] = helpRank(sums.get(b.id));
        return ah - bh || ap - bp || (new Date(createdAtOf(b)) - new Date(createdAtOf(a)));
      });
      page = ordered.slice(offset, offset + limit);
    } else {
      page = all.slice(offset, offset + limit);
      sums = await summarize(page);
    }
    return paginatedResponse(res, page.map((b) => rowOf(b, sums.get(b.id))), all.length,
      { limit, offset, page: Math.floor(offset / limit) + 1 });
  } catch (err) { next(err); }
});

// GET /api/admin/followup/:businessId/draft?key=solo — 규칙 초안(대표 언어). 보내지 않는다.
router.get('/followup/:businessId/draft', async (req, res, next) => {
  try {
    const biz = Number(req.params.businessId);
    const key = String(req.query.key || '');
    if (!biz) return errorResponse(res, 'invalid_id', 400);
    if (!followupRules.RULE_KEYS.includes(key)) return errorResponse(res, 'invalid_rule', 400);
    const b = await Business.findOne({ where: { id: biz, deleted_at: null }, attributes: BIZ_ATTRS });
    if (!b) return errorResponse(res, 'business_not_found', 404);
    const s = (await summarize([b])).get(b.id);
    const hit = s.help.find((h) => h.key === key);
    const sig = s.signals.find((x) => x.key === key);
    const params = (hit && hit.params) || (sig ? { days: sig.days, count: sig.count } : {});
    return successResponse(res, { key, lang: s.owner_lang, text: followupRules.draftText(key, s.owner_lang, params) });
  } catch (err) { next(err); }
});

module.exports = router;
