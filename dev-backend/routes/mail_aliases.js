// routes/mail_aliases.js — 발신 별칭 (Send-as)
//
// 한 메일함으로 여러 도메인 주소를 받고, 받은 주소로 답장한다 (Gmail 의 "다른 주소로 메일 보내기").
// 설계: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §A
// email_accounts.js 에서 분리 — 계정 라우트가 500줄을 넘어(god-file 가드) 기능 단위로 쪼갠다.
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { EmailAccount, EmailAccountAlias, EmailDomainRule, BusinessMember } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse, parsePagination, paginatedResponse } = require('../middleware/errorHandler');

// 회사 공용 계정 편집 권한 — owner/admin
function isAdmin(req) {
  const r = req.businessMember?.role || req.userBusinessRole;
  return r === 'owner' || r === 'admin' || req.user?.platform_role === 'platform_admin';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function loadAccountForEdit(req) {
  const businessId = Number(req.params.businessId);
  const acc = await EmailAccount.findOne({ where: { id: Number(req.params.id), business_id: businessId } });
  if (!acc) return { error: 'account_not_found' };
  if (acc.owner_user_id) {
    if (Number(acc.owner_user_id) !== Number(req.user.id)) return { error: 'forbidden' };   // 남의 개인 계정
  } else if (!isAdmin(req)) {
    return { error: 'admin_required' };                                                     // 회사 공용
  }
  return { acc, businessId };
}

router.get('/:businessId/email-accounts/:id/aliases', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { acc, error } = await loadAccountForEdit(req);
    if (error) return errorResponse(res, error, error === 'account_not_found' ? 404 : 403);
    // 계정당 별칭은 소수지만(보통 2~5개) 상한은 둔다 — SaaS readiness 규칙(unbounded 응답 금지)
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 100 });
    const { rows, count } = await EmailAccountAlias.findAndCountAll({
      where: { account_id: acc.id },
      order: [['is_default', 'DESC'], ['id', 'ASC']],
      limit, offset,
    });
    return paginatedResponse(res, rows.map((r) => r.toJSON()), count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.post('/:businessId/email-accounts/:id/aliases', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { acc, businessId, error } = await loadAccountForEdit(req);
    if (error) return errorResponse(res, error, error === 'account_not_found' ? 404 : 403);
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return errorResponse(res, 'invalid_email', 400);
    if (email === String(acc.email).toLowerCase()) return errorResponse(res, 'same_as_account', 400);
    const dup = await EmailAccountAlias.findOne({ where: { account_id: acc.id, email } });
    if (dup) return errorResponse(res, 'alias_exists', 409);

    const alias = await EmailAccountAlias.create({
      business_id: businessId,
      account_id: acc.id,
      email,
      display_name: b.display_name ? String(b.display_name).slice(0, 100) : null,
      signature_html: b.signature_html ? String(b.signature_html).slice(0, 20000) : null,
      is_default: !!b.is_default,
    });
    if (alias.is_default) {
      await EmailAccountAlias.update({ is_default: false }, { where: { account_id: acc.id, id: { [Op.ne]: alias.id } } });
    }
    return successResponse(res, alias.toJSON(), 'created', 201);
  } catch (err) { next(err); }
});

router.put('/:businessId/email-accounts/:id/aliases/:aliasId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { acc, error } = await loadAccountForEdit(req);
    if (error) return errorResponse(res, error, error === 'account_not_found' ? 404 : 403);
    const alias = await EmailAccountAlias.findOne({ where: { id: Number(req.params.aliasId), account_id: acc.id } });
    if (!alias) return errorResponse(res, 'alias_not_found', 404);
    const b = req.body || {};
    const patch = {};
    if (b.email !== undefined) {
      const email = String(b.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return errorResponse(res, 'invalid_email', 400);
      patch.email = email;
    }
    if (b.display_name !== undefined) patch.display_name = b.display_name ? String(b.display_name).slice(0, 100) : null;
    if (b.signature_html !== undefined) patch.signature_html = b.signature_html ? String(b.signature_html).slice(0, 20000) : null;
    if (b.is_default !== undefined) patch.is_default = !!b.is_default;
    await alias.update(patch);
    if (patch.is_default) {
      await EmailAccountAlias.update({ is_default: false }, { where: { account_id: acc.id, id: { [Op.ne]: alias.id } } });
    }
    return successResponse(res, alias.toJSON());
  } catch (err) { next(err); }
});

