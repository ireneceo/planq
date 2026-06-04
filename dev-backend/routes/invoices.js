const express = require('express');
const router = express.Router();
const { Invoice, InvoiceItem, InvoiceInstallment, Client, User, Business, Post, Conversation, Message } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');

// 사이클 N+21 — Invoice 상태 전이 history 박제 헬퍼
async function recordInvoiceStatusChange(invoice, fromStatus, toStatus, userId, note = null) {
  if (!toStatus || fromStatus === toStatus) return;
  try {
    const { InvoiceStatusHistory } = require('../models');
    await InvoiceStatusHistory.create({
      invoice_id: invoice.id,
      business_id: invoice.business_id,
      from_status: fromStatus,
      to_status: toStatus,
      changed_by: userId,
      note,
    });
  } catch (e) { console.warn('[InvoiceStatusHistory create]', e.message); }
}
const { attachWorkspaceScope, invoiceListWhere, canAccessInvoice, isMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

// 결제 독촉(리마인더) — 외부 메일 발송 라우트. per-user rate-limit (운영 안정성 1번).
//   IP 기준 X (NAT 뒤 여러 사용자 차단 방지). 같은 청구서 도배는 라우트 내 쿨다운으로 별도 차단.
const reminderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1시간
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `invoice-remind-u${req.user.id}` : `invoice-remind-ip${ipKeyGenerator(req)}`),
  message: { success: false, message: 'too_many_reminders' },
});
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 같은 청구서 6시간 쿨다운

// N+38 — 실시간 동기화 (CLAUDE.md 운영 안정성 16번 박제).
function broadcastInvoice(req, invoice, event = 'invoice:updated') {
  const io = req.app.get('io');
  if (!io) return;
  const data = invoice.toJSON ? invoice.toJSON() : invoice;
  if (invoice.business_id) io.to(`business:${invoice.business_id}`).emit(event, data);
}

// 사이클 N+5 — PERMISSION_MATRIX §5.10 재무 mutation 가드.
// invoice 발행·결제 마킹·세금계산서·환불·삭제는 owner OR platform_admin 만. member 차단.
// (draft 생성/편집은 별개 — checkBusinessAccess 통과한 member 도 허용)
function assertInvoiceMutationOwner(req, res) {
  const ok = req.businessRole === 'owner' || req.user?.platform_role === 'platform_admin';
  if (!ok) {
    errorResponse(res, 'owner_only — financial mutation requires workspace owner or platform admin', 403);
    return false;
  }
  return true;
}

// PDF 다운로드 helper — 공통
async function buildInvoicePdf(invoiceId) {
  const invoice = await Invoice.findByPk(invoiceId, {
    include: [
      { model: InvoiceItem, as: 'items' },
      { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
      { model: Client, attributes: ['display_name', 'company_name', 'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'biz_address_en'] },
    ],
  });
  if (!invoice) throw new Error('not_found');
  const business = await Business.findByPk(invoice.business_id, {
    attributes: ['name', 'brand_name', 'legal_name', 'legal_name_en', 'tax_id', 'representative', 'address', 'address_en', 'bank_name', 'bank_account_number', 'bank_account_name', 'swift_code', 'bank_name_en', 'bank_account_name_en'],
  });
  const { invoicePdfHtml } = require('../services/pdfTemplates');
  const { renderPdfFromHtml } = require('../services/pdfService');
  const html = invoicePdfHtml(invoice.toJSON(), business?.toJSON() || {}, invoice.Client?.toJSON() || {});
  return { pdf: await renderPdfFromHtml(html), invoice };
}

// 공개 결제 카드 (kind='card', meta.card_type='invoice', meta.invoice_id=:id) 메타 갱신
// invoice 상태가 바뀔 때 채팅방의 카드도 함께 갱신해서 새로고침 / Socket.IO 동기.
async function updateInvoiceChatCards(invoiceId, patches, transaction = null) {
  try {
    const id = parseInt(invoiceId, 10);
    if (!Number.isInteger(id) || id <= 0) return 0;
    // parameterized JSON_EXTRACT — sequelize.literal string interpolation 회피
    const messages = await Message.findAll({
      where: {
        kind: 'card',
        [Op.and]: [
          sequelize.where(sequelize.fn('JSON_EXTRACT', sequelize.col('meta'), '$.card_type'), 'invoice'),
          sequelize.where(sequelize.fn('JSON_EXTRACT', sequelize.col('meta'), '$.invoice_id'), id),
        ],
      },
      transaction,
    });
    for (const m of messages) {
      const meta = { ...(m.meta || {}), ...patches };
      await m.update({ meta }, { transaction });
    }
    return messages.length;
  } catch (err) {
    // 카드 갱신 실패는 invoice 액션 자체를 막지 않음 (best-effort)
    console.error('[updateInvoiceChatCards]', err.message);
    return 0;
  }
}

// Generate invoice number
const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const last = await Invoice.findOne({
    where: sequelize.where(
      sequelize.fn('YEAR', sequelize.col('created_at')),
      year
    ),
    order: [['id', 'DESC']]
  });

  const seq = last ? parseInt(last.invoice_number.split('-')[2]) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
};

// ─── 공개 결제 페이지 (인증 없음 — share_token 기반) ───
// /:businessId 매칭보다 먼저 와야 함

// GET /api/invoices/public/:token — 익명 청구서 조회 (계좌 + 분할 + 발신/고객 + 알림 상태)
router.get('/public/:token', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name'] },
      ],
    });
    if (!invoice) return errorResponse(res, 'not_found', 404);
    if (invoice.status === 'draft' || invoice.status === 'canceled') {
      return errorResponse(res, 'not_available', 404);
    }
    // N+43: 만료 검사
    if (invoice.share_expires_at && new Date(invoice.share_expires_at) < new Date()) {
      return res.status(410).json({
        success: false,
        code: 'share_expired',
        message: 'This share link has expired.',
        expired_at: invoice.share_expires_at,
      });
    }
    // 첫 열람 기록
    if (!invoice.viewed_at) {
      try { await invoice.update({ viewed_at: new Date() }); } catch {}
    }
    // 발신자 워크스페이스 (공개 페이지 용 최소 정보)
    const business = await Business.findByPk(invoice.business_id, {
      attributes: ['id', 'name', 'brand_name', 'legal_name', 'legal_name_en', 'representative', 'bank_name', 'bank_account_number', 'bank_account_name', 'swift_code', 'bank_name_en', 'bank_account_name_en'],
    });
    // 출처 문서 (있다면 제목만)
    let sourcePost = null;
    if (invoice.source_post_id) {
      const p = await Post.findByPk(invoice.source_post_id, { attributes: ['id', 'category', 'title', 'share_token'] });
      if (p) sourcePost = { id: p.id, category: p.category, title: p.title, share_token: p.share_token };
    }
    // 응답 — share_token 자체는 URL 에 노출됨, 응답 메타에 포함 (편의)
    const safe = {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      title: invoice.title,
      status: invoice.status,
      installment_mode: invoice.installment_mode,
      grand_total: invoice.grand_total,
      paid_amount: invoice.paid_amount,
      currency: invoice.currency,
      issued_at: invoice.issued_at,
      due_date: invoice.due_date,
      paid_at: invoice.paid_at,
      notes: invoice.notes,
      payment_terms: invoice.payment_terms,
      notify_paid_at: invoice.notify_paid_at,
      notify_payer_name: invoice.notify_payer_name,
      items: (invoice.items || []).map(it => ({
        id: it.id, name: it.name, description: it.description,
        quantity: it.quantity, unit_price: it.unit_price, amount: it.amount,
      })),
      installments: (invoice.installments || []).map(i => ({
        id: i.id, installment_no: i.installment_no, label: i.label,
        percent: i.percent, amount: i.amount, due_date: i.due_date,
        status: i.status, paid_at: i.paid_at,
        notify_paid_at: i.notify_paid_at, notify_payer_name: i.notify_payer_name,
      })),
      client: invoice.Client ? {
        display_name: invoice.Client.display_name,
        company_name: invoice.Client.company_name,
        biz_name: invoice.Client.biz_name,
      } : null,
      sender: business ? {
        name: business.brand_name || business.name,
        biz_name: business.legal_name,
        biz_name_en: business.legal_name_en,
        biz_ceo: business.representative,
        bank_name: business.bank_name,
        bank_account_number: business.bank_account_number,
        bank_account_name: business.bank_account_name,
        // 해외 송금용 (외화 청구서 시 노출)
        swift_code: business.swift_code,
        bank_name_en: business.bank_name_en,
        bank_account_name_en: business.bank_account_name_en,
      } : null,
      source_post: sourcePost,
    };
    successResponse(res, safe);
  } catch (error) { next(error); }
});

