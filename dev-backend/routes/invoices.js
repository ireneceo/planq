const express = require('express');
const router = express.Router();
const { Invoice, InvoiceItem, InvoiceInstallment, Client, User, Business, Post, Conversation, Message, ReceiptCorrection } = require('../models');
const { resolveRecurringInfo } = require('../services/invoiceRecurring');
const { logBillEvent, listBillEvents } = require('../services/billEvents');
const { authenticateToken, optionalAuth, checkBusinessAccess } = require('../middleware/auth');
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
  keyGenerator: (req) => (req.user?.id ? `invoice-remind-u${req.user.id}` : `invoice-remind-ip${ipKeyGenerator(req.ip)}`),
  message: { success: false, message: 'too_many_reminders' },
});
const REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 같은 청구서 6시간 쿨다운

// 한국 사업자등록번호 체크섬 검증 — 형식(10자리)만으로는 오타를 못 잡아 owner 가 홈택스 헛걸음.
// 가중치 [1,3,7,1,3,7,1,3,5] + 9번째 자리 보정. 발행 전 단계에서 오타 차단.
function isValidKrBizNo(taxId) {
  const d = String(taxId || '').replace(/[^0-9]/g, '');
  if (d.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[9]);
}

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

// #77 — 발행 증빙 첨부 파일 검증. 워크스페이스 소유 + 미삭제 File 만 허용(cross-tenant 차단).
// body.file_id 없으면 undefined 반환(update 미포함 → 재마킹 시 기존 파일 보존).
async function resolveReceiptFileId(fileId, businessId) {
  if (fileId === undefined || fileId === null || fileId === '') return undefined;
  const { File } = require('../models');
  const f = await File.findOne({
    where: { id: Number(fileId), business_id: businessId, deleted_at: null },
    attributes: ['id'],
  });
  return f ? f.id : undefined; // 유효치 않으면 무시(첨부 없이 발행 마킹은 정상)
}

// PDF 다운로드 helper — 공통
// 열람(viewed) 신뢰성 — 봇/이메일스캐너/프리페치가 공개 링크를 여는 걸 '고객 열람'으로 오인 방지.
//   Gmail 이미지프록시·MS SafeLinks·기업 메일보안(Proofpoint/Mimecast 등)·크롤러·CLI 툴·헤드리스는 실 고객 아님.
//   UA 없음/비정상도 제외 (실 브라우저는 항상 UA 를 보냄).
const BOT_UA_RE = /bot|crawl|spider|slurp|preview|scan|fetch|monitor|validator|proxy|safelinks|proofpoint|mimecast|barracuda|symantec|forcepoint|headless|phantom|python-requests|curl|wget|go-http|okhttp|java\/|facebookexternalhit|whatsapp|telegram|slackbot|discord|twitterbot|linkedinbot|googleimageproxy|ggpht|feedfetcher|apache-httpclient|axios\//i;
function isBotOrScanner(req) {
  const ua = String(req.headers['user-agent'] || '').trim();
  if (!ua || ua.length < 15) return true;           // UA 없음/비정상 = 실 브라우저 아님 (CLI·스캐너)
  if (BOT_UA_RE.test(ua)) return true;              // 알려진 봇/스캐너/프리페치/메일보안
  return false;
}

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
// 운영 — robust: INV-YYYY- prefix 전체에서 실제 최대 순번 스캔 (깨진 번호 skip).
//   기존 "last by id" 는 비표준/누락 번호에서 NaN, 동시 생성 시 중복 위험. max-scan 으로 안정화.
const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const rows = await Invoice.findAll({
    where: { invoice_number: { [Op.like]: `${prefix}%` } },
    attributes: ['invoice_number'],
  });
  let max = 0;
  for (const r of rows) {
    const m = /-(\d+)$/.exec(r.invoice_number || '');
    if (m) { const v = parseInt(m[1], 10); if (Number.isFinite(v) && v > max) max = v; }
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
};

// ─── 공개 결제 페이지 (인증 없음 — share_token 기반) ───
// /:businessId 매칭보다 먼저 와야 함

// GET /api/invoices/public/:token — 익명 청구서 조회 (계좌 + 분할 + 발신/고객 + 알림 상태)
router.get('/public/:token', optionalAuth, async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({
      where: { share_token: req.params.token },
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_ceo', 'biz_tax_id', 'biz_type', 'biz_item', 'biz_address', 'tax_invoice_email', 'billing_contact_name', 'billing_contact_email', 'billing_contact_phone', 'is_business', 'country'] },
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
    // 내부(발신 측) 조회는 '열람'으로 기록하지 않음 — 발신자 본인/멤버가 링크를 열어도
    // 고객 열람으로 오인되던 문제 방지. optionalAuth 로 토큰이 있으면 req.user 세팅됨.
    let isInternalViewer = false;
    if (req.user) {
      if (req.user.platform_role === 'platform_admin') {
        isInternalViewer = true;
      } else {
        const bm = await require('../models').BusinessMember.findOne({
          where: { user_id: req.user.id, business_id: invoice.business_id },
        });
        if (bm) isInternalViewer = true;
      }
    }
    // 첫 열람 기록 — 실제 외부(고객) 조회만. 내부 멤버 + 봇/이메일스캐너/프리페치 제외.
    const isBot = isBotOrScanner(req);
    const skipViewed = isInternalViewer || isBot;
    const isFirstView = !invoice.viewed_at;
    if (isFirstView && !skipViewed) {
      try { await invoice.update({ viewed_at: new Date() }); } catch {}
    }
    // Q Bill 타임라인 — 고객 열람만. 60분 dedupe 로 새로고침 도배 collapse.
    if (!skipViewed) {
      await logBillEvent('invoice', invoice.id, 'viewed', { detail: { first: isFirstView }, dedupeWindowMs: 60 * 60 * 1000 });
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
      recurring: await resolveRecurringInfo(invoice),   // #92 — 정기 발송 기준(구독)
      notify_paid_at: invoice.notify_paid_at,
      notify_payer_name: invoice.notify_payer_name,
      items: (invoice.items || []).map(it => ({
        id: it.id, description: it.description, detail: it.detail,
        quantity: it.quantity, unit_price: it.unit_price, amount: it.amount,
      })),
      installments: (invoice.installments || []).map(i => ({
        id: i.id, installment_no: i.installment_no, label: i.label,
        percent: i.percent, amount: i.amount, due_date: i.due_date,
        status: i.status, paid_at: i.paid_at,
        notify_paid_at: i.notify_paid_at, notify_payer_name: i.notify_payer_name,
        // #77 — 발행된 증빙 파일 존재 여부 (다운로드 버튼 표시)
        tax_invoice_file: !!i.tax_invoice_file_id, cash_receipt_file: !!i.cash_receipt_file_id,
      })),
      client: invoice.Client ? {
        display_name: invoice.Client.display_name,
        company_name: invoice.Client.company_name,
        biz_name: invoice.Client.biz_name,
      } : null,
      // 외부 직접입력 수신(클라이언트 없음) 의 표시명 — 헤더 "발신 › 수신" 에서 사용
      recipient_business_name: invoice.recipient_business_name || null,
      // ─── 증빙(세금계산서/현금영수증) — 고객이 공개 페이지에서 직접 입력·확인 (송금완료 알림과 같은 자리) ───
      // 등록 고객은 Client 값으로 prefill, 외부 고객은 invoice.receipt_profile 또는 빈 폼.
      receipt: {
        payment_method: invoice.payment_method,
        receipt_type: invoice.receipt_type,
        tax_invoice_status: invoice.tax_invoice_status,
        cash_receipt_status: invoice.cash_receipt_status,
        requested_at: invoice.receipt_requested_at,
        // 고객이 이미 제출한 값(있으면) — 없으면 등록 고객 Client 값으로 prefill 힌트
        profile: invoice.receipt_profile || (invoice.Client ? {
          biz_type: invoice.Client.is_business ? 'business' : 'individual',
          biz_name: invoice.Client.biz_name || invoice.Client.company_name || null,
          biz_tax_id: invoice.Client.biz_tax_id || invoice.recipient_business_number || null,
          biz_ceo: invoice.Client.biz_ceo || null,
          biz_category: invoice.Client.biz_type || null,
          biz_item: invoice.Client.biz_item || null,
          biz_address: invoice.Client.biz_address || null,
          tax_email: invoice.Client.tax_invoice_email || invoice.Client.billing_contact_email || null,
          requested_by_name: invoice.Client.billing_contact_name || null,
          contact_phone: invoice.Client.billing_contact_phone || null,
          // 개인(현금영수증) 식별번호 — 지난 신청 시 저장한 연락처를 다음에도 자동 채움
          cr_identifier: !invoice.Client.is_business ? (invoice.Client.billing_contact_phone || null) : null,
        } : (invoice.recipient_business_name || invoice.recipient_business_number ? {
          biz_type: 'business',
          biz_name: invoice.recipient_business_name || null,
          biz_tax_id: invoice.recipient_business_number || null,
        } : null)),
        is_registered_client: !!invoice.client_id,
        client_country: invoice.Client?.country || null,
        // #77 — 발행된 증빙 파일 존재 여부 (invoice 레벨, 다운로드 버튼 표시)
        tax_invoice_file: !!invoice.tax_invoice_file_id,
        cash_receipt_file: !!invoice.cash_receipt_file_id,
      },
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

// #77 — 공개 청구서 페이지에서 발행된 증빙 파일(세금계산서/현금영수증) 다운로드.
// 인증 = share_token (공개 청구서와 동일). kind=tax|cash, installId 있으면 회차별.
router.get('/public/:token/receipt-file', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ where: { share_token: req.params.token } });
    if (!invoice || invoice.status === 'draft' || invoice.status === 'canceled') {
      return errorResponse(res, 'not_found', 404);
    }
    if (invoice.share_expires_at && new Date(invoice.share_expires_at) < new Date()) {
      return errorResponse(res, 'share_expired', 410);
    }
    const kind = req.query.kind === 'cash' ? 'cash' : 'tax';
    const installId = req.query.installId ? Number(req.query.installId) : null;
    let fileId = null;
    if (installId) {
      const inst = await InvoiceInstallment.findOne({
        where: { id: installId, invoice_id: invoice.id },
        attributes: ['tax_invoice_file_id', 'cash_receipt_file_id'],
      });
      if (inst) fileId = kind === 'cash' ? inst.cash_receipt_file_id : inst.tax_invoice_file_id;
    } else {
      fileId = kind === 'cash' ? invoice.cash_receipt_file_id : invoice.tax_invoice_file_id;
    }
    if (!fileId) return errorResponse(res, 'receipt_file_not_found', 404);

    const { File } = require('../models');
    const file = await File.findOne({ where: { id: fileId, business_id: invoice.business_id, deleted_at: null } });
    if (!file) return errorResponse(res, 'file_not_found', 404);

    const fs = require('fs');
    const path = require('path');
    const abs = path.isAbsolute(file.file_path) ? file.file_path : path.join(__dirname, '..', file.file_path);
    if (!fs.existsSync(abs)) return errorResponse(res, 'file_missing_on_disk', 410);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    fs.createReadStream(abs).pipe(res);
  } catch (error) { next(error); }
});

