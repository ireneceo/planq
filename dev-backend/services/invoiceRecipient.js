// 청구서 «받는 쪽» 한 벌 — 상세 화면·발송·재발송·독촉·PDF 가 같은 값을 쓴다 (2026-10-23).
//
// 규칙: 등록 고객이면 **지금 고객 정보**(Q sale·고객 상세에서 고친 값)가 먼저다.
//   청구서에 적힌 recipient_* 는 고객에게 그 칸이 없을 때만 메운다(발행 창 «누락 보완» 값).
//   외부 수신(client 없음)이면 청구서에 적힌 값이 전부다.
// 왜: 옛 발행 창이 고객 값을 청구서에 그대로 복사해 두어, 나중에 Q sale 에서 상호·메일을 고쳐도
//   상세 화면은 옛 상호를, 발송은 옛 메일 주소를 썼다 — 공개 페이지·증빙은 이미 고객 값을 먼저 읽어 화면끼리 갈렸다.
//   (공개 페이지 PublicInvoicePage · 증빙 resolveReceiptProfile 이 이미 이 순서다.)

// 이 함수가 읽는 고객 칸 — include 할 때 이 목록을 쓴다(빠지면 조용히 청구서 값으로 떨어진다)
const RECIPIENT_CLIENT_ATTRS = [
  'biz_name', 'company_name', 'display_name', 'biz_tax_id', 'biz_ceo', 'biz_address', 'biz_address_en',
  'tax_invoice_email', 'billing_contact_email', 'invite_email',
];

function recipientOf(invoice, client) {
  const inv = invoice || {};
  const c = client || null;
  if (!c) {
    return {
      name: inv.recipient_business_name || null,
      tax_id: inv.recipient_business_number || null,
      ceo: null,
      address: null,
      email: inv.recipient_email || null,
    };
  }
  return {
    name: c.biz_name || inv.recipient_business_name || c.company_name || c.display_name || null,
    tax_id: c.biz_tax_id || inv.recipient_business_number || null,
    ceo: c.biz_ceo || null,
    address: c.biz_address || c.biz_address_en || null,
    email: c.tax_invoice_email || c.billing_contact_email || c.invite_email || inv.recipient_email || null,
  };
}

// 발송용 — 고객 행을 직접 읽는다(호출부가 include 를 빼먹어도 옛 주소로 떨어지지 않게)
async function recipientEmailOf(invoice) {
  if (!invoice) return null;
  if (!invoice.client_id) return invoice.recipient_email || null;
  const { Client } = require('../models');
  const cl = await Client.findOne({
    where: { id: invoice.client_id, business_id: invoice.business_id },
    attributes: RECIPIENT_CLIENT_ATTRS,
  });
  return recipientOf(invoice, cl).email;
}

module.exports = { recipientOf, recipientEmailOf, RECIPIENT_CLIENT_ATTRS };