router.delete('/:businessId/email-accounts/:id/aliases/:aliasId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const { acc, error } = await loadAccountForEdit(req);
    if (error) return errorResponse(res, error, error === 'account_not_found' ? 404 : 403);
    const alias = await EmailAccountAlias.findOne({ where: { id: Number(req.params.aliasId), account_id: acc.id } });
    if (!alias) return errorResponse(res, 'alias_not_found', 404);
    await alias.destroy();
    return successResponse(res, { id: alias.id, deleted: true });
  } catch (err) { next(err); }
});


// ─────────────────────────────────────────────
// 우리 도메인 규칙 (email_domain_rules) — **수신 인식 전용**
//
// 도메인을 등록하면 그 도메인의 모든 로컬파트가 "우리에게 온 메일" 로 인식된다.
// 발신(From)은 위의 별칭이 계속 담당한다 — 제공자가 주소 단위로만 발신을 인증해 주고,
// 표시 이름·서명도 주소별이라 규칙으로 대체할 수 없다.
// ─────────────────────────────────────────────

// 공용 메일 도메인 — 등록을 막는다. 이걸 열면 그 제공자의 **모든 발신자**가 우리 주소로 보이고,
//   숨은참조 대량발송이 전부 "우리에게 온 메일" 이 된다 (도메인 규칙을 만든 이유를 스스로 무너뜨림).
//   해당 제공자의 개인 계정 자체는 email_accounts.email 로 이미 우리 주소에 포함돼 있어 규칙이 불필요하다.
const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com',
  'protonmail.com', 'proton.me', 'nate.com',
]);
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** 입력 정규화 — '@wor-pro.com' · 'WOR-PRO.com' 같은 관용 입력을 받아준다. 이메일 전체·와일드카드는 거부. */
function normalizeDomain(raw) {
  return String(raw || '').trim().toLowerCase().replace(/^@/, '');
}

router.get('/:businessId/email-domain-rules', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const { limit, page, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 100 });
    const { rows, count } = await EmailDomainRule.findAndCountAll({
      where: { business_id: businessId },
      order: [['domain', 'ASC']],
      limit, offset,
    });
    return paginatedResponse(res, rows.map((r) => r.toJSON()), count, { limit, page, offset });
  } catch (err) { next(err); }
});

router.post('/:businessId/email-domain-rules', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    // 워크스페이스의 "우리 주소" 정의는 워크스페이스 관리 권한이다 (개인 계정 소유자라도 admin 이 아니면 불가).
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const businessId = Number(req.params.businessId);
    const domain = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(domain)) return errorResponse(res, 'invalid_domain', 400, 'invalid_domain');
    if (PUBLIC_MAIL_DOMAINS.has(domain)) {
      return errorResponse(res, 'public_domain_not_allowed', 400, 'public_domain_not_allowed');
    }
    const dup = await EmailDomainRule.findOne({ where: { business_id: businessId, domain } });
    if (dup) return errorResponse(res, 'rule_exists', 409);
    const rule = await EmailDomainRule.create({
      business_id: businessId,
      domain,
      note: req.body?.note ? String(req.body.note).slice(0, 200) : null,
      created_by: req.user.id,
    });
    return successResponse(res, rule.toJSON(), 'created', 201);
  } catch (err) { next(err); }
});

router.delete('/:businessId/email-domain-rules/:ruleId', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    if (!isAdmin(req)) return errorResponse(res, 'admin_required', 403);
    const rule = await EmailDomainRule.findOne({
      where: { id: Number(req.params.ruleId), business_id: Number(req.params.businessId) },
    });
    if (!rule) return errorResponse(res, 'rule_not_found', 404);
    // 삭제해도 이미 저장된 분류는 그대로다 — 되돌리려면 scripts/retriage-mail.js 를 돌린다.
    await rule.destroy();
    return successResponse(res, { id: rule.id, deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
