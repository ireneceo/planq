// PDF Templates — HTML 생성 (Puppeteer 가 렌더 → PDF)
// 청구서 / 문서(post) 두 종류.

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatMoney(n, currency = 'KRW') {
  const num = Number(n || 0);
  if (currency === 'KRW') return '₩' + num.toLocaleString('ko-KR');
  if (currency === 'USD') return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === 'EUR') return '€' + num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === 'JPY') return '¥' + num.toLocaleString('ja-JP');
  if (currency === 'CNY') return '¥' + num.toLocaleString('zh-CN');
  return `${currency} ${num.toLocaleString()}`;
}

function fmtDate(s) {
  if (!s) return '—';
  return String(s).slice(0, 10);
}

const BASE_CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', 'Pretendard', -apple-system, sans-serif; color: #0F172A; margin: 0; padding: 36px 40px; font-size: 12px; line-height: 1.55; }
  h1 { font-size: 24px; font-weight: 800; margin: 0 0 8px 0; letter-spacing: -0.5px; }
  h2 { font-size: 14px; font-weight: 700; margin: 22px 0 8px 0; color: #0F766E; text-transform: uppercase; letter-spacing: 0.6px; }
  table { width: 100%; border-collapse: collapse; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #0F766E; }
  .brand { font-size: 11px; font-weight: 700; color: #0F766E; text-transform: uppercase; letter-spacing: 0.6px; }
  .meta { font-size: 11px; color: #64748B; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 16px; }
  .pair .col { font-size: 11px; }
  .pair .label { font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; font-size: 10px; }
  .pair .val { font-size: 12px; color: #0F172A; line-height: 1.5; }
  .items th, .items td { padding: 10px 8px; text-align: left; border-bottom: 1px solid #E2E8F0; font-size: 11px; }
  .items th { background: #F8FAFC; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; font-size: 10px; }
  .items td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 12px; }
  .totals .row { display: flex; justify-content: flex-end; gap: 12px; padding: 4px 8px; font-size: 11px; }
  .totals .row.grand { font-size: 16px; font-weight: 800; color: #0F172A; padding: 10px 8px; border-top: 2px solid #0F172A; margin-top: 6px; }
  .totals .label { color: #64748B; min-width: 80px; text-align: right; }
  .totals .val { font-variant-numeric: tabular-nums; min-width: 120px; text-align: right; }
  .bank { background: #F8FAFC; border-radius: 8px; padding: 14px 16px; margin-top: 18px; }
  .bank .row { display: flex; gap: 12px; padding: 3px 0; font-size: 11px; }
  .bank .row .label { color: #64748B; width: 90px; }
  .bank .row .val { color: #0F172A; font-weight: 500; }
  .installments { margin-top: 12px; }
  .installments th, .installments td { padding: 8px; border-bottom: 1px solid #F1F5F9; font-size: 11px; }
  .footer-note { margin-top: 24px; font-size: 10px; color: #94A3B8; line-height: 1.6; padding-top: 12px; border-top: 1px solid #E2E8F0; }
  .body-content { font-size: 12px; line-height: 1.75; color: #334155; }
  .body-content h1, .body-content h2, .body-content h3 { color: #0F172A; margin-top: 16px; }
  .body-content p { margin: 6px 0; }
  .body-content table { margin: 10px 0; border: 1px solid #E2E8F0; }
  .body-content table th, .body-content table td { padding: 6px 10px; border: 1px solid #E2E8F0; }
  .body-content ul, .body-content ol { margin: 6px 0; padding-left: 22px; }
  .body-content li { margin: 3px 0; }
`;

// ─── 청구서 PDF ───
function invoicePdfHtml(inv, sender, client) {
  const isForeign = inv.currency && inv.currency !== 'KRW';
  const isSplit = inv.installment_mode === 'split' && Array.isArray(inv.installments) && inv.installments.length > 0;
  const subtotal = Number(inv.subtotal || 0) || (Number(inv.grand_total || 0) - Number(inv.tax_amount || 0));
  const tax = Number(inv.tax_amount || 0);
  const grand = Number(inv.grand_total || 0);

  const senderName = isForeign ? (sender?.legal_name_en || sender?.brand_name || sender?.name || '—') : (sender?.legal_name || sender?.brand_name || sender?.name || '—');
  const clientName = isForeign ? (client?.biz_name || client?.company_name || client?.display_name || '—') : (client?.biz_name || client?.company_name || client?.display_name || '—');

  const itemsRows = (inv.items || []).map(it => `
    <tr>
      <td>${escapeHtml(it.name || '')}${it.description ? `<br/><span style="color:#94A3B8;font-size:10px;">${escapeHtml(it.description)}</span>` : ''}</td>
      <td class="num">${Number(it.quantity || 1).toLocaleString()}</td>
      <td class="num">${formatMoney(it.unit_price, inv.currency)}</td>
      <td class="num">${formatMoney(it.amount || (Number(it.quantity || 1) * Number(it.unit_price || 0)), inv.currency)}</td>
    </tr>
  `).join('');

  const installmentsBlock = isSplit ? `
    <h2>${isForeign ? 'Payment Schedule' : '결제 일정'}</h2>
    <table class="installments">
      <thead><tr>
        <th>#</th>
        <th>${isForeign ? 'Phase' : '회차'}</th>
        <th class="num">%</th>
        <th class="num">${isForeign ? 'Amount' : '금액'}</th>
        <th>${isForeign ? 'Due' : '기한'}</th>
        <th>${isForeign ? 'Status' : '상태'}</th>
      </tr></thead>
      <tbody>
        ${(inv.installments || []).map(i => `
          <tr>
            <td>${i.installment_no}</td>
            <td>${escapeHtml(i.label || '')}</td>
            <td class="num">${Number(i.percent || 0).toFixed(1)}</td>
            <td class="num">${formatMoney(i.amount, inv.currency)}</td>
            <td>${fmtDate(i.due_date)}</td>
            <td>${i.status === 'paid' ? (isForeign ? '✓ Paid' : '✓ 결제완료') : (i.status === 'overdue' ? (isForeign ? 'Overdue' : '연체') : (isForeign ? 'Pending' : '대기'))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const bankBlock = sender?.bank_name ? `
    <div class="bank">
      <div style="font-weight:700;font-size:12px;margin-bottom:6px;color:#0F172A;">${isForeign ? 'Wire Transfer Information' : '입금 안내'}</div>
      <div class="row"><div class="label">${isForeign ? 'Bank' : '은행'}</div><div class="val">${escapeHtml(isForeign && sender.bank_name_en ? sender.bank_name_en : sender.bank_name)}</div></div>
      <div class="row"><div class="label">${isForeign ? 'Account No.' : '계좌번호'}</div><div class="val" style="font-family:ui-monospace,monospace;">${escapeHtml(sender.bank_account_number || '—')}</div></div>
      <div class="row"><div class="label">${isForeign ? 'Holder' : '예금주'}</div><div class="val">${escapeHtml(isForeign && sender.bank_account_name_en ? sender.bank_account_name_en : (sender.bank_account_name || senderName))}</div></div>
      ${isForeign && sender.swift_code ? `<div class="row"><div class="label">SWIFT/BIC</div><div class="val" style="font-family:ui-monospace,monospace;">${escapeHtml(sender.swift_code)}</div></div>` : ''}
    </div>
  ` : '';

  const senderBizLine = sender?.tax_id ? `<div class="val" style="margin-top:2px;font-size:10px;color:#64748B;">${isForeign ? 'Business No.' : '사업자등록번호'}: ${escapeHtml(sender.tax_id)}</div>` : '';
  const senderRepLine = sender?.representative ? `<div class="val" style="font-size:10px;color:#64748B;">${isForeign ? 'Representative' : '대표자'}: ${escapeHtml(sender.representative)}</div>` : '';
  const senderAddrLine = sender?.address ? `<div class="val" style="font-size:10px;color:#64748B;">${escapeHtml(isForeign && sender.address_en ? sender.address_en : sender.address)}</div>` : '';

  return `<!DOCTYPE html>
<html lang="${isForeign ? 'en' : 'ko'}">
<head><meta charset="utf-8"><title>${escapeHtml(inv.invoice_number || 'Invoice')}</title>
<style>${BASE_CSS}</style></head>
<body>
  <div class="header">
    <div>
      <div class="brand">${isForeign ? 'INVOICE' : '청구서'}</div>
      <h1>${escapeHtml(inv.title || (isForeign ? 'Invoice' : '청구서'))}</h1>
      <div class="meta" style="font-family:ui-monospace,monospace;">${escapeHtml(inv.invoice_number || '')}</div>
    </div>
    <div style="text-align:right;font-size:11px;">
      <div style="color:#64748B;">${isForeign ? 'Issued' : '발행일'}: ${fmtDate(inv.issued_at || inv.created_at)}</div>
      ${inv.due_date ? `<div style="color:#64748B;">${isForeign ? 'Due' : '기한'}: ${fmtDate(inv.due_date)}</div>` : ''}
    </div>
  </div>

  <div class="pair">
    <div class="col">
      <div class="label">${isForeign ? 'From' : '발신'}</div>
      <div class="val" style="font-weight:700;font-size:13px;">${escapeHtml(senderName)}</div>
      ${senderBizLine}
      ${senderRepLine}
      ${senderAddrLine}
    </div>
    <div class="col">
      <div class="label">${isForeign ? 'Bill To' : '수신'}</div>
      <div class="val" style="font-weight:700;font-size:13px;">${escapeHtml(clientName)}</div>
      ${client?.biz_tax_id ? `<div class="val" style="margin-top:2px;font-size:10px;color:#64748B;">${isForeign ? 'Business No.' : '사업자등록번호'}: ${escapeHtml(client.biz_tax_id)}</div>` : ''}
      ${client?.biz_ceo ? `<div class="val" style="font-size:10px;color:#64748B;">${isForeign ? 'Representative' : '대표자'}: ${escapeHtml(client.biz_ceo)}</div>` : ''}
      ${client?.biz_address ? `<div class="val" style="font-size:10px;color:#64748B;">${escapeHtml(isForeign && client.biz_address_en ? client.biz_address_en : client.biz_address)}</div>` : ''}
    </div>
  </div>

  <h2>${isForeign ? 'Items' : '항목'}</h2>
  <table class="items">
    <thead><tr>
      <th>${isForeign ? 'Description' : '품목'}</th>
      <th class="num">${isForeign ? 'Qty' : '수량'}</th>
      <th class="num">${isForeign ? 'Unit price' : '단가'}</th>
      <th class="num">${isForeign ? 'Amount' : '금액'}</th>
    </tr></thead>
    <tbody>${itemsRows || `<tr><td colspan="4" style="text-align:center;color:#94A3B8;padding:18px;">${isForeign ? '(no items)' : '(항목 없음)'}</td></tr>`}</tbody>
  </table>

  <div class="totals">
    <div class="row"><div class="label">${isForeign ? 'Subtotal' : '공급가액'}</div><div class="val">${formatMoney(subtotal, inv.currency)}</div></div>
    ${tax > 0 ? `<div class="row"><div class="label">${isForeign ? 'VAT' : '부가세'}</div><div class="val">${formatMoney(tax, inv.currency)}</div></div>` : ''}
    <div class="row grand"><div class="label">${isForeign ? 'Total Due' : '합계'}</div><div class="val">${formatMoney(grand, inv.currency)}</div></div>
  </div>

  ${installmentsBlock}
  ${bankBlock}

  ${inv.notes ? `<div class="footer-note">${escapeHtml(inv.notes)}</div>` : ''}
  ${inv.payment_terms ? `<div class="footer-note">${escapeHtml(inv.payment_terms)}</div>` : ''}
</body>
</html>`;
}

// ─── 문서(post) PDF — TipTap JSON 또는 HTML 본문 ───
function tiptapToHtml(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const arr = Array.isArray(node) ? node : (node.content || []);
  return arr.map(n => nodeToHtml(n)).join('');
}

function nodeToHtml(n) {
  if (!n || typeof n !== 'object') return '';
  if (n.type === 'text') {
    let txt = escapeHtml(n.text || '');
    (n.marks || []).forEach(m => {
      if (m.type === 'bold') txt = `<strong>${txt}</strong>`;
      else if (m.type === 'italic') txt = `<em>${txt}</em>`;
      else if (m.type === 'underline') txt = `<u>${txt}</u>`;
      else if (m.type === 'strike') txt = `<s>${txt}</s>`;
      else if (m.type === 'code') txt = `<code>${txt}</code>`;
      else if (m.type === 'link') txt = `<a href="${escapeHtml((m.attrs || {}).href || '#')}">${txt}</a>`;
    });
    return txt;
  }
  const inner = (n.content || []).map(nodeToHtml).join('');
  switch (n.type) {
    case 'paragraph': return `<p>${inner}</p>`;
    case 'heading': return `<h${n.attrs?.level || 2}>${inner}</h${n.attrs?.level || 2}>`;
    case 'bulletList': return `<ul>${inner}</ul>`;
    case 'orderedList': return `<ol>${inner}</ol>`;
    case 'listItem': return `<li>${inner}</li>`;
    case 'blockquote': return `<blockquote>${inner}</blockquote>`;
    case 'codeBlock': return `<pre><code>${inner}</code></pre>`;
    case 'horizontalRule': return `<hr/>`;
    case 'hardBreak': return `<br/>`;
    case 'table': return `<table>${inner}</table>`;
    case 'tableRow': return `<tr>${inner}</tr>`;
    case 'tableCell': return `<td>${inner}</td>`;
    case 'tableHeader': return `<th>${inner}</th>`;
    case 'image': return `<img src="${escapeHtml((n.attrs || {}).src || '')}" style="max-width:100%;"/>`;
    default: return inner;
  }
}

function postPdfHtml(post, author, business) {
  const bodyHtml = post.content_json
    ? (typeof post.content_json === 'string' ? post.content_json : tiptapToHtml(post.content_json))
    : (post.content_html || '');
  const senderName = business?.legal_name || business?.brand_name || business?.name || '—';
  const dateStr = post.shared_at || post.created_at;
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escapeHtml(post.title || '문서')}</title>
<style>${BASE_CSS}</style></head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml((post.category || 'DOCUMENT').toUpperCase())}</div>
      <h1>${escapeHtml(post.title || '문서')}</h1>
      <div class="meta">${escapeHtml(senderName)} · ${fmtDate(dateStr)}${author?.name ? ` · ${escapeHtml(author.name)}` : ''}</div>
    </div>
  </div>
  <div class="body-content">${bodyHtml}</div>
</body>
</html>`;
}

module.exports = { invoicePdfHtml, postPdfHtml };
