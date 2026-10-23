// 문서 «청구 조건» — 보기·저장·지우기·(실패 뒤) 지금 만들기 (2026-10-23, docs/CONTRACT_AUTO_INVOICE_DESIGN.md · Fable 설계 A+D).
//
//   ★ /api/posts 에 posts.js **보다 앞에** 마운트한다 — 이 파일에는 `/:id/billing-terms…` 꼬리 경로만 둔다.
//   권한 — 보기: 워크스페이스 멤버(고객 아님) ∧ 문서 읽기(canReadPost) ∧ Q bill 읽기 이상.
//          고치기·지우기: + 문서 편집(canEditPost) ∧ Q bill 쓰기. 만들기(retry): Q bill 쓰기(초안 만들기와 같은 문).
//   잠금 — 서명 잠금(signatureCore.isPostSignatureLocked)이면 409 billing_terms_locked(본문과 같은 술어),
//          이미 청구서를 만들었으면 409 billing_terms_invoiced.
//   계산·생성은 services/contractBilling 한 곳.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { Post, PostBillingTerms, BusinessMember, Invoice } = require('../models');
const cb = require('../services/contractBilling');
const { canReadPost, canEditPost } = require('../services/postAccess');
const { isPostSignatureLocked } = require('../services/signatureCore');

/** Q bill 메뉴 수준 — owner/admin/platform_admin 은 write, 멤버는 resolveMemberLevels, 그 밖(고객·비멤버)은 none */
async function qbillLevel(user, businessId) {
  if (user.platform_role === 'platform_admin') return 'write';
  const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: user.id, removed_at: null }, attributes: ['role'] });
  if (!m || !['owner', 'admin', 'member'].includes(m.role)) return 'none';
  if (m.role === 'owner' || m.role === 'admin') return 'write';
  const levels = await require('../middleware/menu_permission').resolveMemberLevels(businessId, user.id);
  return levels.qbill || 'none';
}

/** 문서 + 권한 — 실패면 { http, code } */
async function gate(req, need) {
  const post = await Post.findByPk(Number(req.params.id));
  if (!post) return { http: 404, code: 'not_found' };
  const level = await qbillLevel(req.user, post.business_id);
  if (level === 'none') return { http: 403, code: 'forbidden' };
  if (!(await canReadPost(req.user, post))) return { http: 403, code: 'forbidden' };
  if (need === 'write') {
    if (level !== 'write') return { http: 403, code: 'forbidden_read_only' };
    if (!(await canEditPost(req.user.id, post, req.user.platform_role))) return { http: 403, code: 'forbidden' };
  }
  if (need === 'create' && level !== 'write') return { http: 403, code: 'forbidden_read_only' };
  return { post, level };
}

async function stateOf(req, post, level) {
  const terms = await PostBillingTerms.findOne({ where: { post_id: post.id } });
  const [locked, fullySigned, payroll, canEdit] = await Promise.all([
    isPostSignatureLocked(post.id),
    cb.isRoundFullySigned(post.id),
    cb.isPayrollContract(post.id),
    level === 'write' ? canEditPost(req.user.id, post, req.user.platform_role) : false,
  ]);
  let invoice = null;
  // 만든 초안을 Q bill 에서 지웠으면(초안 삭제는 허용) — 다시 자동으로 만들지 않는다(문서당 평생 1건). 화면이 «청구서 만들기(수동)» 로 잇는다.
  let invoiceDeleted = false;
  if (terms && terms.invoice_id) {
    const inv = await Invoice.findOne({ where: { id: terms.invoice_id, business_id: post.business_id }, attributes: ['id', 'invoice_number', 'status', 'grand_total', 'currency'] });
    if (inv) invoice = { id: inv.id, invoice_number: inv.invoice_number, status: inv.status, grand_total: inv.grand_total, currency: inv.currency };
    else invoiceDeleted = true;
  }
  return {
    post_id: post.id,
    terms: cb.memberView(terms),
    invoice,
    invoice_deleted: invoiceDeleted,
    locked,
    fully_signed: fullySigned,
    payroll_contract: payroll,
    can_edit: !!canEdit && !locked && !(terms && terms.invoice_id) && !payroll,
    can_create_invoice: level === 'write',
  };
}

function broadcast(req, post) {
  const io = req.app.get('io');
  // 신호만 — 받는 화면이 다시 읽는다(금액을 방에 뿌리지 않는다)
  if (io) io.to(`business:${post.business_id}`).emit('post:billing_terms', { post_id: post.id, business_id: post.business_id });
}

