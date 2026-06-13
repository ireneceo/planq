// 증빙(세금계산서 · 현금영수증) 발행 의무 — 단일 진실 원천 (Single Source of Truth)
//
// 증빙 큐(QBill 탭)와 대시보드 인박스가 "발행해야 할 증빙"을 각자 다르게 계산하던 회귀를 차단한다.
// 두 곳 모두 이 헬퍼를 거쳐 같은 행/숫자를 본다 (CLAUDE.md §16 실시간 일관성).
//
// 핵심 도메인 규칙 (한국):
//  - 세금계산서: 법정 발행 기한 = 공급일이 속한 달의 다음 달 10일. (우리 모델은 입금후발행 → 공급일 ≈ 결제일)
//  - 현금영수증: 거래 시점 즉시 발급이 원칙 → 권장 기한 = 결제일 + 7일 (법정 문구 아님, 운영 가이드용).
//  - 발행 대상 판정: invoice.receipt_type 우선. 레거시(none)는 한국 사업자 고객이면 세금계산서로 fallback.
//  - 발행은 "입금완료(paid)" 후에만 가능 (입금후발행 정책). 분할은 회차별 paid 기준.

const { Op } = require('sequelize');

/** 세금계산서 법정 기한: 결제일이 속한 달의 다음 달 10일 23:59:59 */
function taxInvoiceDueDate(paidAt) {
  if (!paidAt) return null;
  const d = new Date(paidAt);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth() + 1, 10, 23, 59, 59);
}

/** 현금영수증 권장 기한: 결제일 + 7일 */
function cashReceiptDueDate(paidAt) {
  if (!paidAt) return null;
  const d = new Date(paidAt);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 86400 * 1000);
}

/** Date|string → ISO 문자열 (Sequelize DATE 가 Date 객체라 sort/JSON 일관성 위해 정규화) */
function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** 발행 전 행의 긴급도: overdue(기한지남) / soon(3일 이내) / normal */
function urgencyOf(dueAt) {
  if (!dueAt) return 'normal';
  const ms = dueAt.getTime() - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 3 * 86400 * 1000) return 'soon';
  return 'normal';
}

/**
 * 한 invoice 의 receipt 종류 판정.
 * @returns 'tax' | 'cash' | null
 */
function receiptKindOf(inv, client) {
  if (inv.receipt_type === 'tax_invoice') return 'tax';
  if (inv.receipt_type === 'cash_receipt') return 'cash';
  // 레거시: receipt_type 미지정인데 한국 사업자 고객이면 세금계산서 대상으로 본다 (과거 동작 보존, 보수적).
  if ((!inv.receipt_type || inv.receipt_type === 'none') && client && client.is_business
      && (client.country === 'KR' || !client.country)) {
    return 'tax';
  }
  return null;
}

/** 수취자명 / 식별번호 resolve (receipt_profile → Client → recipient_* 순) */
function resolveRecipient(inv, client, kind) {
  const p = inv.receipt_profile || null;
  if (kind === 'tax') {
    const recipient_name = (p && p.biz_name)
      || (client && (client.biz_name || client.company_name || client.display_name))
      || inv.recipient_business_name || inv.recipient_email || null;
    const tax_id = (p && p.biz_tax_id) || (client && client.biz_tax_id)
      || inv.recipient_business_number || null;
    return { recipient_name, tax_id };
  }
  // cash receipt — 개인/지출증빙
  const recipient_name = (p && p.requested_by_name)
    || (client && (client.display_name || client.company_name))
    || inv.recipient_email || null;
  const tax_id = (p && p.cr_identifier) || null; // 휴대폰/사업자번호 등 식별번호
  return { recipient_name, tax_id };
}

/**
 * 순수 builder — 이미 fetch 된 invoices(Client + installments include) → 증빙 행 배열.
 * 발행대기(pending) + 발행완료(issued) 모두 포함. 호출측이 tab 으로 필터.
 */
