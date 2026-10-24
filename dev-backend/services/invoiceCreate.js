// 청구서 초안 만들기 — 한 곳 (2026-10-23, 서명 완료 계약서 → 청구서 초안 자동 생성 · docs/CONTRACT_AUTO_INVOICE_DESIGN.md)
//
//   손으로 만드는 길(routes/invoices.js POST /:businessId)과 서명이 끝나 저절로 만드는 길(services/contractBilling)이
//   **같은 계산**을 쓴다 — 항목 금액(통화별 반올림)·부가세·합계·분할 회차(마지막 회차가 잔여 흡수)·번호(withInvoiceNumber).
//   두 벌로 두면 금액 공식이 갈라진다. 참조 검사(고객·프로젝트가 이 워크스페이스 것인지)·권한은 부르는 쪽이 먼저 본다.
const { Invoice, InvoiceItem, InvoiceInstallment, Business } = require('../models');
const { roundMoney } = require('./money');
const { workspaceTaxDefaults, splitTax } = require('./taxCalc');
const { withInvoiceNumber } = require('./invoiceNumber');

const MAX_INSTALLMENTS = 12;

// 품목 금액 입력 검증 — unit_price·quantity 가 (있으면) 유한수·≥0 이어야 한다(B-①). 없으면 기본값(1·0)을 쓰므로 통과.
function itemsAmountsValid(items) {
  if (items == null) return true;
  if (!Array.isArray(items)) return false;
  const ok = (v) => v === undefined || v === null || v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);
  return items.every((it) => it && ok(it.unit_price) && ok(it.quantity));
}

/** 분할 회차 검증 — 문제가 없으면 null, 있으면 오류 문장(옛 라우트 응답 그대로) */
function installmentsError(mode, installments) {
  if (mode !== 'split') return null;
  if (!Array.isArray(installments) || installments.length === 0) return 'installments required for split mode';
  const sum = installments.reduce((s, x) => s + Number(x.percent || 0), 0);
  if (Math.abs(sum - 100) > 0.01) return `installment percent sum must be 100 (got ${sum})`;
  for (const inst of installments) {
    if (!inst.label || !Number.isFinite(Number(inst.percent))) return 'each installment requires label and percent';
  }
  if (installments.length > MAX_INSTALLMENTS) return 'too many installments (max 12)';
  return null;
}

/**
 * 금액 계산 — 항목(통화별 반올림)·부가세·합계·분할 회차. 초안 만들기·수정·복사와 서명 화면의 «청구 조건» 표시가 같은 함수를 쓴다
 * (서명자가 본 금액 = 청구될 금액). 항목이 없으면 합계 0.
 *   taxMode 'inclusive' — 항목 단가·금액은 적은 그대로(세금 포함가), 항목 합 = 합계, 공급가·세액은 합계에서 **한 번** 역산(services/taxCalc).
 *   'exclusive'(기본) — 항목 합 = 공급가, 세액은 위에 더함(옛 식 그대로).
 */
function computeAmounts({ items, vatRate, taxMode = 'exclusive', currency, installmentMode, installments }) {
  const cur = currency || 'KRW';
  const vatRateNum = Number(vatRate);
  const itemRows = [];
  let subtotal = 0;
  let taxAmount = 0;
  let grandTotal = 0;
  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const unitPrice = roundMoney(item.unit_price || 0, cur);
      const amount = roundMoney(Number(item.quantity || 1) * unitPrice, cur);
      subtotal = roundMoney(subtotal + amount, cur);
      itemRows.push({
        description: item.description,
        detail: (item.detail && String(item.detail).trim()) || null,
        quantity: item.quantity || 1,
        unit_price: unitPrice,
        amount,
        sort_order: i,
      });
    }
    const split = splitTax({ amount: subtotal, rate: vatRateNum, mode: taxMode, currency: cur });
    subtotal = split.subtotal;
    taxAmount = split.tax;
    grandTotal = split.total;
  }
  // 분할 일정 — amount = grand_total * percent / 100 (통화별 반올림, 마지막 row 가 잔여 흡수)
  const installmentRows = [];
  if (installmentMode === 'split' && Array.isArray(installments)) {
    let allocated = 0;
    installments.forEach((inst, idx) => {
      const row = {
        installment_no: idx + 1,
        label: String(inst.label).slice(0, 40),
        percent: Number(inst.percent),
        amount: 0,
        due_date: inst.due_date || null,
        milestone_ref: inst.milestone_ref ? String(inst.milestone_ref).slice(0, 100) : null,
        status: 'pending',
      };
      if (idx < installments.length - 1) {
        row.amount = roundMoney(grandTotal * (row.percent / 100), cur);
        allocated = roundMoney(allocated + row.amount, cur);
      } else {
        row.amount = roundMoney(grandTotal - allocated, cur);
      }
      installmentRows.push(row);
    });
  }
  return { itemRows, subtotal, taxAmount, grandTotal, installmentRows };
}

