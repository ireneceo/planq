// 청구서 첨부(파일·문서) — 붙이기·떼기·«고객에게 보이기»·공개 내려받기.
//
//   Irene(2026-11-25): *"청구서에 출처문서만 연결할 수 있는데 문서든 파일이든 업로드든 첨부문서/파일들도 넣을 수 있어야 해."*
//   설계 docs/INVOICE_ATTACHMENTS_DESIGN.md (Fable 설계 판정). 판정은 services/invoiceAttachments 한 곳.
//
// routes/invoices.js 가 2400줄이라 따로 둔다. **/api/invoices 에 invoices.js 보다 먼저** 마운트한다 —
//   여기 경로는 모두 꼬리 `/attachments…` 로 끝나 invoices.js 의 경로와 겹치지 않는다(duproute·실호출 확인).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { attachWorkspaceScope, canAccessInvoice, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { logAudit } = require('../services/auditService');
const svc = require('../services/invoiceAttachments');

// 공개 링크 — 워크스페이스가 지워졌으면 닫힌다(invoices.js 와 같은 줄).
router.param('token', (req, res, next, token) => {
  const M = require('../models');
  return require('../services/shareOpenable').workspaceAliveParam([[M.Invoice, 'share_token']])(req, res, next, token);
});

// 숫자 아닌 :id·:attId 는 404 — NaN 이 where 에 들어가 500 이 나던 것(Fable 완료 검증 차단 2). 무인증 문도 같다.
const intParam = (req, res, next, v) => (/^[1-9]\d{0,9}$/.test(String(v)) ? next() : errorResponse(res, 'not_found', 404));
router.param('id', intParam);
router.param('attId', intParam);

function signal(req, invoice) {
  const io = req.app.get('io');
  // 신호만 — 받는 화면이 자기 권한으로 다시 읽는다(invoices.js broadcastInvoice 와 같은 모양).
  if (io && invoice.business_id) io.to(`business:${invoice.business_id}`).emit('invoice:updated', { id: invoice.id, business_id: invoice.business_id, status: invoice.status ?? null });
}

function sendAttachError(res, err, next) {
  if (err instanceof svc.AttachError) return errorResponse(res, err.code, err.status);
  return next(err);
}

// 쓰기 공통 — 고객 차단 · 청구서 찾기 · 취소된 청구서는 바꾸지 않는다.
async function loadWritable(req, res) {
  const { Invoice } = require('../models');
  if (req.businessRole === 'client') { errorResponse(res, 'forbidden', 403); return null; }
  const invoice = await Invoice.findOne({ where: { id: Number(req.params.id), business_id: Number(req.params.businessId) } });
  if (!invoice) { errorResponse(res, 'not_found', 404); return null; }
  if (invoice.status === 'canceled') { errorResponse(res, 'invoice_canceled', 400); return null; }
  return invoice;
}

const keyOf = (r) => (r.file_id ? { file_id: r.file_id } : { post_id: r.post_id });

// POST /api/invoices/:businessId/attachments-preview  body: { attachments:[{file_id}|{post_id}] } — 읽기만(발행 창 칩 이름·스위치 가능 여부)
router.post('/:businessId/attachments-preview', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => { // audit-exempt: 읽기 전용(아무것도 저장하지 않는다)
  try {
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    try {
      return successResponse(res, await svc.previewTargets({ list: req.body?.attachments, businessId: Number(req.params.businessId), user: req.user }));
    } catch (e) { return sendAttachError(res, e, next); }
  } catch (err) { next(err); }
});

// GET /api/invoices/:businessId/:id/attachments — 상세 GET 과 같은 문. 고객(비멤버)은 밖으로 나가는 목록만.
router.get('/:businessId/:id/attachments', authenticateToken, attachWorkspaceScope(), requireMenu('qbill', 'read', { allowNonMember: true }), async (req, res, next) => {
  try {
    const { Invoice } = require('../models');
    const invoice = await Invoice.findOne({ where: { id: Number(req.params.id), business_id: Number(req.params.businessId) } });
    if (!invoice) return errorResponse(res, 'not_found', 404);
    if (!(await canAccessInvoice(req.user.id, invoice, req.scope))) return errorResponse(res, 'forbidden', 403);
    if (!isMemberOrAbove(req.scope)) {
      return successResponse(res, await svc.publicList(invoice, invoice.share_token));
    }
    return successResponse(res, await svc.memberList(invoice, req.user));
  } catch (err) { next(err); }
});

// POST /api/invoices/:businessId/:id/attachments  body: { file_ids?:[], post_ids?:[], client_visible?:false }
router.post('/:businessId/:id/attachments', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const invoice = await loadWritable(req, res);
    if (!invoice) return;
    const { InvoiceAttachment } = require('../models');
    const visible = req.body?.client_visible === true;
    const list = [
      ...(Array.isArray(req.body?.file_ids) ? req.body.file_ids : []).map((file_id) => ({ file_id, client_visible: visible })),
      ...(Array.isArray(req.body?.post_ids) ? req.body.post_ids : []).map((post_id) => ({ post_id, client_visible: visible })),
    ];
    if (!list.length) return errorResponse(res, 'attachment_target_invalid', 400);
    const existing = await InvoiceAttachment.findAll({ where: { invoice_id: invoice.id, business_id: invoice.business_id }, attributes: ['file_id', 'post_id', 'sort_order'], limit: svc.MAX_ATTACHMENTS + 1 });   // 청구서당 상한이 곧 목록 크기(+1 = 넘친 옛 행도 한도 판정에 잡히게)
    let rows;
    try {
      rows = await svc.attachableRows({ list, businessId: invoice.business_id, invoiceId: invoice.id, user: req.user, existing });
    } catch (e) { return sendAttachError(res, e, next); }
    if (rows.length) {
      await InvoiceAttachment.bulkCreate(rows);
      logAudit(req, {
        action: 'invoice.attachment.add', targetType: 'invoice', targetId: invoice.id, businessId: invoice.business_id,
        newValue: { attachments: rows.map((r) => ({ ...keyOf(r), client_visible: r.client_visible })) },
      });
      signal(req, invoice);
    }
    return successResponse(res, { added: rows.length, attachments: await svc.memberList(invoice, req.user) });
  } catch (err) { next(err); }
});