// POST /api/invoices/public/:token/notify-paid — 익명 송금 완료 알림
// body: { installment_id?, payer_name?, payer_memo? }
router.post('/public/:token/notify-paid', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ where: { share_token: req.params.token } });
    if (!invoice) return errorResponse(res, 'not_found', 404);
    if (invoice.status === 'draft' || invoice.status === 'canceled' || invoice.status === 'paid') {
      return errorResponse(res, 'not_available', 400);
    }
    if (invoice.share_expires_at && new Date(invoice.share_expires_at) < new Date()) {
      return res.status(410).json({ success: false, code: 'share_expired', message: 'This share link has expired.' });
    }
    const installmentId = req.body?.installment_id ? Number(req.body.installment_id) : null;
    const payerName = req.body?.payer_name ? String(req.body.payer_name).slice(0, 80).trim() : null;
    const payerMemo = req.body?.payer_memo ? String(req.body.payer_memo).slice(0, 200).trim() : null;

    if (installmentId) {
      const inst = await InvoiceInstallment.findOne({ where: { id: installmentId, invoice_id: invoice.id } });
      if (!inst) return errorResponse(res, 'installment_not_found', 404);
      if (inst.status === 'paid' || inst.status === 'canceled') {
        return errorResponse(res, 'installment_not_available', 400);
      }
      // 동일 5분 내 중복 클릭은 silently 성공 (1회만 기록)
      const recentMs = inst.notify_paid_at ? Date.now() - new Date(inst.notify_paid_at).getTime() : Infinity;
      if (recentMs > 5 * 60 * 1000) {
        await inst.update({
          notify_paid_at: new Date(),
          notify_payer_name: payerName,
          payer_memo: payerMemo || inst.payer_memo,
        });
      }
      // 카드 메타 갱신 (notified)
      await updateInvoiceChatCards(invoice.id, {
        last_notify_at: new Date().toISOString(),
        last_notify_installment_id: inst.id,
        last_notify_label: inst.label,
        status: invoice.status,
      });
      // 확인필요 자동 갱신 (발행자 측)
      const io = req.app.get('io');
      if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'invoice_notify_paid', invoice_id: invoice.id, installment_id: inst.id });
      return successResponse(res, { notified: true, installment_id: inst.id }, 'Notified');
    }

    // 단일 발행 (또는 분할인데 회차 미지정 시 invoice 자체 마킹)
    const recentMs = invoice.notify_paid_at ? Date.now() - new Date(invoice.notify_paid_at).getTime() : Infinity;
    if (recentMs > 5 * 60 * 1000) {
      await invoice.update({
        notify_paid_at: new Date(),
        notify_payer_name: payerName,
      });
    }
    await updateInvoiceChatCards(invoice.id, {
      last_notify_at: new Date().toISOString(),
      last_notify_installment_id: null,
      status: invoice.status,
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'invoice_notify_paid', invoice_id: invoice.id });
    return successResponse(res, { notified: true }, 'Notified');
  } catch (error) { next(error); }
});

