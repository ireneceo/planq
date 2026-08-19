// routes/email_auth_diag.js — 발신 도메인 인증 진단 (SPF / DKIM / DMARC) 조회 API.
//
// ★ 임의 도메인 조회를 허용하지 않는다. 요청 도메인이 **이 워크스페이스의 발신 도메인 집합**
//   (연결된 메일함 주소 + Send-as 별칭 주소의 도메인)에 속할 때만 조회한다.
//   허용하면 PlanQ 가 남의 DNS 를 대신 긁어주는 공개 리졸버가 된다.
// ★ 외부 조회 fan-out (도메인당 최대 ~12 쿼리) 이므로 per-user rate-limit 을 건다
//   (CLAUDE.md 운영 안정성 1 — 외부 quota·비용 라우트).
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { EmailAccount, EmailAccountAlias } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');
const { perUserLimiter } = require('../middleware/costGuard');
const authDiag = require('../services/emailAuthDiag');

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SELECTOR_RE = /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/;

/** 이 워크스페이스가 실제로 **발신에 쓰는** 도메인 집합. 진단 허용 목록의 정본. */
async function sendingDomains(businessId) {
  const accounts = await EmailAccount.findAll({
    where: { business_id: businessId },
    attributes: ['id', 'email'],
    raw: true,
  });
  const ids = accounts.map((a) => a.id);
  const aliases = ids.length
    ? await EmailAccountAlias.findAll({
      where: { account_id: { [Op.in]: ids } }, attributes: ['email'], raw: true,
    })
    : [];
  const set = new Set();
  for (const row of [...accounts, ...aliases]) {
    const at = String(row.email || '').lastIndexOf('@');
    if (at > 0) set.add(String(row.email).slice(at + 1).trim().toLowerCase());
  }
  return [...set].filter((d) => DOMAIN_RE.test(d)).sort();
}

// GET /api/businesses/:businessId/email-auth-domains — 진단 가능한 도메인 목록
//   목록 라우트 표준(parsePagination + paginatedResponse) 적용. 실제로는 워크스페이스의 발신
//   도메인이라 수십 개를 넘지 않지만, 표준을 벗어난 목록 라우트를 남기지 않는다.
router.get('/:businessId/email-auth-domains',
  authenticateToken, checkBusinessAccess,
  async (req, res, next) => {
    try {
      const { limit, page, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 500 });
      const all = await sendingDomains(Number(req.params.businessId));
      return paginatedResponse(res, all.slice(offset, offset + limit), all.length, { limit, page, offset });
    } catch (err) { next(err); }
  });

// GET /api/businesses/:businessId/email-auth-diagnosis?domain=&selector=
router.get('/:businessId/email-auth-diagnosis',
  authenticateToken, checkBusinessAccess,
  perUserLimiter('mail-auth-diag', { windowMs: 60 * 1000, max: 10 }),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const domain = String(req.query.domain || '').trim().toLowerCase().replace(/^@/, '');
      if (!DOMAIN_RE.test(domain)) return errorResponse(res, 'invalid_domain', 400, 'invalid_domain');
      const selector = String(req.query.selector || '').trim().toLowerCase();
      if (selector && !SELECTOR_RE.test(selector)) return errorResponse(res, 'invalid_selector', 400, 'invalid_selector');
      // 화이트리스트 — 우리 발신 도메인이 아니면 조회하지 않는다.
      const allowed = await sendingDomains(businessId);
      if (!allowed.includes(domain)) return errorResponse(res, 'domain_not_in_workspace', 400, 'domain_not_in_workspace');
      const result = await authDiag.diagnose(domain, { selector: selector || undefined });
      return successResponse(res, result);
    } catch (err) { next(err); }
  });

module.exports = router;
