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
const { resolveReceiptNotifyEmailSync } = require('./receiptNotify');

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

/**
 * 청구서 **생성 시점**에 기본으로 넣을 receipt_type 판정 — 정기청구 엔진 전용 단일 원천.
 *
 * 왜 필요한가 (운영 피드백, 2026-08-03 Irene):
 *   정기 청구서는 매달 자동 생성되는데 `recurring_invoice.js` / `clientSubscriptionBilling.js` 의
 *   payload 에 `receipt_type` 이 아예 없어 모델 기본값 `'none'` 으로 떨어졌다. 고객이 한국 사업자로
 *   등록돼 있고 사업자번호·세금계산서 이메일까지 DB 에 다 있는데도 화면엔 "발행 대상 아님" 이 떴다.
 *
 * 술어를 여기 두는 이유: 위 `receiptKindOf()` 와 **같은 파일·같은 기준**이어야 한다.
 *   판정이 갈라지면 "목록엔 증빙 대기인데 상세엔 대상 아님" 같은 모순이 생긴다.
 *
 * 설계 결정 (Fable 설계 게이트):
 *   - `biz_tax_id` 는 **게이트에 넣지 않는다.** 사업자번호는 "결제 후 고객이 공개 페이지에서 직접
 *     입력"하는 정식 흐름이 있다(routes/invoices.js 의 public receipt-request). 발행 의향과
 *     데이터 완비는 별개 축이다.
 *   - 개인 고객(is_business=false)은 `'none'`. 현금영수증은 식별번호(휴대폰)가 필요해 고객 제출로만
 *     세팅된다 — 엔진이 임의로 cash 를 찍으면 안 된다.
 *   - 외화는 한국 세금계산서 발행 대상이 아니다(수동 모달의 `canTax` 와 동일 기준).
 *
 * @returns 'tax_invoice' | 'none'
 */
function defaultReceiptTypeFor(client, currency) {
  if ((currency || 'KRW') !== 'KRW') return 'none';
  if (!client || !client.is_business) return 'none';
  if (client.country && client.country !== 'KR') return 'none';
  return 'tax_invoice';
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
      // 발송 함수와 **같은 함수**로 계산한다. 화면이 보여주는 주소와 실제 발송 주소가 갈라지면 안 된다.
      //   null 이면 화면이 "등록된 수신 주소 없음" 으로 안내하고 발송 체크박스를 잠근다
      //   (여태는 조용히 안 나가서 사용자가 몰랐다).
      receipt_notify_email: resolveReceiptNotifyEmailSync(inv, client),
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
        // #217 — 증빙 탭에서 마킹 **전에** "이 메일이 누구에게 가는지" 를 보여주려면 수신자 후보가 필요하다.
        //   이미 join 하고 있는 Client 라 컬럼만 늘리면 되고 추가 쿼리는 없다.
        attributes: ['id', 'display_name', 'company_name', 'biz_name', 'biz_tax_id', 'is_business', 'country',
          'tax_invoice_email', 'billing_contact_email', 'invite_email'],
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
  defaultReceiptTypeFor,
};