// ─── PDF 다운로드 (멤버) — /:businessId 매칭보다 먼저 ───
// 라우트 등록 순서 때문에 위에 (public/* 와 같이 :businessId 매칭 회피)

// ─── PDF 다운로드 (익명 — share_token) ───
// /:businessId 매칭보다 먼저
router.get('/public/:token/pdf', async (req, res, next) => {
  try {
    const inv = await Invoice.findOne({ where: { share_token: req.params.token } });
    if (!inv) return errorResponse(res, 'not_found', 404);
    if (inv.status === 'draft' || inv.status === 'canceled') return errorResponse(res, 'not_available', 404);
    if (inv.share_expires_at && new Date(inv.share_expires_at) < new Date()) {
      return res.status(410).json({ success: false, code: 'share_expired', message: 'This share link has expired.' });
    }
    const { pdf, invoice } = await buildInvoicePdf(inv.id);
    res.setHeader('Content-Type', 'application/pdf');
    const asciiName = (invoice.invoice_number || 'invoice').replace(/[^\w-]/g, '_').slice(0, 80) || 'invoice';
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// N+47 — Smart Routing auth-check. 멤버 또는 invoice 의 client_id 본인이면 in-app 진입.
// /:businessId 매칭보다 먼저 등록 — public/* 패턴 우선.
router.get('/public/:token/auth-check', authenticateToken, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ where: { share_token: req.params.token } });
    if (!invoice) return errorResponse(res, 'not_found', 404);
    const { checkShareExpiry } = require('../services/share_helper');
    if (checkShareExpiry(invoice, res)) return;
    // 멤버 또는 platform_admin → in-app 청구서 탭
    const isPlatformAdmin = req.user.platform_role === 'platform_admin';
    const bm = isPlatformAdmin ? null : await require('../models').BusinessMember.findOne({
      where: { user_id: req.user.id, business_id: invoice.business_id },
    });
    let canAccess = isPlatformAdmin || !!bm;
    // 또는 client 본인 — client_id 매칭
    if (!canAccess && invoice.client_id) {
      const client = await require('../models').Client.findOne({
        where: { id: invoice.client_id, user_id: req.user.id, status: 'active' },
      });
      if (client) canAccess = true;
    }
    return successResponse(res, {
      canAccess,
      appUrl: canAccess ? `/bills?tab=invoices&invoice=${invoice.id}` : null,
    });
  } catch (err) { next(err); }
});

// List invoices — client 면 자기 client_id 의 invoice 만
router.get('/:businessId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const baseWhere = await invoiceListWhere(req.user.id, Number(req.params.businessId), req.scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    const where = { ...baseWhere };
    if (req.query.status) where.status = req.query.status;

    const invoices = await Invoice.findAll({
      where,
      include: [
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'is_business'] },
        { model: InvoiceItem, as: 'items' },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status', 'share_token'], required: false },
      ],
      order: [['created_at', 'DESC']]
    });
    successResponse(res, invoices);
  } catch (error) {
    next(error);
  }
});

