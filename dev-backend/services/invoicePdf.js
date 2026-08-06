// 청구서 PDF 빌더 — 단일 착지점
//
// 원래 routes/invoices.js 안에 있어 export 되지 않았고, 그 결과 정기청구 2엔진
// (recurring_invoice · clientSubscriptionBilling)이 존재한 적 없는 './pdfBuilder' 를
// require 하다 빈 catch 에 삼켜져 **자동 발송 메일에 PDF 가 한 번도 첨부되지 않았다**.
// 라우트와 엔진이 같은 구현을 공유하도록 서비스로 추출한다. 로직은 무변경.
//
// 반환 시그니처 { pdf, invoice } 유지 — routes/invoices.js 호출부 중 632·1047 이
// invoice 를 함께 사용한다(파일명·헤더 구성).

const { Invoice, InvoiceItem, InvoiceInstallment, Client, Business } = require('../models');

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
  const { invoicePdfHtml } = require('./pdfTemplates');
  const { renderPdfFromHtml } = require('./pdfService');
  const html = invoicePdfHtml(invoice.toJSON(), business?.toJSON() || {}, invoice.Client?.toJSON() || {});
  return { pdf: await renderPdfFromHtml(html), invoice };
}

module.exports = { buildInvoicePdf };