// ─────────────────────────────────────────────
// 운영 #274 — 입금자명에 넣을 **입금 코드** 단일 원천
//
// 왜 서버에서 만드나: 이 문자열을 드로어·공개 결제 페이지·발송 메일 **세 곳이 각자 조립**하고 있었고
//   이미 서로 달랐다(공개 페이지만 수신처 라벨이 하나 더 붙었다). 같은 값의 공식이 여러 벌이면
//   반드시 갈라진다 — 서버가 한 번 계산해 내려주고 세 표면이 그대로 쓴다.
//
// 형식 `0042홍길동` (순번 끝 4자리 + 고객 표시명, 분할이면 `0042-2홍길동`):
//   국내 은행 "받는 분 통장 표시" 는 통상 한글 5~8자에서 **뒷부분이 잘린다**.
//   현행 `INV-2026-0042 상호명` 은 번호만 13자라 **이름이 나오기도 전에 잘렸다**.
//   절단이 꼬리에서 일어나므로 식별번호를 **선두**에 둔다 — 한글 7자로 잘려도 `0042홍길` 까지 남아
//   어느 청구서인지 특정된다. 순번 4자리는 연도 내 유일(generateInvoiceNumber, INV-YYYY-순번).
//   정확 매칭의 정본은 어차피 '송금 완료 알림' 이며 문구가 그 채널을 함께 안내한다.
// ─────────────────────────────────────────────
function payerCodeOf(invoice, client, installmentNo = null) {
  if (!invoice) return '';
  const num = String(invoice.invoice_number || '');
  // INV-2026-0042 → 0042. 형식이 달라져도 숫자 꼬리 4자리로 떨어진다.
  const m = /-(\d+)$/.exec(num);
  const seq = m ? m[1] : num.replace(/\D/g, '').slice(-4);
  const head = installmentNo ? `${seq}-${installmentNo}` : seq;
  const name = String(
    client?.display_name || client?.company_name || client?.biz_name || ''
  ).trim();
  return `${head}${name}`;
}

module.exports.payerCodeOf = payerCodeOf;

/**
 * 증빙 정보(공급받는자) 단일 resolve — **표시·발행에 쓰는 값은 여기 하나에서 나온다.**
 *
 * ★ 2026-09-01 (Irene: "이미 몇 개월 결제 중인 구독 고객인데 세금계산서 정보가 왜 안 나와?")
 *   `invoice.receipt_profile` 은 **고객이 공개 결제 페이지에서 직접 입력·확인한** 값이라,
 *   계좌이체로만 결제하는 정기 구독 고객은 그 페이지를 한 번도 거치지 않아 영영 NULL 이다.
 *   운영 실측: 고객 #6(기율 법률사무소, 사업자번호 저장돼 있음)의 청구서 4건(6~9월) **전부 NULL**.
 *   서버는 이미 증빙 큐·PDF·메일·공개페이지 4곳에서 Client 로 폴백하고 있었는데
 *   **청구서 상세 화면만** 그 폴백이 없어 정보 상자 자체가 안 그려졌다 —
 *   "저장했으면 사업자 정보가 나와야지" 가 맞다. 공식이 갈라지지 않게 여기로 모은다.
 *
 * @returns {{ profile: object|null, source: 'customer'|'client'|'recipient'|null }}
 *   source — 어디서 온 값인지. 화면이 "고객 확인 정보"(customer) 와
 *   "고객 등록 정보"(client) 를 구분해 말할 수 있어야 사용자가 신뢰 여부를 판단한다.
 */
function resolveReceiptProfile(inv, client) {
  if (!inv) return { profile: null, source: null };
  if (inv.receipt_profile) return { profile: inv.receipt_profile, source: 'customer' };
  if (client) {
    return {
      source: 'client',
      profile: {
        biz_type: client.is_business ? 'business' : 'individual',
        biz_name: client.biz_name || client.company_name || null,
        biz_tax_id: client.biz_tax_id || inv.recipient_business_number || null,
        biz_ceo: client.biz_ceo || null,
        biz_category: client.biz_type || null,
        biz_item: client.biz_item || null,
        biz_address: client.biz_address || null,
        tax_email: client.tax_invoice_email || client.billing_contact_email || null,
        requested_by_name: client.billing_contact_name || null,
        contact_phone: client.billing_contact_phone || null,
        // 개인(현금영수증) 식별번호 — 지난 신청 시 저장한 연락처를 다음에도 자동 채움
        cr_identifier: !client.is_business ? (client.billing_contact_phone || null) : null,
      },
    };
  }
  // 등록 고객이 아닌 외부 수신자 — 청구서에 직접 적어 넣은 상호·사업자번호
  if (inv.recipient_business_name || inv.recipient_business_number) {
    return {
      source: 'recipient',
      profile: {
        biz_type: 'business',
        biz_name: inv.recipient_business_name || null,
        biz_tax_id: inv.recipient_business_number || null,
      },
    };
  }
  return { profile: null, source: null };
}

module.exports.resolveReceiptProfile = resolveReceiptProfile;