// Create invoice (Invoice + Items 를 단일 transaction 으로 원자화)
router.post('/:businessId', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      title, client_id, due_date, recipient_email, recipient_business_name, recipient_business_number,
      notes, items, vat_rate, installment_mode, installments,
      source_post_id, project_id, currency,
    } = req.body;
    if (!title) { await t.rollback(); return errorResponse(res, 'Title required', 400); }

    // 출처 post 검증 — 같은 business 의 published 게시물만 허용 (category 는 자유 분류라 검증 X)
    let sourcePostId = null;
    if (source_post_id) {
      const sp = await Post.findOne({
        where: { id: Number(source_post_id), business_id: req.params.businessId },
        transaction: t,
      });
      if (!sp) { await t.rollback(); return errorResponse(res, 'invalid source_post_id', 400); }
      if (sp.status !== 'published') {
        await t.rollback();
        return errorResponse(res, 'source post must be published', 400);
      }
      sourcePostId = sp.id;
    }

    // 분할 모드 검증
    const mode = installment_mode === 'split' ? 'split' : 'single';
    if (mode === 'split') {
      if (!Array.isArray(installments) || installments.length === 0) {
        await t.rollback(); return errorResponse(res, 'installments required for split mode', 400);
      }
      const sum = installments.reduce((s, x) => s + Number(x.percent || 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        await t.rollback(); return errorResponse(res, `installment percent sum must be 100 (got ${sum})`, 400);
      }
      for (const inst of installments) {
        if (!inst.label || !Number.isFinite(Number(inst.percent))) {
          await t.rollback(); return errorResponse(res, 'each installment requires label and percent', 400);
        }
      }
      if (installments.length > 12) {
        await t.rollback(); return errorResponse(res, 'too many installments (max 12)', 400);
      }
    }

    // 발행 시점 워크스페이스 계좌 정보 스냅샷
    const business = await Business.findByPk(req.params.businessId, { transaction: t });
    const bank_snapshot = business
      ? { bank_name: business.bank_name || null, account_number: business.bank_account_number || null, account_holder: business.bank_account_name || business.name || null }
      : null;

    const invoice_number = await generateInvoiceNumber();
    const vatRateNum = vat_rate !== undefined ? Number(vat_rate) : 0.1;

    const invoice = await Invoice.create({
      business_id: req.params.businessId,
      client_id: client_id || null,
      invoice_number,
      title,
      due_date: due_date || null,
      recipient_email: recipient_email || null,
      recipient_business_name: recipient_business_name || null,
      recipient_business_number: recipient_business_number || null,
      notes: notes || null,
      created_by: req.user.id,
      owner_user_id: req.user.id,  // 담당자 default = 생성자. 발행 모달에서 변경 가능 (사이클 N+9)
      installment_mode: mode,
      bank_snapshot,
      vat_rate: vatRateNum,
      source_post_id: sourcePostId,
      project_id: project_id || null,
      currency: currency || 'KRW',
    }, { transaction: t });

    let grandTotal = 0;
    if (items && items.length > 0) {
      let subtotal = 0;
      const itemRows = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const amount = Number(item.quantity || 1) * Number(item.unit_price || 0);
        subtotal += amount;
        itemRows.push({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          amount,
          sort_order: i,
        });
      }
      await InvoiceItem.bulkCreate(itemRows, { transaction: t });
      const taxAmount = Math.round(subtotal * vatRateNum);
      grandTotal = subtotal + taxAmount;
      await invoice.update({
        total_amount: subtotal,
        subtotal,
        tax_amount: taxAmount,
        grand_total: grandTotal,
      }, { transaction: t });
    }

    // 분할 일정 생성 — amount = grand_total * percent / 100 (정수 반올림, 마지막 row 가 잔여 흡수)
    if (mode === 'split') {
      const insts = installments.map((inst, idx) => ({
        invoice_id: invoice.id,
        installment_no: idx + 1,
        label: String(inst.label).slice(0, 40),
        percent: Number(inst.percent),
        amount: 0,  // 아래서 재계산
        due_date: inst.due_date || null,
        milestone_ref: inst.milestone_ref ? String(inst.milestone_ref).slice(0, 100) : null,
        status: 'pending',
      }));
      // 분배: 마지막 row 가 (grand_total - sum(이전)) 으로 잔여 흡수
      let allocated = 0;
      for (let i = 0; i < insts.length; i++) {
        if (i < insts.length - 1) {
          const a = Math.round(grandTotal * (insts[i].percent / 100));
          insts[i].amount = a;
          allocated += a;
        } else {
          insts[i].amount = grandTotal - allocated;
        }
      }
      await InvoiceInstallment.bulkCreate(insts, { transaction: t });
    }

    await t.commit();

    const result = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status', 'share_token', 'project_id'], required: false },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'is_business', 'country', 'tax_invoice_email', 'billing_contact_email', 'invite_email'] },
      ],
    });
    // Phase D+1: project stage 자동 진행
    if (result?.project_id) require('../services/projectStageEngine').onInvoiceChanged(result.id).catch(() => null);
    broadcastInvoice(req, result, 'invoice:new');
    // 사이클 N+51 — audit 보강. 청구서 생성 = 재무 mutation
    require('../services/auditService').logAudit(req, {
      action: 'invoice.create',
      targetType: 'invoice',
      targetId: result.id,
      newValue: {
        invoice_number: result.invoice_number,
        title: result.title,
        client_id: result.client_id,
        project_id: result.project_id,
        currency: result.currency,
        grand_total: result.grand_total,
        installment_mode: result.installment_mode,
        source_post_id: result.source_post_id,
      },
    });
    successResponse(res, result, 'Invoice created', 201);
  } catch (error) {
    await t.rollback();
    next(error);
  }
});

// ─── 출처 후보: 청구서 발행 모달용 (발행된 post 목록) ───
// GET /:businessId/source-candidates?category=&client_id=
// /:id 라우트보다 위에 정의해야 매칭됨 (Express 등록 순서)
router.get('/:businessId/source-candidates', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const where = { business_id: req.params.businessId, status: 'published' };
    if (req.query.category) where.category = req.query.category;
    const posts = await Post.findAll({
      where,
      attributes: ['id', 'category', 'title', 'status', 'project_id', 'created_at', 'shared_at'],
      order: [['created_at', 'DESC']],
      limit: 50,
    });
    successResponse(res, posts);
  } catch (error) { next(error); }
});

// ─── 채팅방 자동 검색 ───
// GET /:businessId/find-conversation?client_id=X&project_id=Y
router.get('/:businessId/find-conversation', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const clientId = req.query.client_id ? Number(req.query.client_id) : null;
    const projectId = req.query.project_id ? Number(req.query.project_id) : null;
    if (!clientId) return errorResponse(res, 'client_id required', 400);
    const where = { business_id: req.params.businessId, client_id: clientId };
    let conv = null;
    if (projectId) {
      conv = await Conversation.findOne({
        where: { ...where, project_id: projectId },
        attributes: ['id', 'title', 'project_id', 'last_message_at'],
        order: [['last_message_at', 'DESC']],
      });
    }
    if (!conv) {
      conv = await Conversation.findOne({
        where,
        attributes: ['id', 'title', 'project_id', 'last_message_at'],
        order: [['last_message_at', 'DESC']],
      });
    }
    successResponse(res, { conversation: conv, suggest_create: !conv });
  } catch (error) { next(error); }
});