// 고객 송금완료 알림 → 발행자(owner/admin/청구담당자)에게 실제 알림(OS push + 알림함) 발송.
// feedback_notify_trigger_required — 옛 notify-paid 는 inbox:refresh socket 만 보내 알림이 영영 0 이던 회귀.
async function notifyOwnerPaymentNotified(invoice, { label, payerName, ioApp }) {
  try {
    const { Op } = require('sequelize');
    const { BusinessMember, Business } = require('../models');
    const { notifyMany } = require('./notifications');
    const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name', 'default_billing_owner_id'] });
    // 수신자: owner/admin 멤버 + 청구 담당자(owner_user_id) + 워크스페이스 기본 청구담당자
    const members = await BusinessMember.findAll({
      where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
      attributes: ['user_id'],
    });
    const ids = new Set(members.map((m) => m.user_id));
    if (invoice.owner_user_id) ids.add(invoice.owner_user_id);
    if (biz?.default_billing_owner_id) ids.add(biz.default_billing_owner_id);
    if (ids.size === 0) return;
    const who = payerName ? `${payerName} 님이` : '고객이';
    await notifyMany({
      userIds: [...ids],
      businessId: invoice.business_id, eventKind: 'payment',
      title: '송금 완료 알림 도착',
      body: `${invoice.invoice_number}${label ? ` ${label}` : ''} — ${who} 송금 완료를 알렸습니다. 입금 확인 후 처리해주세요.`,
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
      ctaLabel: '청구서 보기',
      workspaceName: biz?.brand_name || biz?.name || null,
      entityType: 'invoice', entityId: invoice.id, ioApp,
    });
  } catch (e) { console.warn('[notify-paid owner notify]', e.message); }
}

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
      // 동일 5분 내 중복 클릭은 silently 성공 (1회만 기록 + 1회만 알림)
      const recentMs = inst.notify_paid_at ? Date.now() - new Date(inst.notify_paid_at).getTime() : Infinity;
      const isFresh = recentMs > 5 * 60 * 1000;
      if (isFresh) {
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
      // 발행자 알림 — 중복 클릭 spam 방지: 신규 알림일 때만 (recentMs 가드 안)
      if (isFresh) {
        await notifyOwnerPaymentNotified(invoice, { label: inst.label, payerName, ioApp: req.app });
        // Q Bill 타임라인 — 고객 입금 통보(미확정. owner mark-paid 시 paid_partial/full). actor=null(고객).
        await logBillEvent('invoice', invoice.id, 'commented', { detail: { kind: 'payment_notified', installment_no: inst.installment_no, label: inst.label, payer_name: payerName, amount: inst.amount } });
      }
      return successResponse(res, { notified: true, installment_id: inst.id }, 'Notified');
    }

    // 단일 발행 (또는 분할인데 회차 미지정 시 invoice 자체 마킹)
    const recentMs = invoice.notify_paid_at ? Date.now() - new Date(invoice.notify_paid_at).getTime() : Infinity;
    const isFresh = recentMs > 5 * 60 * 1000;
    if (isFresh) {
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
    // 발행자 알림 — 중복 클릭 spam 방지: 신규 알림일 때만
    if (isFresh) {
      await notifyOwnerPaymentNotified(invoice, { label: null, payerName, ioApp: req.app });
      // Q Bill 타임라인 — 고객 입금 통보(미확정). actor=null(고객).
      await logBillEvent('invoice', invoice.id, 'commented', { detail: { kind: 'payment_notified', payer_name: payerName, amount: invoice.grand_total } });
    }
    return successResponse(res, { notified: true }, 'Notified');
  } catch (error) { next(error); }
});