function buildReceiptRows(invoices, corrections = {}) {
  const rows = [];
  for (const inv of invoices || []) {
    if (inv.status === 'draft') continue; // 초안은 증빙 의무 없음
    const isCanceled = inv.status === 'canceled'; // 취소건은 발행된 증빙만 정정 추적용으로 노출
    const client = inv.Client || inv.client || null;
    const kind = receiptKindOf(inv, client);
    if (!kind) continue;

    const { recipient_name, tax_id } = resolveRecipient(inv, client, kind);
    const base = {
      invoice_id: inv.id,
      business_id: inv.business_id,
      project_id: inv.project_id || null,
      invoice_number: inv.invoice_number,
      currency: inv.currency || 'KRW',
      kind, // 'tax' | 'cash'
      recipient_name,
      tax_id,
      receipt_requested_at: iso(inv.receipt_requested_at),
      _canceled: isCanceled,
    };

    const installments = inv.installments || [];

    if (installments.length > 0) {
      // 분할 — 회차별 (paid 회차 발행 대상 + 발행된 증빙은 취소건에서도 정정 추적용 노출).
      for (const ins of installments) {
        const insIssuedNo = kind === 'tax' ? ins.tax_invoice_no : ins.cash_receipt_no;
        if (ins.status !== 'paid' && !insIssuedNo) continue;
        if (kind === 'tax') {
          const dueAt = taxInvoiceDueDate(ins.paid_at);
          const issued = !!ins.tax_invoice_no;
          rows.push({
            ...base,
            installment_id: ins.id, installment_no: ins.installment_no, installment_label: ins.label || null,
            amount: Number(ins.amount || 0), paid_at: iso(ins.paid_at),
            status: issued ? 'issued' : 'pending',
            issued_no: ins.tax_invoice_no || null, issued_at: iso(ins.tax_invoice_at),
            due_at: dueAt ? dueAt.toISOString() : null, due_kind: 'legal',
            urgency: issued ? 'done' : urgencyOf(dueAt),
          });
        } else {
          const dueAt = cashReceiptDueDate(ins.paid_at);
          const issued = !!ins.cash_receipt_no;
          rows.push({
            ...base,
            installment_id: ins.id, installment_no: ins.installment_no, installment_label: ins.label || null,
            amount: Number(ins.amount || 0), paid_at: iso(ins.paid_at),
            status: issued ? 'issued' : 'pending',
            issued_no: ins.cash_receipt_no || null, issued_at: iso(ins.cash_receipt_at),
            due_at: dueAt ? dueAt.toISOString() : null, due_kind: 'recommended',
            urgency: issued ? 'done' : urgencyOf(dueAt),
          });
        }
      }
    } else {
      // invoice-level — 단건(분할 아님). 완납(paid) 발행대상 + 발행된 증빙은 취소건에서도 정정 추적용 노출.
      const invIssuedNo = kind === 'tax' ? inv.tax_invoice_external_id : inv.cash_receipt_no;
      if (inv.status !== 'paid' && !invIssuedNo) continue;
      const amount = Number(inv.grand_total || inv.total_amount || 0);
      if (kind === 'tax') {
        const dueAt = taxInvoiceDueDate(inv.paid_at);
        const issued = inv.tax_invoice_status === 'issued' || !!inv.tax_invoice_external_id;
        rows.push({
          ...base,
          installment_id: null, installment_no: null, installment_label: null,
          amount, paid_at: iso(inv.paid_at),
          status: issued ? 'issued' : 'pending',
          issued_no: inv.tax_invoice_external_id || null,
          issued_at: iso(inv.tax_invoice_issued_at),
          due_at: dueAt ? dueAt.toISOString() : null,
          due_kind: 'legal',
          urgency: issued ? 'done' : urgencyOf(dueAt),
        });
      } else {
        const dueAt = cashReceiptDueDate(inv.paid_at);
        const issued = inv.cash_receipt_status === 'issued' || !!inv.cash_receipt_no;
        rows.push({
          ...base,
          installment_id: null, installment_no: null, installment_label: null,
          amount, paid_at: iso(inv.paid_at),
          status: issued ? 'issued' : 'pending',
          issued_no: inv.cash_receipt_no || null,
          issued_at: iso(inv.cash_receipt_issued_at),
          due_at: dueAt ? dueAt.toISOString() : null,
          due_kind: 'recommended',
          urgency: issued ? 'done' : urgencyOf(dueAt),
        });
      }
    }
  }

  // 정정 오버레이 — receipt_corrections 가 있으면 유효상태(corrected/canceled/amended) 파생.
  //   취소된 청구서의 발행 증빙인데 아직 정정 안 됐으면 correction_pending(수정 필요).
  for (const row of rows) {
    const key = `${row.invoice_id}:${row.installment_id || 'inv'}:${row.kind}`;
    const corr = corrections[key] || null;
    if (corr) {
      row.correction = {
        reason: corr.reason,
        corrected_no: corr.corrected_no,
        written_at: iso(corr.written_at),
        amount_delta: corr.amount_delta != null ? Number(corr.amount_delta) : null,
      };
      row.effective = (corr.reason === 'cancel' || corr.reason === 'duplicate') ? 'canceled'
        : (corr.reason === 'amount_change' || corr.reason === 'return') ? 'amended' : 'corrected';
      row.urgency = 'done';
    } else if (row._canceled && row.status === 'issued') {
      row.effective = 'correction_pending';
      row.urgency = 'correction_pending';
    } else {
      row.effective = row.status; // 'pending' | 'issued'
    }
    delete row._canceled;
  }

  // 정렬: 수정필요 → 발행대기(긴급순) → 발행완료/정정완료(최근순)
  const prio = (r) => {
    if (r.urgency === 'correction_pending') return 0;
    if (r.status === 'pending') return 1 + (({ overdue: 0, soon: 1, normal: 2 })[r.urgency] ?? 2) / 10;
    return 5;
  };
  rows.sort((a, b) => {
    const pa = prio(a), pb = prio(b);
    if (pa !== pb) return pa - pb;
    if (pa >= 5) return (b.issued_at || '').localeCompare(a.issued_at || '');
    return (a.due_at || '').localeCompare(b.due_at || '');
  });
  return rows;
}