// ─── PDF 다운로드 (멤버) ───
router.get('/:businessId/:id/pdf', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const inv = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!inv) return errorResponse(res, 'not_found', 404);
    if (!(await canAccessInvoice(req.user.id, inv, req.scope))) return errorResponse(res, 'forbidden', 403);
    const { pdf, invoice } = await buildInvoicePdf(inv.id);
    res.setHeader('Content-Type', 'application/pdf');
    const asciiName = (invoice.invoice_number || 'invoice').replace(/[^\w-]/g, '_').slice(0, 80) || 'invoice';
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// Get invoice detail — client 도 자기 invoice 면 통과
router.get('/:businessId/:id', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      include: [
        { model: InvoiceItem, as: 'items', order: [['sort_order', 'ASC']] },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'biz_address_en', 'biz_type', 'biz_item', 'is_business', 'country', 'tax_invoice_email', 'billing_contact_email', 'invite_email'] },
        { model: User, as: 'creator', attributes: ['id', 'name', 'name_localized'] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status', 'share_token', 'project_id', 'shared_at'], required: false },
      ]
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    if (!(await canAccessInvoice(req.user.id, invoice, req.scope))) return errorResponse(res, 'forbidden', 403);
    successResponse(res, invoice);
  } catch (error) {
    next(error);
  }
});

// ─── Invoice 발송 (draft → sent) ───
// 발송 시 invoice + installments status='sent' 동시
// body: { send_chat?: boolean, send_email?: boolean, message?: string }
//  - send_chat: 해당 client/project 의 기존 conversation 자동 검색 → 결제 요청 카드 메시지 (없으면 무시)
//  - send_email: 공개 링크 + 메모로 이메일 발송 (recipient_email 또는 client.email)
//  - 새 채팅방 자동 생성 금지
router.post('/:businessId/:id/send', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  const t = await sequelize.transaction();
  try {
    const { send_chat = false, send_email = false, message = '', expires_in_days } = req.body || {};

    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    if (invoice.status !== 'draft') { await t.rollback(); return errorResponse(res, 'invalid_state — only draft can be sent', 400); }
    const crypto = require('crypto');
    const prevStatus = invoice.status;
    const updates = { status: 'sent', issued_at: new Date(), sent_at: new Date() };
    if (!invoice.share_token) updates.share_token = crypto.randomBytes(32).toString('hex');
    // N+43: share_token 만료 — 청구서는 due_date 와 무관하게 default 무제한 (사용자가 받은 결제 링크가
    // 만료되어 결제 못 하면 사고). 사용자가 명시적 expires_in_days 줬을 때만 적용.
    if (Number.isFinite(Number(expires_in_days)) && Number(expires_in_days) > 0) {
      updates.share_expires_at = new Date(Date.now() + Number(expires_in_days) * 86400 * 1000);
    }
    await invoice.update(updates, { transaction: t });
    // 사이클 N+21 — status history 박제 (트랜잭션 outside, best-effort)
    setImmediate(() => recordInvoiceStatusChange(invoice, prevStatus, 'sent', req.user.id, 'send invoice'));
    if (invoice.installment_mode === 'split') {
      await InvoiceInstallment.update(
        { status: 'sent' },
        { where: { invoice_id: invoice.id, status: 'pending' }, transaction: t }
      );
    }
    await t.commit();

    // 발송 채널 처리 (post-commit)
    const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
    const shareUrl = `${APP_URL}/public/invoices/${invoice.share_token}`;
    const deliver = { chat: null, email: null };

    // ① 채팅방 카드 메시지 (자동 검색 — 새 방 생성 X)
    if (send_chat && invoice.client_id) {
      try {
        // project_id 우선, 없으면 client_id 단독
        const where = { business_id: req.params.businessId, client_id: invoice.client_id };
        let conv = null;
        if (invoice.project_id) {
          conv = await Conversation.findOne({ where: { ...where, project_id: invoice.project_id }, order: [['last_message_at', 'DESC']] });
        }
        if (!conv) conv = await Conversation.findOne({ where, order: [['last_message_at', 'DESC']] });

        if (conv) {
          const userMessage = String(message || '').slice(0, 1000);
          const fallback = userMessage
            ? `[청구서] ${invoice.invoice_number} · ${invoice.title} — ${userMessage}`
            : `[청구서] ${invoice.invoice_number} · ${invoice.title}`;
          const msg = await Message.create({
            conversation_id: conv.id,
            sender_id: req.user.id,
            content: fallback,
            kind: 'card',
            meta: {
              card_type: 'invoice',
              invoice_id: invoice.id,
              invoice_number: invoice.invoice_number,
              share_token: invoice.share_token,
              share_url: shareUrl,
              title: invoice.title,
              total: Number(invoice.grand_total || 0),
              currency: invoice.currency,
              installment_mode: invoice.installment_mode,
              status: 'sent',
              paid_at: null,
              last_notify_at: null,
              last_notify_installment_id: null,
              note: userMessage || null,
            },
          });
          await conv.update({ last_message_at: new Date() });
          deliver.chat = { conversation_id: conv.id, message_id: msg.id };
        } else {
          deliver.chat = { error: 'no_conversation_for_client' };
        }
      } catch (err) {
        deliver.chat = { error: err.message };
      }
    }

    // ② 이메일 발송 (우선순위: recipient_email → tax_invoice_email → billing_contact_email → invite_email)
    //    + PDF 자동 첨부 + 워크스페이스 발신자 표시이름
    if (send_email) {
      try {
        const { sendInvoiceEmail } = require('../services/emailService');
        let recipient = invoice.recipient_email;
        if (!recipient && invoice.client_id) {
          const cl = await Client.findByPk(invoice.client_id, { attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'] });
          recipient = cl?.tax_invoice_email || cl?.billing_contact_email || cl?.invite_email || null;
        }
        if (!recipient) {
          deliver.email = { error: 'no_recipient_email' };
        } else {
          const business = await Business.findByPk(req.params.businessId, {
            attributes: ['name', 'brand_name', 'mail_from_name', 'mail_reply_to'],
          });
          const sender = await User.findByPk(req.user.id, { attributes: ['name'] });

          // PDF 첨부 — 발송 실패해도 메일 자체는 진행 (best-effort)
          let attachments = null;
          try {
            const { pdf } = await buildInvoicePdf(invoice.id);
            attachments = [{
              filename: `${invoice.invoice_number || 'invoice'}.pdf`,
              content: pdf,
              contentType: 'application/pdf',
            }];
          } catch (pdfErr) {
            console.warn('[invoice send] PDF attach failed:', pdfErr.message);
          }

          const ok = await sendInvoiceEmail({
            to: recipient,
            invoiceNumber: invoice.invoice_number,
            title: invoice.title,
            total: Number(invoice.grand_total || 0),
            currency: invoice.currency,
            dueDate: invoice.due_date,
            senderName: sender?.name || '',
            workspaceName: business?.brand_name || business?.name || '',
            message: String(message || '').slice(0, 1000) || null,
            shareUrl,
            attachments,
            fromName: business?.mail_from_name || business?.brand_name || business?.name || null,
            replyTo: business?.mail_reply_to || null,
          });
          deliver.email = { to: recipient, sent: ok, pdf_attached: !!attachments };
        }
      } catch (err) {
        deliver.email = { error: err.message };
      }
    }

    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Post, as: 'sourcePost', attributes: ['id', 'category', 'title', 'status'], required: false },
      ],
    });
    if (refreshed?.project_id) require('../services/projectStageEngine').onInvoiceChanged(refreshed.id).catch(() => null);
    // 사이클 N+51 — audit 보강. draft → sent 전이 + 발송 채널 기록
    require('../services/auditService').logAudit(req, {
      action: 'invoice.send',
      targetType: 'invoice',
      targetId: invoice.id,
      oldValue: { status: 'draft' },
      newValue: {
        status: 'sent',
        invoice_number: invoice.invoice_number,
        deliver_chat: !!deliver.chat,
        deliver_email: !!deliver.email && !deliver.email.error,
        share_expires_at: invoice.share_expires_at,
      },
    });
    successResponse(res, { invoice: refreshed, deliver }, 'Invoice sent');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// (이동됨: source-candidates / find-conversation 은 라우트 매칭 순서를 위해 위(GET /:businessId 다음)로 이동)