// POST /api/invoices/public/:token/receipt-request — 익명 증빙(세금계산서/현금영수증) 신청·확인
// 고객이 공개 결제 페이지에서 자기 증빙정보를 직접 입력·확인 → owner 가 확인된 정보로 발행 (오타·세무 리스크 차단)
// body: { biz_type:'business'|'individual',
//         biz_name, biz_tax_id, biz_ceo, biz_category, biz_item, biz_address, tax_email,   // 사업자(세금계산서)
//         cr_purpose:'income_deduction'|'expense_proof', cr_identifier,                     // 개인(현금영수증)
//         requested_by_name }
router.post('/public/:token/receipt-request', async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ where: { share_token: req.params.token } });
    if (!invoice) return errorResponse(res, 'not_found', 404);
    if (invoice.status === 'draft' || invoice.status === 'canceled') {
      return errorResponse(res, 'not_available', 400);
    }
    if (invoice.share_expires_at && new Date(invoice.share_expires_at) < new Date()) {
      return res.status(410).json({ success: false, code: 'share_expired', message: 'This share link has expired.' });
    }
    const b = req.body || {};
    const bizType = b.biz_type === 'individual' ? 'individual' : 'business';
    const s = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
    const digits = (v) => (v == null ? '' : String(v).replace(/[^0-9]/g, ''));

    let profile, receiptType, statusPatch;
    if (bizType === 'business') {
      const taxId = digits(b.biz_tax_id);
      if (!isValidKrBizNo(taxId)) return errorResponse(res, 'invalid_biz_tax_id', 400); // 사업자등록번호 10자리 + 체크섬
      if (!s(b.biz_name, 200)) return errorResponse(res, 'biz_name_required', 400);
      const taxEmail = s(b.tax_email, 200);
      if (taxEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(taxEmail)) return errorResponse(res, 'invalid_tax_email', 400);
      profile = {
        biz_type: 'business',
        biz_name: s(b.biz_name, 200),
        biz_tax_id: taxId,
        biz_ceo: s(b.biz_ceo, 100),
        biz_category: s(b.biz_category, 100), // 업태
        biz_item: s(b.biz_item, 100),         // 종목
        biz_address: s(b.biz_address, 500),
        tax_email: taxEmail,
        requested_by_name: s(b.requested_by_name, 80), // 담당자명
        contact_phone: s(b.contact_phone, 40),          // 담당자 연락처
      };
      receiptType = 'tax_invoice';
      statusPatch = { tax_invoice_status: 'pending' };
    } else {
      const ident = digits(b.cr_identifier);
      if (ident.length < 8) return errorResponse(res, 'invalid_cr_identifier', 400); // 휴대폰/사업자번호
      profile = {
        biz_type: 'individual',
        cr_purpose: b.cr_purpose === 'expense_proof' ? 'expense_proof' : 'income_deduction',
        cr_identifier: ident,
        requested_by_name: s(b.requested_by_name, 80),
      };
      receiptType = 'cash_receipt';
      statusPatch = { cash_receipt_status: 'pending' };
    }

    await invoice.update({
      receipt_type: receiptType,
      receipt_profile: profile,
      receipt_requested_at: new Date(),
      ...statusPatch,
    });

    // 등록 고객이면 Client 레코드도 갱신 (다음 청구서 prefill) — 외부 고객은 invoice.receipt_profile 만.
    //   구독(정기청구) 반복 시 매번 재입력하지 않도록 사업자·개인 둘 다 저장. (외부 고객은 Client 없음)
    if (invoice.client_id) {
      try {
        const { Client } = require('../models');
        const patch = bizType === 'business'
          ? {
              is_business: true,
              biz_name: profile.biz_name,
              biz_tax_id: profile.biz_tax_id,
              biz_ceo: profile.biz_ceo,
              biz_type: profile.biz_category,
              biz_item: profile.biz_item,
              biz_address: profile.biz_address,
              tax_invoice_email: profile.tax_email,
              ...(profile.requested_by_name ? { billing_contact_name: profile.requested_by_name } : {}),
              ...(profile.contact_phone ? { billing_contact_phone: profile.contact_phone } : {}),
            }
          : {
              // 개인(현금영수증) — 연락처만 저장. 식별번호(휴대폰)는 billing_contact_phone 로 다음 prefill.
              is_business: false,
              ...(profile.requested_by_name ? { billing_contact_name: profile.requested_by_name } : {}),
              ...(profile.contact_phone ? { billing_contact_phone: profile.contact_phone }
                  : (profile.cr_identifier ? { billing_contact_phone: profile.cr_identifier } : {})),
            };
        await Client.update(patch, { where: { id: invoice.client_id } });
      } catch (e) { console.warn('[receipt-request] client update', e.message); }
    }

    // owner/멤버 알림 — 증빙 신청 도착
    try {
      const { Op } = require('sequelize');
      const { BusinessMember, Business } = require('../models');
      const { notifyMany } = require('./notifications');
      const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name'] });
      const members = await BusinessMember.findAll({
        where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
        attributes: ['user_id'],
      });
      const kindLabel = receiptType === 'tax_invoice' ? '세금계산서' : '현금영수증';
      notifyMany({
        userIds: members.map((m) => m.user_id),
        businessId: invoice.business_id, eventKind: 'tax_invoice',
        title: `${kindLabel} 발행 요청 도착`,
        body: `${invoice.invoice_number} — 고객이 ${kindLabel} 정보를 확인·제출했습니다`,
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
        ctaLabel: '청구서 보기',
        workspaceName: biz?.brand_name || biz?.name || null,
      }).catch((e) => console.warn('[notify receipt]', e.message));
    } catch (e) { console.warn('[receipt notify outer]', e.message); }

    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'receipt_requested', invoice_id: invoice.id });

    return successResponse(res, { receipt_type: receiptType, requested: true }, 'Receipt requested');
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
      source_post_id, project_id, currency, receipt_type,
    } = req.body;
    if (!title) { await t.rollback(); return errorResponse(res, 'Title required', 400); }
    // 증빙 발행 의향 (선택) — 발행 모달 '세금계산서 발행' 토글. 결제 후 증빙 큐(receiptsDue) 편입.
    const receiptType = ['tax_invoice', 'cash_receipt'].includes(receipt_type) ? receipt_type : 'none';

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
      receipt_type: receiptType,
      // 발행 의향이 있으면 결제 후 큐에 'pending' 으로 잡히도록 상태 선설정 (고객 제출 시 갱신)
      ...(receiptType === 'tax_invoice' ? { tax_invoice_status: 'pending' } : {}),
      ...(receiptType === 'cash_receipt' ? { cash_receipt_status: 'pending' } : {}),
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
          detail: (item.detail && String(item.detail).trim()) || null,
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
    // Q Bill 타임라인 — 청구서 생성(draft)
    await logBillEvent('invoice', result.id, 'created', { actorUserId: req.user?.id, detail: { invoice_number: result.invoice_number, grand_total: result.grand_total, currency: result.currency } });
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
    // 프로젝트 고객채팅 fallback — client_id 가 안 맞아도(고객 레코드 분리 등) 그 프로젝트의 고객 채널을 찾는다.
    // 프로젝트에서 발행 시 "채팅방 없음" 오표시 차단.
    if (!conv && projectId) {
      conv = await Conversation.findOne({
        where: { business_id: req.params.businessId, project_id: projectId, channel_type: 'customer' },
        attributes: ['id', 'title', 'project_id', 'last_message_at'],
        order: [['last_message_at', 'DESC']],
      });
    }
    successResponse(res, { conversation: conv, suggest_create: !conv });
  } catch (error) { next(error); }
});

// ─── 증빙(세금계산서·현금영수증) 발행 의무 큐 — 단일 진실 원천 ───
//   대시보드 인박스(dashboard.js collectTaxInvoices)와 동일 헬퍼(services/receiptsDue)를 거쳐 숫자 일치.
//   /:businessId/:id 보다 먼저 정의 (literal 우선, memory feedback_express_route_order).
router.get('/:businessId/receipts-due', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const baseWhere = await invoiceListWhere(req.user.id, Number(req.params.businessId), req.scope);
    if (!baseWhere) return errorResponse(res, 'forbidden', 403);
    const { fetchReceiptRows } = require('../services/receiptsDue');
    const rows = await fetchReceiptRows({ Invoice, Client, InvoiceInstallment }, baseWhere);
    successResponse(res, rows);
  } catch (error) { next(error); }
});