/**
 * 워크스페이스의 증빙 행 조회 (fetch + build).
 * @param {object} models - { Invoice, Client, InvoiceInstallment }
 * @param {object} where  - Invoice where 절 (접근제어 포함). 최소 { business_id }
 */
async function fetchReceiptRows(models, where) {
  const { Invoice, Client, InvoiceInstallment } = models;
  const ReceiptCorrection = models.ReceiptCorrection || require('../models').ReceiptCorrection;
  // 취소건도 포함 — 발행된 증빙의 정정 추적(correction_pending/corrected)을 큐에 노출. 초안만 제외.
  const invoices = await Invoice.findAll({
    where: { ...where, status: { [Op.ne]: 'draft' } },
    include: [
      {
        model: Client,
        attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'is_business', 'country'],
        required: false,
      },
      { model: InvoiceInstallment, as: 'installments', separate: true, order: [['installment_no', 'ASC']] },
    ],
    order: [['created_at', 'DESC']],
    limit: 1000,
  });
  // 정정 이력 로드 → 키별 최신 1건 맵 (${invoice_id}:${installment_id|'inv'}:${kind})
  const corrections = {};
  if (invoices.length) {
    const invIds = invoices.map((i) => i.id);
    const corrRows = await ReceiptCorrection.findAll({
      where: { invoice_id: { [Op.in]: invIds } },
      order: [['created_at', 'DESC']],
    });
    for (const c of corrRows) {
      const key = `${c.invoice_id}:${c.installment_id || 'inv'}:${c.kind}`;
      if (!corrections[key]) corrections[key] = c; // 최신(DESC 첫 건)
    }
  }
  return buildReceiptRows(invoices, corrections);
}

module.exports = {
  buildReceiptRows,
  fetchReceiptRows,
  taxInvoiceDueDate,
  cashReceiptDueDate,
  urgencyOf,
  receiptKindOf,
};