// ─── 결제 독촉(리마인더) 수동 발송 — 미결제 청구서에 운영자가 직접 발송 ───
// overdue_handler 자동 단계 발송과 별개. qbill write 권한자(owner/admin/member) 사용.
router.post('/:businessId/:id/send-reminder', authenticateToken, reminderLimiter, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    // 미결제 상태만 독촉 가능 (draft/paid/canceled 제외)
    if (!['sent', 'partially_paid', 'overdue'].includes(invoice.status)) {
      return errorResponse(res, 'not_remindable', 400);
    }
    if (!invoice.client_id) return errorResponse(res, 'no_client', 400);
    const client = await Client.findByPk(invoice.client_id);
    const recipient = client && (client.tax_invoice_email || client.billing_contact_email || client.invite_email);
    if (!recipient) return errorResponse(res, 'no_recipient', 400);

    // 같은 청구서 도배 방지 — 6시간 쿨다운
    const meta = (invoice.meta && typeof invoice.meta === 'object') ? { ...invoice.meta } : {};
    if (meta.last_reminder_at) {
      const elapsed = Date.now() - new Date(meta.last_reminder_at).getTime();
      if (elapsed < REMINDER_COOLDOWN_MS) {
        const retryMin = Math.ceil((REMINDER_COOLDOWN_MS - elapsed) / 60000);
        return res.status(429).json({ success: false, message: 'reminder_cooldown', retry_after_minutes: retryMin });
      }
    }

    // share_token 보장 (없으면 발급)
    let shareToken = invoice.share_token;
    if (!shareToken) {
      shareToken = require('crypto').randomBytes(32).toString('hex');
    }

    const business = await Business.findByPk(businessId);
    const wsName = business?.brand_name || business?.name || 'PlanQ';
    const daysOverdue = invoice.due_date
      ? Math.max(0, Math.floor((Date.now() - new Date(invoice.due_date).getTime()) / 86400000))
      : 0;
    const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/invoice/${shareToken}`;
    const customMsg = req.body?.message ? String(req.body.message).slice(0, 1000) : '';

    const { sendPaymentReminderEmail } = require('../services/emailService');
    const sent = await sendPaymentReminderEmail({
      to: recipient,
      invoiceNumber: invoice.invoice_number,
      title: invoice.title,
      total: invoice.grand_total,
      currency: invoice.currency || 'KRW',
      dueDate: invoice.due_date,
      daysOverdue,
      workspaceName: wsName,
      message: customMsg,
      shareUrl,
      fromName: business?.mail_from_name || business?.brand_name || business?.name || null,
      replyTo: business?.mail_reply_to || null,
      businessId,
      invoiceId: invoice.id,
    });
    if (!sent) return errorResponse(res, 'email_send_failed', 502);

    meta.last_reminder_at = new Date().toISOString();
    meta.reminder_count = (Number(meta.reminder_count) || 0) + 1;
    await invoice.update({ meta, share_token: shareToken });

    require('../services/auditService').logAudit(req, {
      action: 'invoice.send_reminder',
      targetType: 'invoice',
      targetId: invoice.id,
      newValue: { invoice_number: invoice.invoice_number, recipient, days_overdue: daysOverdue, reminder_count: meta.reminder_count },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${businessId}`).emit('invoice:updated', invoice.toJSON());

    return successResponse(res, { sent: true, last_reminder_at: meta.last_reminder_at, reminder_count: meta.reminder_count }, 'reminder_sent');
  } catch (error) { next(error); }
});