// PATCH /api/invoices/:businessId/:id/attachments/:attId  body: { client_visible?, sort_order? }
router.patch('/:businessId/:id/attachments/:attId', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const invoice = await loadWritable(req, res);
    if (!invoice) return;
    const { InvoiceAttachment } = require('../models');
    const row = await InvoiceAttachment.findOne({ where: { id: Number(req.params.attId), invoice_id: invoice.id, business_id: invoice.business_id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const patch = {};
    if (typeof req.body?.client_visible === 'boolean') patch.client_visible = req.body.client_visible;
    if (Number.isInteger(req.body?.sort_order) && req.body.sort_order >= 0) patch.sort_order = req.body.sort_order;
    if (!Object.keys(patch).length) return errorResponse(res, 'nothing_to_update', 400);
    if (patch.client_visible === true) {
      const { files, posts } = await svc.loadTargets([row], invoice.business_id);
      const file = files.get(row.file_id) || null;
      const post = posts.get(row.post_id) || null;
      // 켜는 사람이 원본을 읽을 수 있어야 한다 — 못 읽으면 붙이기와 같은 404(존재를 알리지 않는다)
      const { getUserScope } = require('../middleware/access_scope');
      const scope = await getUserScope(req.user.id, invoice.business_id, req.user.platform_role);
      if (!(await svc.canReadTarget(req.user, file, post, scope))) return errorResponse(res, 'attachment_target_not_found', 404);
      const why = svc.publicTargetReason(row, file, post);
      if (why) return errorResponse(res, `attachment_not_shareable:${why}`, 400);
    }
    const old = { client_visible: !!row.client_visible, sort_order: row.sort_order };
    await row.update(patch);
    logAudit(req, {
      action: 'invoice.attachment.update', targetType: 'invoice', targetId: invoice.id, businessId: invoice.business_id,
      oldValue: { ...keyOf(row), ...old }, newValue: { ...keyOf(row), ...patch },
    });
    signal(req, invoice);
    return successResponse(res, { attachments: await svc.memberList(invoice, req.user) });
  } catch (err) { next(err); }
});

// DELETE /api/invoices/:businessId/:id/attachments/:attId — 연결만 끊는다(파일·문서 원본은 그대로).
router.delete('/:businessId/:id/attachments/:attId', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const invoice = await loadWritable(req, res);
    if (!invoice) return;
    const { InvoiceAttachment } = require('../models');
    const row = await InvoiceAttachment.findOne({ where: { id: Number(req.params.attId), invoice_id: invoice.id, business_id: invoice.business_id } });
    if (!row) return errorResponse(res, 'not_found', 404);
    const old = { ...keyOf(row), client_visible: !!row.client_visible };
    await row.destroy();
    logAudit(req, {
      action: 'invoice.attachment.remove', targetType: 'invoice', targetId: invoice.id, businessId: invoice.business_id, oldValue: old,
    });
    signal(req, invoice);
    return successResponse(res, { attachments: await svc.memberList(invoice, req.user) });
  } catch (err) { next(err); }
});

// GET /api/invoices/public/:token/attachments/:attId/download — 무인증. 실패는 사유 구분 없이 404(만료만 410, 기존과 같다).
const publicAttachLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `pub-inv-att-${ipKeyGenerator(req.ip)}`,
  message: { success: false, message: 'too_many_requests' },
});
router.get('/public/:token/attachments/:attId/download', publicAttachLimiter, async (req, res, next) => {
  try {
    const { Invoice, InvoiceAttachment, File } = require('../models');
    const { shareOpenReason } = require('../services/shareOpenable');
    const invoice = await Invoice.findOne({ where: { share_token: req.params.token } });
    const why = shareOpenReason('invoice', invoice);
    if (why === 'expired') return errorResponse(res, 'share_expired', 410);
    if (why) return errorResponse(res, 'not_found', 404);
    const att = await InvoiceAttachment.findOne({ where: { id: Number(req.params.attId), invoice_id: invoice.id, business_id: invoice.business_id } });
    if (!att || !att.file_id) return errorResponse(res, 'not_found', 404);
    const file = await File.findOne({ where: { id: att.file_id, business_id: invoice.business_id } });
    if (svc.publicAttachmentReason(att, file, null)) return errorResponse(res, 'not_found', 404);
    const storage = require('../services/attachmentStorage');
    const body = await storage.readAttachmentBody(file);
    if (!body.ok) return errorResponse(res, 'not_found', 404);
    if (body.redirect) return res.redirect(body.redirect);
    require('../services/fileServing').applyFileResponseHeaders(res, file, {
      inline: false,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    });
    return storage.sendAttachmentBody(res, body, 'invoices/public/attachment');
  } catch (err) { next(err); }
});

module.exports = router;