// #75 — 세금계산서 발행 내역 (공급자·공급받는자·품목·금액 분해). 발행자가 홈택스/팝빌에 그대로 옮겨적게.
router.get('/:businessId/:id/tax-breakdown', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const inv = await Invoice.findOne({
      where: { id: req.params.id, business_id: businessId },
      include: [
        { model: InvoiceItem, as: 'items' },
        { model: Client, attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_ceo', 'biz_tax_id', 'biz_type', 'biz_item', 'biz_address', 'tax_invoice_email', 'billing_contact_email'] },
      ],
    });
    if (!inv) return errorResponse(res, 'not_found', 404);
    if (!isMemberOrAbove(req.scope)) return errorResponse(res, 'forbidden', 403);

    const biz = await Business.findByPk(businessId, {
      attributes: ['legal_name', 'brand_name', 'name', 'tax_id', 'representative', 'address', 'phone', 'biz_type', 'biz_item'],
    });
    // 공급자(을) — 워크스페이스 법인정보
    const supplier = {
      name: biz?.legal_name || biz?.brand_name || biz?.name || null,
      tax_id: biz?.tax_id || null,
      ceo: biz?.representative || null,
      address: biz?.address || null,
      phone: biz?.phone || null,
      biz_type: biz?.biz_type || null,
      biz_item: biz?.biz_item || null,
    };
    // 공급받는자(갑) — receipt_profile 우선, 없으면 Client
    const p = inv.receipt_profile || null;
    const c = inv.Client || null;
    const recipient = {
      name: (p && p.biz_name) || c?.biz_name || c?.company_name || c?.display_name || inv.recipient_business_name || null,
      tax_id: (p && p.biz_tax_id) || c?.biz_tax_id || inv.recipient_business_number || null,
      ceo: (p && p.biz_ceo) || c?.biz_ceo || null,
      address: (p && p.biz_address) || c?.biz_address || null,
      biz_type: (p && p.biz_category) || c?.biz_type || null,
      biz_item: (p && p.biz_item) || c?.biz_item || null,
      tax_email: (p && p.tax_email) || c?.tax_invoice_email || c?.billing_contact_email || inv.recipient_email || null,
    };
    const items = (inv.items || []).map((it) => ({
      description: it.description, detail: it.detail || null,
      quantity: Number(it.quantity || 0), unit_price: Number(it.unit_price || 0), amount: Number(it.amount || 0),
    }));
    const grand = Number(inv.grand_total || 0);
    const vatRate = Number(inv.vat_rate || 0.1);
    // subtotal(공급가액) 우선 컬럼, 없으면 합계에서 역산
    const supply = inv.subtotal != null ? Number(inv.subtotal) : Math.round(grand / (1 + vatRate));
    const vat = inv.tax_amount != null ? Number(inv.tax_amount) : (grand - supply);
    return successResponse(res, {
      invoice_number: inv.invoice_number,
      currency: inv.currency,
      supply_date: inv.issued_at || inv.created_at,
      supplier, recipient, items,
      amounts: { supply, vat, vat_rate: vatRate, total: grand },
    });
  } catch (err) { next(err); }
});

// ─── 상태 변경 이력 (기본 히스토리 — draft/sent/paid/void 전이 타임라인) ───
router.get('/:businessId/:id/status-history', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const inv = await Invoice.findOne({ where: { id: req.params.id, business_id: businessId }, attributes: ['id'] });
    if (!inv) return errorResponse(res, 'not_found', 404);
    if (!isMemberOrAbove(req.scope)) return errorResponse(res, 'forbidden', 403);
    const { InvoiceStatusHistory } = require('../models');
    const { applyMemberDisplayName } = require('../services/displayName');
    const rows = await InvoiceStatusHistory.findAll({
      where: { invoice_id: inv.id, business_id: businessId },
      include: [{ model: User, as: 'changer', attributes: ['id', 'name', 'name_localized'] }],
      order: [['created_at', 'ASC']],
    });
    const data = rows.map((r) => ({
      id: r.id,
      from_status: r.from_status,
      to_status: r.to_status,
      note: r.note || null,
      created_at: r.createdAt, // underscored 모델 — 인스턴스 접근자는 createdAt (created_at 컬럼 매핑)
      changer: r.changer ? { id: r.changer.id, name: r.changer.name, name_localized: r.changer.name_localized } : null,
    }));
    await applyMemberDisplayName(data, businessId, ['changer']);
    return successResponse(res, data.map((d) => ({
      id: d.id, from_status: d.from_status, to_status: d.to_status, note: d.note,
      created_at: d.created_at, changed_by_name: d.changer ? (d.changer.name || null) : null,
    })));
  } catch (err) { next(err); }
});

// ─── Q Bill 이벤트 타임라인 (생애주기: 생성→발행→고객열람→(부분)결제→증빙→정정/취소) ───
//   재무 가시성 자원 → 멤버 이상만(client 차단). status-history 와 별개(고객 행위·결제까지 포함).
router.get('/:businessId/:id/timeline', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const inv = await Invoice.findOne({ where: { id: req.params.id, business_id: businessId }, attributes: ['id'] });
    if (!inv) return errorResponse(res, 'not_found', 404);
    if (!isMemberOrAbove(req.scope)) return errorResponse(res, 'forbidden', 403);
    const events = await listBillEvents('invoice', inv.id, businessId);
    return successResponse(res, events);
  } catch (err) { next(err); }
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
    const payload = invoice.toJSON();
    payload.recurring = await resolveRecurringInfo(invoice);   // #92 — 정기 발송 기준
    successResponse(res, payload);
  } catch (error) {
    next(error);
  }
});