// ─── Installment: 결제 완료 마킹 ───
router.post('/:businessId/:id/installments/:installId/mark-paid', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  const t = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }, transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id }, transaction: t,
    });
    if (!inst) { await t.rollback(); return errorResponse(res, 'Installment not found', 404); }
    if (inst.status === 'paid' || inst.status === 'canceled') {
      await t.rollback(); return errorResponse(res, 'invalid_state', 400);
    }
    const paidAt = req.body?.paid_at ? new Date(req.body.paid_at) : new Date();
    const memo = req.body?.payer_memo ? String(req.body.payer_memo).slice(0, 200) : null;
    await inst.update({
      status: 'paid', paid_at: paidAt, payer_memo: memo,
      marked_by_user_id: req.user.id, marked_at: new Date(),
    }, { transaction: t });

    // Invoice paid_amount + status 자동 갱신
    const all = await InvoiceInstallment.findAll({ where: { invoice_id: invoice.id }, transaction: t });
    const paidSum = all.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
    const totalSum = all.reduce((s, i) => s + Number(i.amount), 0);
    const prevInvoiceStatus = invoice.status;
    const newStatus = paidSum >= totalSum ? 'paid' : (paidSum > 0 ? 'partially_paid' : invoice.status);
    await invoice.update({
      paid_amount: paidSum,
      status: newStatus,
      paid_at: newStatus === 'paid' ? new Date() : invoice.paid_at,
    }, { transaction: t });

    await t.commit();
    // 사이클 N+21 — status history (installment mark-paid 로 인한 자동 전이)
    setImmediate(() => recordInvoiceStatusChange(invoice, prevInvoiceStatus, newStatus, req.user.id, 'installment mark-paid'));
    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [{ model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] }],
    });
    // 채팅 카드 동기 (best-effort)
    await updateInvoiceChatCards(invoice.id, {
      status: refreshed.status,
      paid_at: refreshed.paid_at ? new Date(refreshed.paid_at).toISOString() : null,
      paid_amount: Number(refreshed.paid_amount || 0),
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'installment_paid', invoice_id: invoice.id });
    if (refreshed?.project_id) require('../services/projectStageEngine').onInvoiceChanged(refreshed.id).catch(() => null);
    if (newStatus === 'paid') {
      require('../services/overdue_handler').unpauseProjectIfApplicable(refreshed).catch(() => null);
    }
    require('../services/auditService').logAudit(req, {
      action: 'invoice.installment.mark_paid',
      targetType: 'invoice_installment',
      targetId: inst.id,
      newValue: { invoice_id: invoice.id, installment_no: inst.installment_no, paid_at: paidAt, payer_memo: memo, invoice_status: newStatus },
    });
    successResponse(res, refreshed, 'Installment paid');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// ─── Installment: 결제 완료 마킹 취소 ───
router.post('/:businessId/:id/installments/:installId/unmark-paid', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  const t = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }, transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id }, transaction: t,
    });
    if (!inst || inst.status !== 'paid') { await t.rollback(); return errorResponse(res, 'not_paid', 400); }
    await inst.update({ status: 'sent', paid_at: null, marked_by_user_id: null, marked_at: null, payer_memo: null }, { transaction: t });
    const all = await InvoiceInstallment.findAll({ where: { invoice_id: invoice.id }, transaction: t });
    const paidSum = all.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
    const totalSum = all.reduce((s, i) => s + Number(i.amount), 0);
    const prevStatus = invoice.status;
    const newStatus = paidSum >= totalSum ? 'paid' : (paidSum > 0 ? 'partially_paid' : 'sent');
    await invoice.update({ paid_amount: paidSum, status: newStatus, paid_at: newStatus === 'paid' ? invoice.paid_at : null }, { transaction: t });
    await t.commit();
    // 사이클 N+21 — status history
    setImmediate(() => recordInvoiceStatusChange(invoice, prevStatus, newStatus, req.user.id, 'installment unmark-paid'));
    const refreshed = await Invoice.findByPk(invoice.id, {
      include: [{ model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] }],
    });
    // 채팅 카드 동기 (best-effort)
    await updateInvoiceChatCards(invoice.id, {
      status: refreshed.status,
      paid_at: refreshed.paid_at ? new Date(refreshed.paid_at).toISOString() : null,
      paid_amount: Number(refreshed.paid_amount || 0),
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'installment_unpaid', invoice_id: invoice.id });
    if (refreshed?.project_id) require('../services/projectStageEngine').onInvoiceChanged(refreshed.id).catch(() => null);
    require('../services/auditService').logAudit(req, {
      action: 'invoice.installment.unmark_paid',
      targetType: 'invoice_installment',
      targetId: inst.id,
      newValue: { invoice_id: invoice.id, installment_no: inst.installment_no, invoice_status: newStatus },
    });
    successResponse(res, refreshed, 'Installment payment unmarked');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// ─── Installment: 세금계산서 발행 마킹 ───
