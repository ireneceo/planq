// services/receiptNotify.js — 증빙(세금계산서·현금영수증) 고객 통지 수신자 **단일 원천**.
//
// 소비자가 셋이라 서비스로 뺐다:
//   ① routes/invoices.js `notifyCustomerReceiptIssued`  (발행 통지 발송)
//   ② routes/invoices.js `notifyCustomerReceiptCorrected` (정정 통지 발송)
//   ③ services/receiptsDue.js                            (증빙 큐 — 마킹 **전에** 수신자를 화면에 보여준다)
//
// ③ 이 왜 필요한가 (#217): 여태 수신자 해석이 발송 함수 안에만 있어서, 사용자는 "누구에게 가는지"
// 를 마킹 전에 알 수 없었고 **수신 주소가 없으면 조용히 안 나갔다**. 화면이 같은 답을 보려면
// 같은 함수를 써야 한다 — 로직을 복붙하면 두 벌이 어긋난다(이 파일이 생기기 전 실제로 두 벌이었다).
//
// 정책: 명시적으로 등록된 주소 + 형식 검증 통과분만. 추측 주소로 자동 발송하지 않는다
//       (memory feedback_no_automail_unverified).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 우선순위: receipt_profile.tax_email → 고객 세금계산서/청구담당/초대 이메일 → 청구서 수신자.
 * @param invoice Invoice 인스턴스 또는 { receipt_profile, recipient_email, client_id } 평문
 * @param client  이미 로드된 Client (또는 이메일 3필드를 가진 평문). `undefined` 면 조회, `null` 이면 없음.
 * @returns 형식 검증을 통과한 주소, 없으면 null
 */
async function resolveReceiptNotifyEmail(invoice, client = undefined) {
  if (!invoice) return null;
  let c = client;
  if (c === undefined) {
    const { Client } = require('../models');
    c = invoice.client_id
      ? await Client.findByPk(invoice.client_id, { attributes: ['tax_invoice_email', 'billing_contact_email', 'invite_email'] })
      : null;
  }
  const profile = invoice.receipt_profile || null;
  const to = (profile && profile.tax_email)
    || (c && (c.tax_invoice_email || c.billing_contact_email || c.invite_email))
    || invoice.recipient_email || null;
  return to && EMAIL_RE.test(String(to)) ? String(to) : null;
}

/** 조회 없이 판정할 때 (Client 를 이미 join 해 둔 목록 경로용) — 동기. */
function resolveReceiptNotifyEmailSync(invoice, client) {
  if (!invoice) return null;
  const profile = invoice.receipt_profile || null;
  const to = (profile && profile.tax_email)
    || (client && (client.tax_invoice_email || client.billing_contact_email || client.invite_email))
    || invoice.recipient_email || null;
  return to && EMAIL_RE.test(String(to)) ? String(to) : null;
}

module.exports = { EMAIL_RE, resolveReceiptNotifyEmail, resolveReceiptNotifyEmailSync };
