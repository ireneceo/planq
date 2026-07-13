// routes/mail_aliases.js — 발신 별칭 (Send-as)
//
// 한 메일함으로 여러 도메인 주소를 받고, 받은 주소로 답장한다 (Gmail 의 "다른 주소로 메일 보내기").
// 설계: docs/MAIL_ALIAS_AND_VOICE_DESIGN.md §A
// email_accounts.js 에서 분리 — 계정 라우트가 500줄을 넘어(god-file 가드) 기능 단위로 쪼갠다.
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { EmailAccount, EmailAccountAlias, BusinessMember } = require('../models');
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


module.exports = router;