// GET /api/posts/:id/billing-terms
router.get('/:id/billing-terms', authenticateToken, async (req, res, next) => {
  try {
    const g = await gate(req, 'read');
    if (!g.post) return errorResponse(res, g.code, g.http, g.code);
    successResponse(res, await stateOf(req, g.post, g.level));
  } catch (err) { next(err); }
});

// PUT /api/posts/:id/billing-terms  { client_id, title?, currency, vat_rate, receipt_type, items[], installment_mode, installments[], notes? }
router.put('/:id/billing-terms', authenticateToken, async (req, res, next) => {
  try {
    const g = await gate(req, 'write');
    if (!g.post) return errorResponse(res, g.code, g.http, g.code);
    const post = g.post;
    if (await cb.isPayrollContract(post.id)) return errorResponse(res, 'payroll_contract', 409, 'payroll_contract');
    // 이미 만든 청구서가 먼저다 — 서명 완료 문서는 잠금도 걸려 있어 순서가 바뀌면 «서명 진행 중» 이라고 잘못 말한다
    const prev = await PostBillingTerms.findOne({ where: { post_id: post.id } });
    if (prev && prev.invoice_id) return errorResponse(res, 'billing_terms_invoiced', 409, 'billing_terms_invoiced');
    if (await isPostSignatureLocked(post.id)) return errorResponse(res, 'billing_terms_locked', 409, 'billing_terms_locked');
    const n = await cb.normalizeTerms(post.business_id, req.body || {});
    if (!n.ok) return errorResponse(res, n.code, n.http, n.code);
    let row;
    if (prev) { await prev.update({ ...n.value, updated_by: req.user.id, auto_error: null }); row = prev; }
    else row = await PostBillingTerms.create({ ...n.value, business_id: post.business_id, post_id: post.id, created_by: req.user.id, updated_by: req.user.id });
    require('../services/auditService').logAudit(req, {
      action: prev ? 'post.billing_terms_update' : 'post.billing_terms_create', targetType: 'post', targetId: post.id, businessId: post.business_id,
      oldValue: prev ? { client_id: prev.client_id, currency: prev.currency, vat_rate: prev.vat_rate, items: prev.items, installment_mode: prev.installment_mode, installments: prev.installments } : null,
      newValue: { client_id: row.client_id, currency: row.currency, vat_rate: row.vat_rate, items: row.items, installment_mode: row.installment_mode, installments: row.installments },
    });
    broadcast(req, post);
    successResponse(res, await stateOf(req, post, g.level));
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/billing-terms
router.delete('/:id/billing-terms', authenticateToken, async (req, res, next) => {
  try {
    const g = await gate(req, 'write');
    if (!g.post) return errorResponse(res, g.code, g.http, g.code);
    const post = g.post;
    const prev = await PostBillingTerms.findOne({ where: { post_id: post.id } });
    if (prev && prev.invoice_id) return errorResponse(res, 'billing_terms_invoiced', 409, 'billing_terms_invoiced');
    if (await isPostSignatureLocked(post.id)) return errorResponse(res, 'billing_terms_locked', 409, 'billing_terms_locked');
    if (!prev) return successResponse(res, await stateOf(req, post, g.level));
    await prev.destroy();
    require('../services/auditService').logAudit(req, {
      action: 'post.billing_terms_delete', targetType: 'post', targetId: post.id, businessId: post.business_id,
      oldValue: { client_id: prev.client_id, currency: prev.currency, items: prev.items },
    });
    broadcast(req, post);
    successResponse(res, await stateOf(req, post, g.level));
  } catch (err) { next(err); }
});

// POST /api/posts/:id/billing-terms/create-invoice — 자동 생성이 실패했을 때 지금 다시(조건·서명 완료 판정은 자동과 같은 함수)
router.post('/:id/billing-terms/create-invoice', authenticateToken, async (req, res, next) => { // audit-exempt: 감사(invoice.auto_create)는 services/contractBilling 이 쓴다
  try {
    const g = await gate(req, 'create');
    if (!g.post) return errorResponse(res, g.code, g.http, g.code);
    const r = await cb.createFromTerms(g.post.id, { reason: 'manual_retry' });
    if (r.error) return errorResponse(res, r.error, 409, r.error);
    if (r.skipped && r.skipped !== 'already_created') return errorResponse(res, r.skipped, 409, r.skipped);
    successResponse(res, await stateOf(req, g.post, g.level));
  } catch (err) { next(err); }
});

module.exports = router;