// ─── Invoice 편집 (PUT) — draft 상태만 (임시저장 재편집) ───
// 발송 전 draft 만 수정 가능. 발신/항목/분할/세금계산서 의향 전체 교체 + 합계 재계산.
// member 도 허용 (draft 생성/편집은 권한 동일 — line 64 정책). 발송·결제 마킹만 owner only.
router.put('/:businessId/:id', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const invoice = await Invoice.findOne({
      where: { id: req.params.id, business_id: req.params.businessId },
      transaction: t,
    });
    if (!invoice) { await t.rollback(); return errorResponse(res, 'Invoice not found', 404); }
    // draft 외에 canceled 도 재편집 허용 — 취소한 청구서를 고쳐 재발행. 편집 시 draft 로 되살림.
    if (!['draft', 'canceled'].includes(invoice.status)) {
      await t.rollback(); return errorResponse(res, 'only draft or canceled can be edited', 400);
    }
    const wasCanceled = invoice.status === 'canceled';

    const {
      title, client_id, due_date, recipient_email, recipient_business_name, recipient_business_number,
      notes, items, vat_rate, installment_mode, installments, source_post_id, currency, receipt_type,
    } = req.body;
    if (!title) { await t.rollback(); return errorResponse(res, 'Title required', 400); }
    const receiptType = ['tax_invoice', 'cash_receipt'].includes(receipt_type) ? receipt_type : 'none';

    // 출처 post 검증 (생성과 동일)
    let sourcePostId = null;
    if (source_post_id) {
      const sp = await Post.findOne({
        where: { id: Number(source_post_id), business_id: req.params.businessId },
        transaction: t,
      });
      if (!sp) { await t.rollback(); return errorResponse(res, 'invalid source_post_id', 400); }
      if (sp.status !== 'published') { await t.rollback(); return errorResponse(res, 'source post must be published', 400); }
      sourcePostId = sp.id;
    }

    // 분할 검증 (생성과 동일)
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

    const vatRateNum = vat_rate !== undefined ? Number(vat_rate) : Number(invoice.vat_rate);

    await invoice.update({
      client_id: client_id || null,
      title,
      due_date: due_date || null,
      recipient_email: recipient_email || null,
      recipient_business_name: recipient_business_name || null,
      recipient_business_number: recipient_business_number || null,
      notes: notes || null,
      installment_mode: mode,
      vat_rate: vatRateNum,
      source_post_id: sourcePostId,
      currency: currency || invoice.currency,
      receipt_type: receiptType,
      tax_invoice_status: receiptType === 'tax_invoice' ? 'pending' : 'none',
      cash_receipt_status: receiptType === 'cash_receipt' ? 'pending' : 'none',
      // 취소 청구서 재편집 → draft 로 되살림 (재발행 가능). 발송/조회 시점 초기화.
      ...(wasCanceled ? { status: 'draft', sent_at: null, viewed_at: null } : {}),
    }, { transaction: t });

    // 항목 전체 교체 + 합계 재계산
    await InvoiceItem.destroy({ where: { invoice_id: invoice.id }, transaction: t });
    let subtotal = 0;
    if (items && items.length > 0) {
      const itemRows = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const amount = Number(item.quantity || 1) * Number(item.unit_price || 0);
        subtotal += amount;
        itemRows.push({
          invoice_id: invoice.id,
          description: item.description,
          detail: (item.detail && String(item.detail).trim()) || null,
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          amount,
          sort_order: i,
        });
      }
      await InvoiceItem.bulkCreate(itemRows, { transaction: t });
    }
    const taxAmount = Math.round(subtotal * vatRateNum);
    const grandTotal = subtotal + taxAmount;
    await invoice.update({
      total_amount: subtotal, subtotal, tax_amount: taxAmount, grand_total: grandTotal,
    }, { transaction: t });

    // 분할 일정 전체 교체 (생성과 동일 분배 로직)
    await InvoiceInstallment.destroy({ where: { invoice_id: invoice.id }, transaction: t });
    if (mode === 'split') {
      const insts = installments.map((inst, idx) => ({
        invoice_id: invoice.id,
        installment_no: idx + 1,
        label: String(inst.label).slice(0, 40),
        percent: Number(inst.percent),
        amount: 0,
        due_date: inst.due_date || null,
        milestone_ref: inst.milestone_ref ? String(inst.milestone_ref).slice(0, 100) : null,
        status: 'pending',
      }));
      let allocated = 0;
      for (let i = 0; i < insts.length; i++) {
        if (i < insts.length - 1) {
          const a = Math.round(grandTotal * (insts[i].percent / 100));
          insts[i].amount = a; allocated += a;
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
    if (result?.project_id) require('../services/projectStageEngine').onInvoiceChanged(result.id).catch(() => null);
    broadcastInvoice(req, result, 'invoice:updated');
    require('../services/auditService').logAudit(req, {
      action: 'invoice.update',
      targetType: 'invoice',
      targetId: result.id,
      newValue: { title: result.title, grand_total: result.grand_total, installment_mode: result.installment_mode },
    });
    successResponse(res, result, 'Invoice updated');
  } catch (error) {
    await t.rollback();
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
    if (send_chat && (invoice.project_id || invoice.client_id)) {
      try {
        let conv = null;
        // 프로젝트 청구 → 그 프로젝트의 '고객' 대화방(channel_type='customer').
        //   프로젝트 대화방은 client_id=null 로 project_id 로 묶이므로 client_id 로 찾으면 못 찾던 버그 fix.
        if (invoice.project_id) {
          conv = await Conversation.findOne({ where: { business_id: req.params.businessId, project_id: invoice.project_id, channel_type: 'customer' }, order: [['last_message_at', 'DESC']] });
          // 고객방이 없으면 그 프로젝트의 아무 대화방 (fallback)
          if (!conv) conv = await Conversation.findOne({ where: { business_id: req.params.businessId, project_id: invoice.project_id }, order: [['last_message_at', 'DESC']] });
        }
        // standalone 고객 청구(프로젝트 없음) → client_id 로
        if (!conv && invoice.client_id) {
          conv = await Conversation.findOne({ where: { business_id: req.params.businessId, client_id: invoice.client_id }, order: [['last_message_at', 'DESC']] });
        }

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
          // Socket.IO broadcast — conv + business room (CLAUDE.md §16). 누락 시 카드가 실시간으로 안 뜸.
          try {
            const full = await Message.findByPk(msg.id, { include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'email', 'name_localized'] }] });
            const fullJson = full.toJSON();
            try { const { applyMemberDisplayNameOne } = require('../services/displayName'); await applyMemberDisplayNameOne(fullJson, conv.business_id, ['sender']); } catch { /* display name best-effort */ }
            const io = req.app.get('io');
            if (io) {
              io.to(`conv:${conv.id}`).emit('message:new', fullJson);
              io.to(`business:${conv.business_id}`).emit('message:new', fullJson);
            }
          } catch (bErr) { console.warn('[invoice send chat broadcast]', bErr.message); }
          // 알림 fan-out — 대화 참여자(발신자 제외)에게 새 메시지 알림 (CLAUDE.md §13)
          try {
            const { ConversationParticipant } = require('../models');
            const parts = await ConversationParticipant.findAll({ where: { conversation_id: conv.id }, attributes: ['user_id'] });
            const targetIds = parts.map(p => p.user_id).filter(uid => uid && uid !== req.user.id);
            if (targetIds.length) {
              const { notifyMany } = require('./notifications');
              await notifyMany({
                userIds: targetIds,
                businessId: conv.business_id,
                eventKind: 'message',
                title: `[청구서] ${invoice.invoice_number}`,
                body: `${invoice.title || ''} 청구서가 도착했습니다.`,
                link: `/talk/${conv.id}`,
              });
            }
          } catch (nErr) { console.warn('[invoice send chat notify]', nErr.message); }
          deliver.chat = { conversation_id: conv.id, message_id: msg.id, title: conv.title || null };
        } else {
          deliver.chat = { error: 'no_conversation' };
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
    // Q Bill 타임라인 — 발행(draft → sent) + 발송 채널
    await logBillEvent('invoice', invoice.id, 'sent', { actorUserId: req.user?.id, detail: {
      chat: !!(deliver.chat && !deliver.chat.error), email: !!(deliver.email && !deliver.email.error),
      // 어느 이메일·어느 채팅방에 보냈는지 이력에 무조건 남김 (사용자 요구)
      email_to: (deliver.email && !deliver.email.error && deliver.email.to) || null,
      chat_conversation_id: (deliver.chat && !deliver.chat.error && deliver.chat.conversation_id) || null,
      chat_title: (deliver.chat && !deliver.chat.error && deliver.chat.title) || null,
    } });
    successResponse(res, { invoice: refreshed, deliver }, 'Invoice sent');
  } catch (error) { try { await t.rollback(); } catch {} next(error); }
});

// (이동됨: source-candidates / find-conversation 은 라우트 매칭 순서를 위해 위(GET /:businessId 다음)로 이동)