/**
 * 초안 청구서 + 항목 + 분할 회차를 트랜잭션 안에서 만든다. 검증·참조 검사는 끝난 값만 넘긴다.
 * @param {object} f businessId·actorUserId·title·clientId·projectId·sourcePostId·dueDate·recipient{Email,BusinessName,BusinessNumber}·
 *                   notes·vatRate·taxMode·currency·receiptType·installmentMode·installments·items·idempotencyKey
 * @returns {Promise<Invoice>}
 */
async function insertDraftInvoice(f, { transaction }) {
  const t = transaction;
  const businessId = Number(f.businessId);
  // 발행 시점 워크스페이스 계좌 정보 스냅샷
  const business = await Business.findByPk(businessId, { transaction: t });
  const bank_snapshot = business
    ? { bank_name: business.bank_name || null, account_number: business.bank_account_number || null, account_holder: business.bank_account_name || business.name || null }
    : null;
  const mode = f.installmentMode === 'split' ? 'split' : 'single';
  // 세율을 안 보내면 워크스페이스 기본(세금 끔이면 0) — 옛날엔 0.1 고정이라 설정을 무시했다(Fable 고칠 점 3). null 은 0%(옛 그대로)
  const vatRateNum = f.vatRate !== undefined ? Number(f.vatRate) : workspaceTaxDefaults(business).rate;
  const taxMode = f.taxMode === 'inclusive' ? 'inclusive' : 'exclusive';   // 안 보내면 세금 별도(옛 화면이 보던 기준)
  const cur = f.currency || 'KRW';
  const receiptType = ['tax_invoice', 'cash_receipt'].includes(f.receiptType) ? f.receiptType : 'none';

  // 번호는 Invoice.create 를 withInvoiceNumber 로 감싸 뽑는다(충돌 시 SAVEPOINT 재시도).
  const invoice = await withInvoiceNumber(businessId, t, (invoice_number, sp) => Invoice.create({
    business_id: businessId,
    client_id: f.clientId || null,
    invoice_number,
    title: f.title,
    due_date: f.dueDate || null,
    recipient_email: f.recipientEmail || null,
    recipient_business_name: f.recipientBusinessName || null,
    recipient_business_number: f.recipientBusinessNumber || null,
    notes: f.notes || null,
    created_by: f.actorUserId,
    owner_user_id: f.actorUserId,  // 담당자 default = 생성자. 발행 모달에서 변경 가능 (사이클 N+9)
    installment_mode: mode,
    bank_snapshot,
    vat_rate: vatRateNum,
    tax_mode: taxMode,
    source_post_id: f.sourcePostId || null,
    project_id: f.projectId || null,
    currency: cur,
    receipt_type: receiptType,
    ...(f.idempotencyKey ? { idempotency_key: f.idempotencyKey } : {}),
    // 발행 의향이 있으면 결제 후 큐에 'pending' 으로 잡히도록 상태 선설정 (고객 제출 시 갱신)
    ...(receiptType === 'tax_invoice' ? { tax_invoice_status: 'pending' } : {}),
    ...(receiptType === 'cash_receipt' ? { cash_receipt_status: 'pending' } : {}),
  }, { transaction: sp }));

  const amt = computeAmounts({ items: f.items, vatRate: vatRateNum, taxMode, currency: cur, installmentMode: mode, installments: f.installments });
  if (amt.itemRows.length > 0) {
    await InvoiceItem.bulkCreate(amt.itemRows.map((r) => ({ ...r, invoice_id: invoice.id })), { transaction: t });
    await invoice.update({
      total_amount: amt.subtotal,
      subtotal: amt.subtotal,
      tax_amount: amt.taxAmount,
      grand_total: amt.grandTotal,
    }, { transaction: t });
  }
  if (mode === 'split') {
    await InvoiceInstallment.bulkCreate(amt.installmentRows.map((r) => ({ ...r, invoice_id: invoice.id })), { transaction: t });
  }
  return invoice;
}

module.exports = { insertDraftInvoice, computeAmounts, itemsAmountsValid, installmentsError, MAX_INSTALLMENTS };