router.post('/:businessId/:id/installments/:installId/mark-tax-invoice', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id },
    });
    if (!inst) return errorResponse(res, 'Installment not found', 404);
    const no = req.body?.tax_invoice_no ? String(req.body.tax_invoice_no).slice(0, 50) : null;
    const at = req.body?.tax_invoice_at ? new Date(req.body.tax_invoice_at) : new Date();
    if (!no) return errorResponse(res, 'tax_invoice_no required', 400);
    await inst.update({ tax_invoice_no: no, tax_invoice_at: at, tax_invoice_marked_by: req.user.id });
    // 사이클 N+51 — audit. 세금계산서 발행 마킹 (한국 사업자 컴플라이언스)
    require('../services/auditService').logAudit(req, {
      action: 'invoice.installment.mark_tax_invoice',
      targetType: 'invoice_installment',
      targetId: inst.id,
      newValue: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        installment_no: inst.installment_no,
        tax_invoice_no: no,
        tax_invoice_at: at,
      },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'tax_invoice_issued', invoice_id: invoice.id });
    if (invoice?.project_id) require('../services/projectStageEngine').onInvoiceChanged(invoice.id).catch(() => null);

    // 멤버 알림 — 세금계산서 발행 마킹
    try {
      const { Op } = require('sequelize');
      const { BusinessMember, Business } = require('../models');
      const { notifyMany } = require('./notifications');
      const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name'] });
      const members = await BusinessMember.findAll({
        where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
        attributes: ['user_id'],
      });
      notifyMany({
        userIds: members.map((m) => m.user_id),
        businessId: invoice.business_id, eventKind: 'tax_invoice',
        title: '세금계산서 발행 완료',
        body: `${invoice.invoice_number} ${inst.label || ''} 회차 발행번호 ${no}`,
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?invoice=${invoice.id}`,
        ctaLabel: '청구서 보기',
        workspaceName: biz?.brand_name || biz?.name || null,
        excludeUserId: req.user.id,
      }).catch((e) => console.warn('[notify tax_invoice]', e.message));
    } catch (e) { console.warn('[tax_invoice notify outer]', e.message); }

    successResponse(res, inst, 'Tax invoice marked');
  } catch (error) { next(error); }
});

// ─── Invoice: 삭제 (draft / canceled 만 허용) ───
router.delete('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    if (!['draft', 'canceled'].includes(invoice.status)) {
      return errorResponse(res, 'only_draft_or_canceled_can_be_deleted', 400, { current_status: invoice.status });
    }
    // installments + items + invoice 삭제 (cascade 안 되어 있으면 명시)
    // FK 정책: invoice_items / invoice_installments 모두 ON DELETE 미명시 → 명시 destroy 필요
    await InvoiceInstallment.destroy({ where: { invoice_id: invoice.id } });
    await InvoiceItem.destroy({ where: { invoice_id: invoice.id } });
    const snap = {
      id: invoice.id,
      business_id: invoice.business_id,
      invoice_number: invoice.invoice_number,
      title: invoice.title,
      status: invoice.status,
      grand_total: invoice.grand_total,
      currency: invoice.currency,
    };
    await invoice.destroy();
    broadcastInvoice(req, snap, 'invoice:deleted');
    // 사이클 N+51 — audit. 청구서 삭제 = 재무 mutation
    require('../services/auditService').logAudit(req, {
      action: 'invoice.delete',
      targetType: 'invoice',
      targetId: snap.id,
      oldValue: snap,
    });
    return successResponse(res, { deleted: true });
  } catch (err) { next(err); }
});

// ─── Installment: 취소 ───
router.delete('/:businessId/:id/installments/:installId', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const inst = await InvoiceInstallment.findOne({
      where: { id: req.params.installId, invoice_id: invoice.id },
    });
    if (!inst) return errorResponse(res, 'Installment not found', 404);
    if (inst.status === 'paid') return errorResponse(res, 'cannot_cancel_paid', 400);
    const prevStatus = inst.status;
    await inst.update({ status: 'canceled' });
    // 사이클 N+51 — audit. installment 취소
    require('../services/auditService').logAudit(req, {
      action: 'invoice.installment.cancel',
      targetType: 'invoice_installment',
      targetId: inst.id,
      oldValue: { status: prevStatus },
      newValue: {
        status: 'canceled',
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        installment_no: inst.installment_no,
        amount: inst.amount,
      },
    });
    successResponse(res, inst, 'Installment canceled');
  } catch (error) { next(error); }
});

// Update invoice status
router.patch('/:businessId/:id/status', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  try {
    // 인보이스 상태 변경(특히 'paid')은 owner 또는 platform_admin 만
    if (req.businessRole !== 'owner' && req.user.platform_role !== 'platform_admin') {
      return errorResponse(res, 'owner_only', 403);
    }
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId }
    });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);

    const { status } = req.body;
    const validStatuses = ['draft', 'sent', 'paid', 'overdue', 'canceled'];
    if (!validStatuses.includes(status)) {
      return errorResponse(res, 'Invalid status', 400);
    }

    const prevStatus = invoice.status;
    const updates = { status };
    if (status === 'sent' && !invoice.sent_at) {
      updates.sent_at = new Date();
      updates.issued_at = new Date();
    }
    if (status === 'paid') updates.paid_at = new Date();
    if (status === 'canceled') updates.paid_at = null;

    await invoice.update(updates);
    // 사이클 N+21 — status history
    setImmediate(() => recordInvoiceStatusChange(invoice, prevStatus, status, req.user.id, 'PATCH /:id/status'));

    require('../services/auditService').logAudit(req, {
      action: 'invoice.status.change',
      targetType: 'invoice',
      targetId: invoice.id,
      oldValue: { status: prevStatus },
      newValue: { status },
    });

    // 채팅 카드 동기 (단일 발행 청구서의 PATCH status 도 카드 갱신)
    await updateInvoiceChatCards(invoice.id, {
      status: invoice.status,
      paid_at: invoice.paid_at ? new Date(invoice.paid_at).toISOString() : null,
      paid_amount: Number(invoice.paid_amount || 0),
    });

    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'invoice_status', invoice_id: invoice.id, status });

    if (status === 'paid') {
      require('../services/overdue_handler').unpauseProjectIfApplicable(invoice).catch(() => null);
    }

    successResponse(res, invoice);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