// ─── 나에게 미리보기 발송 — 고객에게 보내기 전, 발행자 본인 이메일로 청구서 PDF 미리보기 ───
//   status/공유토큰/sent_at 무변경(draft 유지). 구독·정기 청구서 검토 흐름용 (사용자 요청).
router.post('/:businessId/:id/send-preview', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!invoice) return errorResponse(res, 'not_found', 404);
    const me = await User.findByPk(req.user.id, { attributes: ['email', 'name'] });
    if (!me?.email) return errorResponse(res, 'no_email — 본인 이메일이 없어 미리보기를 보낼 수 없습니다', 400);
    const business = await Business.findByPk(req.params.businessId, { attributes: ['name', 'brand_name', 'mail_from_name', 'mail_reply_to'] });
    // PDF 첨부 (draft 도 렌더 가능) — best-effort
    let attachments = null;
    try {
      const { pdf } = await buildInvoicePdf(invoice.id);
      attachments = [{ filename: `${invoice.invoice_number || 'invoice'}-preview.pdf`, content: pdf, contentType: 'application/pdf' }];
    } catch (pdfErr) { console.warn('[invoice send-preview] PDF attach failed:', pdfErr.message); }
    const { sendInvoiceEmail } = require('../services/emailService');
    const ok = await sendInvoiceEmail({
      to: me.email,
      invoiceNumber: invoice.invoice_number,
      title: `[미리보기] ${invoice.title || ''}`,
      total: Number(invoice.grand_total || 0),
      currency: invoice.currency,
      dueDate: invoice.due_date,
      senderName: me.name || '',
      workspaceName: business?.brand_name || business?.name || '',
      message: '고객에게 발송하기 전 미리보기입니다. 첨부 PDF 로 내용을 확인한 뒤, 이상 없으면 "발송"으로 고객에게 보내세요.',
      shareUrl: null,
      attachments,
      fromName: business?.mail_from_name || business?.brand_name || business?.name || null,
      replyTo: business?.mail_reply_to || null,
    });
    require('../services/auditService').logAudit(req, {
      action: 'invoice.send_preview', targetType: 'invoice', targetId: invoice.id,
      newValue: { to: me.email, invoice_number: invoice.invoice_number },
    });
    return successResponse(res, { sent: ok, to: me.email }, ok ? '미리보기를 보냈습니다' : 'sent');
  } catch (err) { next(err); }
});

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
    const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/invoices/${shareToken}`;
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

// ─── 재발송 — 이미 보낸 청구서를 "원본 그대로"(PDF 첨부, 독촉 톤 없음) 고객에게 다시 발송 ───
//   독촉(send-reminder)과 별개. 상태 무변경(draft→sent 전환 안 함). draft/canceled 제외.
//   용도: 고객이 메일을 못 받았거나 분실한 경우 깔끔하게 원본만 다시.
router.post('/:businessId/:id/resend', authenticateToken, reminderLimiter, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: businessId } });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    if (invoice.status === 'draft' || invoice.status === 'canceled') return errorResponse(res, 'not_resendable', 400);
    // 수신자: recipient_email → client tax/billing/invite (발송 라우트와 동일 우선순위)
    let recipient = invoice.recipient_email;
    if (!recipient && invoice.client_id) {
      const cl = await Client.findByPk(invoice.client_id, { attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'] });
      recipient = cl?.tax_invoice_email || cl?.billing_contact_email || cl?.invite_email || null;
    }
    if (!recipient) return errorResponse(res, 'no_recipient', 400);
    // share_token 보장
    let shareToken = invoice.share_token;
    if (!shareToken) { shareToken = require('crypto').randomBytes(32).toString('hex'); await invoice.update({ share_token: shareToken }); }
    const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/invoices/${shareToken}`;
    const business = await Business.findByPk(businessId, { attributes: ['name', 'brand_name', 'mail_from_name', 'mail_reply_to'] });
    const sender = await User.findByPk(req.user.id, { attributes: ['name'] });
    // PDF 첨부 (best-effort — 실패해도 메일은 진행)
    let attachments = null;
    try {
      const { pdf } = await buildInvoicePdf(invoice.id);
      attachments = [{ filename: `${invoice.invoice_number || 'invoice'}.pdf`, content: pdf, contentType: 'application/pdf' }];
    } catch (pdfErr) { console.warn('[invoice resend] PDF attach failed:', pdfErr.message); }
    const { sendInvoiceEmail } = require('../services/emailService');
    const ok = await sendInvoiceEmail({
      to: recipient,
      invoiceNumber: invoice.invoice_number,
      title: invoice.title,
      total: Number(invoice.grand_total || 0),
      currency: invoice.currency,
      dueDate: invoice.due_date,
      senderName: sender?.name || '',
      workspaceName: business?.brand_name || business?.name || '',
      message: req.body?.message ? String(req.body.message).slice(0, 1000) : null,
      shareUrl,
      attachments,
      fromName: business?.mail_from_name || business?.brand_name || business?.name || null,
      replyTo: business?.mail_reply_to || null,
    });
    if (!ok) return errorResponse(res, 'email_send_failed', 502);
    // 추적 (상태 무변경)
    const meta = (invoice.meta && typeof invoice.meta === 'object') ? { ...invoice.meta } : {};
    meta.last_resent_at = new Date().toISOString();
    meta.resend_count = (Number(meta.resend_count) || 0) + 1;
    await invoice.update({ meta });
    try { await logBillEvent('invoice', invoice.id, 'sent', { detail: { resend: true, email_to: recipient } }); } catch { /* best-effort */ }
    require('../services/auditService').logAudit(req, {
      action: 'invoice.resend', targetType: 'invoice', targetId: invoice.id,
      newValue: { invoice_number: invoice.invoice_number, recipient, resend_count: meta.resend_count },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${businessId}`).emit('invoice:updated', invoice.toJSON());
    return successResponse(res, { sent: true, to: recipient, resend_count: meta.resend_count }, 'resent');
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
    // Q Bill 타임라인 — 회차 결제 확정. 전액 완납이면 paid_full, 아니면 paid_partial.
    await logBillEvent('invoice', invoice.id, newStatus === 'paid' ? 'paid_full' : 'paid_partial', {
      actorUserId: req.user?.id,
      detail: { installment_no: inst.installment_no, label: inst.label, amount: inst.amount, paid_sum: paidSum, total: totalSum },
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
    const taxFileId = await resolveReceiptFileId(req.body?.file_id, invoice.business_id);
    await inst.update({ tax_invoice_no: no, tax_invoice_at: at, tax_invoice_marked_by: req.user.id, ...(taxFileId !== undefined ? { tax_invoice_file_id: taxFileId } : {}) });
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
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
        ctaLabel: '청구서 보기',
        workspaceName: biz?.brand_name || biz?.name || null,
        excludeUserId: req.user.id,
      }).catch((e) => console.warn('[notify tax_invoice]', e.message));
    } catch (e) { console.warn('[tax_invoice notify outer]', e.message); }

    await notifyCustomerReceiptIssued(req, invoice, 'tax', no, at);
    // Q Bill 타임라인 — 세금계산서 발행(회차)
    await logBillEvent('invoice', invoice.id, 'tax_issued', { actorUserId: req.user?.id, detail: { kind: 'tax', installment_no: inst.installment_no, label: inst.label, no } });
    successResponse(res, inst, 'Tax invoice marked');
  } catch (error) { next(error); }
});

// 회차별 현금영수증 발행 마킹 — 분할 결제는 회차마다 입금 시점 발급(현금영수증 거래 건별 원칙).
router.post('/:businessId/:id/installments/:installId/mark-cash-receipt', authenticateToken, checkBusinessAccess, requireMenu('qbill','write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const inst = await InvoiceInstallment.findOne({ where: { id: req.params.installId, invoice_id: invoice.id } });
    if (!inst) return errorResponse(res, 'Installment not found', 404);
    const no = req.body?.cash_receipt_no ? String(req.body.cash_receipt_no).slice(0, 50) : null;
    const at = req.body?.cash_receipt_at ? new Date(req.body.cash_receipt_at) : new Date();
    if (!no) return errorResponse(res, 'cash_receipt_no required', 400);
    const cashFileId = await resolveReceiptFileId(req.body?.file_id, invoice.business_id);
    await inst.update({ cash_receipt_no: no, cash_receipt_at: at, cash_receipt_marked_by: req.user.id, ...(cashFileId !== undefined ? { cash_receipt_file_id: cashFileId } : {}) });
    require('../services/auditService').logAudit(req, {
      action: 'invoice.installment.mark_cash_receipt',
      targetType: 'invoice_installment',
      targetId: inst.id,
      newValue: { invoice_id: invoice.id, invoice_number: invoice.invoice_number, installment_no: inst.installment_no, cash_receipt_no: no, cash_receipt_at: at },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'cash_receipt_issued', invoice_id: invoice.id });

    // 멤버 알림 — 현금영수증 발행 마킹
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
        title: '현금영수증 발행 완료',
        body: `${invoice.invoice_number} ${inst.label || ''} 회차 승인번호 ${no}`,
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
        ctaLabel: '청구서 보기',
        workspaceName: biz?.brand_name || biz?.name || null,
        excludeUserId: req.user.id,
      }).catch((e) => console.warn('[notify cash_receipt]', e.message));
    } catch (e) { console.warn('[cash_receipt notify outer]', e.message); }

    await notifyCustomerReceiptIssued(req, invoice, 'cash', no, at);
    // Q Bill 타임라인 — 현금영수증 발행(회차)
    await logBillEvent('invoice', invoice.id, 'tax_issued', { actorUserId: req.user?.id, detail: { kind: 'cash', installment_no: inst.installment_no, label: inst.label, no } });
    successResponse(res, inst, 'Cash receipt marked');
  } catch (error) { next(error); }
});

// ─── 단건 청구서 증빙 발행 마킹 (분할 아님) — 세금계산서 / 현금영수증 ───
// 외부 발행(홈택스/팝빌) 후 발행번호 수동 마킹. 재무 mutation → owner_only (assertInvoiceMutationOwner).
async function notifyReceiptIssued(req, invoice, kindLabel, no) {
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
      title: `${kindLabel} 발행 완료`,
      body: `${invoice.invoice_number} 발행번호 ${no}`,
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
      ctaLabel: '청구서 보기',
      workspaceName: biz?.brand_name || biz?.name || null,
      excludeUserId: req.user.id,
    }).catch((e) => console.warn('[notify receipt issued]', e.message));
  } catch (e) { console.warn('[receipt issued notify outer]', e.message); }
}

// 증빙 발행 완료 → 고객에게 메일 통지 (신뢰 루프 완성). kind: 'tax'|'cash'.
//   수신자 우선순위: receipt_profile.tax_email > Client 세금/청구/초대 이메일 > invoice.recipient_email.
//   형식 검증 통과 + 명시적 수신자만 발송 (미인증 자동메일 금지 — memory feedback_no_automail_unverified).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function notifyCustomerReceiptIssued(req, invoice, kind, no, issuedAt) {
  try {
    const { Client, Business } = require('../models');
    const client = invoice.client_id ? await Client.findByPk(invoice.client_id, {
      attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'],
    }) : null;
    const profile = invoice.receipt_profile || null;
    const to = (profile && profile.tax_email)
      || (client && (client.tax_invoice_email || client.billing_contact_email || client.invite_email))
      || invoice.recipient_email || null;
    if (!to || !EMAIL_RE.test(String(to))) return; // 명시적 수신자 + 형식 검증
    const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name', 'mail_from_name', 'mail_reply_to'] });
    const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
    const shareUrl = invoice.share_token ? `${APP_URL}/public/invoices/${invoice.share_token}` : null;
    const { sendReceiptIssuedEmail } = require('../services/emailService');
    await sendReceiptIssuedEmail({
      to, kind,
      invoiceNumber: invoice.invoice_number,
      title: invoice.title || '',
      receiptNo: no,
      issuedAt: issuedAt || new Date(),
      workspaceName: biz?.brand_name || biz?.name || null,
      shareUrl,
      fromName: biz?.mail_from_name || undefined,
      replyTo: biz?.mail_reply_to || undefined,
      businessId: invoice.business_id,
      invoiceId: invoice.id,
    });
  } catch (e) { console.warn('[receipt issued customer mail]', e.message); }
}

// 청구서 취소 시, 이미 발행된 증빙이 있으면 owner/admin 에게 "수정세금계산서/현금영수증 취소 필요" 알림 + audit.
//   자동 발행/취소는 하지 않음 — 외부(홈택스/팝빌) 수동 처리. 컴플라이언스 안전망(놓침 방지).
async function notifyReceiptCorrectionNeeded(req, invoice) {
  try {
    const hadTax = invoice.tax_invoice_status === 'issued' || !!invoice.tax_invoice_external_id;
    const hadCash = invoice.cash_receipt_status === 'issued' || !!invoice.cash_receipt_no;
    const insts = await InvoiceInstallment.findAll({ where: { invoice_id: invoice.id }, attributes: ['tax_invoice_no'] });
    const hadInstTax = insts.some((i) => !!i.tax_invoice_no);
    if (!hadTax && !hadCash && !hadInstTax) return; // 발행된 증빙 없으면 안내 불필요

    const kindLabel = (hadCash && !hadTax && !hadInstTax) ? '현금영수증' : '세금계산서';
    require('../services/auditService').logAudit(req, {
      action: 'invoice.receipt_correction_needed', targetType: 'invoice', targetId: invoice.id,
      newValue: { invoice_number: invoice.invoice_number, had_tax: hadTax || hadInstTax, had_cash: hadCash },
    });
    const { Op } = require('sequelize');
    const { BusinessMember, Business } = require('../models');
    const { notifyMany } = require('./notifications');
    const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name'] });
    const members = await BusinessMember.findAll({
      where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin'] } },
      attributes: ['user_id'],
    });
    await notifyMany({
      userIds: members.map((m) => m.user_id),
      businessId: invoice.business_id, eventKind: 'tax_invoice',
      title: `${kindLabel} 취소·수정 필요`,
      body: `${invoice.invoice_number} 청구서가 취소되었습니다. 이미 발행된 ${kindLabel}는 홈택스/팝빌에서 ${hadCash && !hadTax && !hadInstTax ? '취소' : '수정(수정세금계산서)'} 처리가 필요합니다.`,
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
      ctaLabel: '청구서 보기',
      workspaceName: biz?.brand_name || biz?.name || null,
    }).catch((e) => console.warn('[receipt correction notify]', e.message));
  } catch (e) { console.warn('[receipt correction outer]', e.message); }
}

router.post('/:businessId/:id/mark-tax-invoice', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const no = req.body?.tax_invoice_no ? String(req.body.tax_invoice_no).slice(0, 50) : null;
    const at = req.body?.tax_invoice_at ? new Date(req.body.tax_invoice_at) : new Date();
    if (!no) return errorResponse(res, 'tax_invoice_no required', 400);
    const taxFileId = await resolveReceiptFileId(req.body?.file_id, invoice.business_id);
    await invoice.update({ tax_invoice_status: 'issued', tax_invoice_external_id: no, tax_invoice_issued_at: at, ...(taxFileId !== undefined ? { tax_invoice_file_id: taxFileId } : {}) });
    require('../services/auditService').logAudit(req, {
      action: 'invoice.mark_tax_invoice', targetType: 'invoice', targetId: invoice.id,
      newValue: { invoice_number: invoice.invoice_number, tax_invoice_no: no, tax_invoice_at: at },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'tax_invoice_issued', invoice_id: invoice.id });
    if (invoice?.project_id) require('../services/projectStageEngine').onInvoiceChanged(invoice.id).catch(() => null);
    await notifyReceiptIssued(req, invoice, '세금계산서', no);
    await notifyCustomerReceiptIssued(req, invoice, 'tax', no, at);
    // Q Bill 타임라인 — 세금계산서 발행(단건)
    await logBillEvent('invoice', invoice.id, 'tax_issued', { actorUserId: req.user?.id, detail: { kind: 'tax', no } });
    successResponse(res, invoice, 'Tax invoice marked');
  } catch (error) { next(error); }
});

router.post('/:businessId/:id/mark-cash-receipt', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  if (!assertInvoiceMutationOwner(req, res)) return;
  try {
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    const no = req.body?.cash_receipt_no ? String(req.body.cash_receipt_no).slice(0, 50) : null;
    const at = req.body?.cash_receipt_at ? new Date(req.body.cash_receipt_at) : new Date();
    if (!no) return errorResponse(res, 'cash_receipt_no required', 400);
    const cashFileId = await resolveReceiptFileId(req.body?.file_id, invoice.business_id);
    await invoice.update({ cash_receipt_status: 'issued', cash_receipt_no: no, cash_receipt_issued_at: at, ...(cashFileId !== undefined ? { cash_receipt_file_id: cashFileId } : {}) });
    require('../services/auditService').logAudit(req, {
      action: 'invoice.mark_cash_receipt', targetType: 'invoice', targetId: invoice.id,
      newValue: { invoice_number: invoice.invoice_number, cash_receipt_no: no, cash_receipt_at: at },
    });
    const io = req.app.get('io');
    if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'cash_receipt_issued', invoice_id: invoice.id });
    await notifyReceiptIssued(req, invoice, '현금영수증', no);
    await notifyCustomerReceiptIssued(req, invoice, 'cash', no, at);
    // Q Bill 타임라인 — 현금영수증 발행(단건)
    await logBillEvent('invoice', invoice.id, 'tax_issued', { actorUserId: req.user?.id, detail: { kind: 'cash', no } });
    successResponse(res, invoice, 'Cash receipt marked');
  } catch (error) { next(error); }
});

// ─── 증빙 수정·취소 마킹 (수정세금계산서 / 현금영수증 취소) — RECEIPT_CORRECTION_DESIGN ───
//   외부(홈택스/팝빌) 수정발행/취소 후 결과 마킹. 재무 mutation → owner_only.
const CORRECTION_REASONS = ['clerical', 'amount_change', 'return', 'cancel', 'duplicate', 'other'];

// 고객에게 증빙 정정 통지 (발행 통지와 동일 수신자 우선순위 + 형식검증)
async function notifyCustomerReceiptCorrected(req, invoice, corr) {
  try {
    const client = invoice.client_id ? await Client.findByPk(invoice.client_id, {
      attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'],
    }) : null;
    const profile = invoice.receipt_profile || null;
    const to = (profile && profile.tax_email)
      || (client && (client.tax_invoice_email || client.billing_contact_email || client.invite_email))
      || invoice.recipient_email || null;
    if (!to || !EMAIL_RE.test(String(to))) return;
    const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name', 'mail_from_name', 'mail_reply_to'] });
    const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';
    const shareUrl = invoice.share_token ? `${APP_URL}/public/invoices/${invoice.share_token}` : null;
    const { sendReceiptCorrectionEmail } = require('../services/emailService');
    await sendReceiptCorrectionEmail({
      to, kind: corr.kind, reason: corr.reason,
      invoiceNumber: invoice.invoice_number, title: invoice.title || '',
      correctedNo: corr.corrected_no, writtenAt: corr.written_at,
      workspaceName: biz?.brand_name || biz?.name || null,
      shareUrl, customerNote: corr.customer_note || null,
      fromName: biz?.mail_from_name || undefined, replyTo: biz?.mail_reply_to || undefined,
      businessId: invoice.business_id, invoiceId: invoice.id,
    });
    await corr.update({ customer_notified_at: new Date() }).catch(() => {});
  } catch (e) { console.warn('[receipt correction customer mail]', e.message); }
}

// 멤버 알림 — 증빙 정정
async function notifyMembersReceiptCorrected(req, invoice, corr) {
  try {
    const { Op } = require('sequelize');
    const { BusinessMember, Business } = require('../models');
    const { notifyMany } = require('./notifications');
    const biz = await Business.findByPk(invoice.business_id, { attributes: ['name', 'brand_name'] });
    const members = await BusinessMember.findAll({
      where: { business_id: invoice.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
      attributes: ['user_id'],
    });
    const kindLabel = corr.kind === 'cash' ? '현금영수증' : '세금계산서';
    const verb = (corr.reason === 'cancel' || corr.reason === 'duplicate') ? '취소' : '수정';
    await notifyMany({
      userIds: members.map((m) => m.user_id),
      businessId: invoice.business_id, eventKind: 'tax_invoice',
      title: `${kindLabel} ${verb} 발행`,
      body: `${invoice.invoice_number} ${kindLabel} ${verb} — 번호 ${corr.corrected_no}`,
      link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
      ctaLabel: '청구서 보기',
      workspaceName: biz?.brand_name || biz?.name || null,
      excludeUserId: req.user.id,
    }).catch((e) => console.warn('[notify correction]', e.message));
  } catch (e) { console.warn('[correction notify outer]', e.message); }
}

async function recordCorrection(req, res, { installmentId }) {
  if (!assertInvoiceMutationOwner(req, res)) return;
  const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
  if (!invoice) return errorResponse(res, 'Invoice not found', 404);
  let inst = null;
  if (installmentId) {
    inst = await InvoiceInstallment.findOne({ where: { id: installmentId, invoice_id: invoice.id } });
    if (!inst) return errorResponse(res, 'Installment not found', 404);
  }
  const b = req.body || {};
  const kind = b.kind === 'cash' ? 'cash' : 'tax';
  const reason = CORRECTION_REASONS.includes(b.reason) ? b.reason : null;
  if (!reason) return errorResponse(res, 'invalid_reason', 400);
  const correctedNo = b.corrected_no ? String(b.corrected_no).slice(0, 50) : null;
  if (!correctedNo) return errorResponse(res, 'corrected_no required', 400);
  const writtenAt = b.written_at ? new Date(b.written_at) : new Date();
  const amountDelta = (b.amount_delta != null && b.amount_delta !== '') ? Number(b.amount_delta) : null;
  // 원 발행 번호 snapshot
  const originalNo = inst
    ? (kind === 'cash' ? inst.cash_receipt_no : inst.tax_invoice_no)
    : (kind === 'cash' ? invoice.cash_receipt_no : invoice.tax_invoice_external_id);

  const corr = await ReceiptCorrection.create({
    business_id: invoice.business_id,
    invoice_id: invoice.id,
    installment_id: inst ? inst.id : null,
    kind, reason,
    original_no: originalNo || null,
    corrected_no: correctedNo,
    written_at: writtenAt,
    amount_delta: amountDelta,
    currency: invoice.currency || 'KRW',
    customer_note: b.customer_note ? String(b.customer_note).slice(0, 300) : null,
    marked_by: req.user.id,
  });

  require('../services/auditService').logAudit(req, {
    action: inst ? 'invoice.installment.receipt.correction' : 'invoice.receipt.correction',
    targetType: inst ? 'invoice_installment' : 'invoice',
    targetId: inst ? inst.id : invoice.id,
    newValue: { invoice_number: invoice.invoice_number, kind, reason, corrected_no: correctedNo, amount_delta: amountDelta },
  });
  const io = req.app.get('io');
  if (io) io.to(`business:${invoice.business_id}`).emit('inbox:refresh', { reason: 'receipt_corrected', invoice_id: invoice.id });
  await notifyMembersReceiptCorrected(req, invoice, corr);
  await notifyCustomerReceiptCorrected(req, invoice, corr);
  // Q Bill 타임라인 — 증빙 정정/취소 (수정세금계산서·현금영수증 취소)
  await logBillEvent('invoice', invoice.id, 'commented', { actorUserId: req.user?.id, detail: { kind: 'correction', correction_kind: kind, reason, corrected_no: correctedNo, installment_no: inst ? inst.installment_no : null } });
  return successResponse(res, corr, 'Correction recorded');
}

router.post('/:businessId/:id/corrections', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try { await recordCorrection(req, res, { installmentId: null }); } catch (error) { next(error); }
});
router.post('/:businessId/:id/installments/:installId/corrections', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), async (req, res, next) => {
  try { await recordCorrection(req, res, { installmentId: req.params.installId }); } catch (error) { next(error); }
});
// 정정 이력 조회 (read)
router.get('/:businessId/:id/corrections', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const invoice = await Invoice.findOne({ where: { id: req.params.id, business_id: req.params.businessId } });
    if (!invoice) return errorResponse(res, 'Invoice not found', 404);
    if (!(await canAccessInvoice(req.user.id, invoice, req.scope))) return errorResponse(res, 'forbidden', 403);
    const rows = await ReceiptCorrection.findAll({ where: { invoice_id: invoice.id }, order: [['created_at', 'DESC']] });
    return successResponse(res, rows);
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
    // FK 정책: invoice_items / invoice_installments / invoice_status_history / receipt_corrections
    //   모두 ON DELETE 미명시 → 명시 삭제 필요. (status_history 누락 시 발송/취소 청구서 삭제가 FK 로 막힘 — 운영 버그 fix)
    await InvoiceInstallment.destroy({ where: { invoice_id: invoice.id } });
    await InvoiceItem.destroy({ where: { invoice_id: invoice.id } });
    await sequelize.query('DELETE FROM invoice_status_history WHERE invoice_id = ?', { replacements: [invoice.id] }).catch(() => {});
    await sequelize.query('DELETE FROM receipt_corrections WHERE invoice_id = ?', { replacements: [invoice.id] }).catch(() => {});
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
    if (status === 'canceled' && prevStatus !== 'canceled') {
      await notifyReceiptCorrectionNeeded(req, invoice);
    }

    // Q Bill 타임라인 — 단일 청구서 상태 전이 (paid_full/canceled/overdue)
    if (prevStatus !== status) {
      const evMap = { paid: 'paid_full', canceled: 'canceled', overdue: 'overdue' };
      if (evMap[status]) {
        await logBillEvent('invoice', invoice.id, evMap[status], {
          actorUserId: req.user?.id,
          detail: { from: prevStatus, amount: invoice.grand_total },
        });
      }
    }

    successResponse(res, invoice);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
