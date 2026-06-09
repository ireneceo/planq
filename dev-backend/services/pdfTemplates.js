// PDF Templates — HTML 생성 (Puppeteer 가 렌더 → PDF)
// 청구서 / 문서(post) 두 종류.

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatMoney(n, currency = 'KRW') {
  const num = Number(n || 0);
  if (currency === 'KRW') return num.toLocaleString('ko-KR') + '원';
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

// ─── 경영 보고서 PDF (월간/분기/연간/임의) ───
//
// 입력: { period:{from,to,kind,label}, business:{name,legal_name}, generatedAt, tabs:{overview,tasks,profit,team,finance} }
// 단일 페이지 임원 요약 + 필요 시 자동 분기.
function reportPdfHtml({ period, business, generatedAt, tabs }) {
  const kindLabel = {
    monthly: '월간',
    quarterly: '분기',
    yearly: '연간',
    adhoc: '맞춤',
  }[period.kind] || period.kind;

  const bizName = business?.legal_name || business?.brand_name || business?.name || '—';
  const ov = tabs.overview || {};
  const tk = tabs.tasks || {};
  const pf = tabs.profit || {};
  const tm = tabs.team || {};
  const fn = tabs.finance || {};

  const fmtKRW = (v) => v == null ? '—' : Math.round(v).toLocaleString('ko-KR') + '원';
  const fmtPct = (v) => v == null ? '—' : `${Number(v).toFixed(1)}%`;
  const fmtNum = (v) => v == null ? '—' : Number(v).toLocaleString('ko-KR');

  const insightsRow = (list) => (list || []).slice(0, 3).map((ins) => {
    const sev = ins.severity || 'info';
    const stripe = sev === 'urgent' ? '#EF4444' : sev === 'warning' ? '#F59E0B' : '#0F766E';
    return `
      <div class="insight" style="border-left:3px solid ${stripe};">
        <div class="ins-title">${escapeHtml(ins.title || '')}</div>
        <div class="ins-value">${escapeHtml(ins.value || '')}</div>
        ${ins.hint ? `<div class="ins-hint">${escapeHtml(ins.hint)}</div>` : ''}
      </div>`;
  }).join('');

  const kpi = (label, value) => `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
    </div>`;

  // Profit Top 5 행 + Team Top 5 행
  const profitRows = (pf.table || []).slice(0, 5).map((r) => `
    <tr>
      <td>${escapeHtml(r.name || '')}</td>
      <td>${escapeHtml(r.client || '—')}</td>
      <td class="num">${fmtKRW(r.revenue)}</td>
      <td class="num" style="${r.profit < 0 ? 'color:#B91C1C;font-weight:700;' : ''}">${fmtKRW(r.profit)}</td>
      <td class="num">${fmtPct(r.margin_pct)}</td>
    </tr>
  `).join('');

  const teamRows = (tm.table || []).slice(0, 5).map((r) => `
    <tr>
      <td>${escapeHtml(r.name || '')}</td>
      <td>${escapeHtml(r.role || '—')}</td>
      <td class="num" style="${(r.utilization_pct || 0) > 100 ? 'color:#B91C1C;' : ''}">${fmtPct(r.utilization_pct)}</td>
      <td class="num">${fmtPct(r.accuracy_pct)}</td>
      <td class="num">${fmtNum(r.completed_tasks)}</td>
      <td class="num">${fmtKRW(r.revenue_share)}</td>
    </tr>
  `).join('');

  const expenseRows = (fn.expenses_by_category || []).slice(0, 8).map((r) => `
    <tr>
      <td>${escapeHtml(r.category)}</td>
      <td class="num">${fmtKRW(r.amount)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>${escapeHtml(bizName)} ${kindLabel} 보고서</title>
<style>
  ${BASE_CSS}
  .report-header { padding-bottom: 16px; border-bottom: 2px solid #0F766E; margin-bottom: 20px; }
  .report-period { font-size: 12px; color: #64748B; font-weight: 500; margin-top: 4px; }
  .insights-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 22px; }
  .insight { padding: 10px 12px; background: #F8FAFC; border-radius: 8px; }
  .ins-title { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; }
  .ins-value { font-size: 13px; font-weight: 700; color: #0F172A; margin-top: 3px; }
  .ins-hint { font-size: 10px; color: #64748B; margin-top: 3px; line-height: 1.4; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 22px; }
  .kpi { padding: 12px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; }
  .kpi-label { font-size: 10px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.3px; }
  .kpi-value { font-size: 16px; font-weight: 800; color: #0F172A; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .section { margin-top: 18px; }
  .section h2 { margin-bottom: 8px; }
  .section table { font-size: 10px; }
  .section table th, .section table td { padding: 6px 8px; border-bottom: 1px solid #F1F5F9; }
  .section table th { background: #F8FAFC; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.3px; font-size: 9px; }
  .section table td.num, .section table th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .grid-2 { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
  .signature { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E2E8F0; font-size: 9px; color: #94A3B8; line-height: 1.6; }
</style></head>
<body>
  <div class="report-header">
    <div class="brand">${escapeHtml(kindLabel)} 경영 보고서 · MANAGEMENT REPORT</div>
    <h1>${escapeHtml(bizName)}</h1>
    <div class="report-period">${escapeHtml(period.from)} ~ ${escapeHtml(period.to)}</div>
  </div>

  <h2>핵심 인사이트</h2>
  <div class="insights-row">
    ${insightsRow(ov.insights)}
  </div>

  <h2>경영 지표</h2>
  <div class="kpi-grid">
    ${kpi('매출 (수금)', fmtKRW(ov.kpis?.revenue?.value))}
    ${kpi('영업이익', fmtKRW(ov.kpis?.profit?.value))}
    ${kpi('가동률', fmtPct(ov.kpis?.utilization_pct?.value))}
    ${kpi('발행 청구', fmtKRW(ov.kpis?.issued?.value))}
    ${kpi('활성 프로젝트', fmtNum(ov.kpis?.active_projects?.value))}
    ${kpi('신규 고객', fmtNum(ov.kpis?.new_clients?.value))}
  </div>

  <div class="grid-2">
    <div>
      <h2>업무·시간</h2>
      <div class="kpi-grid" style="grid-template-columns: 1fr 1fr;">
        ${kpi('완료 업무', fmtNum(tk.kpis?.completed?.value))}
        ${kpi('생성 업무', fmtNum(tk.kpis?.created?.value))}
        ${kpi('리드타임 P50', tk.kpis?.leadtime_p50_days?.value == null ? '—' : `${tk.kpis.leadtime_p50_days.value}일`)}
        ${kpi('AI 정확도', fmtPct(tk.kpis?.ai_accuracy_pct?.value))}
      </div>
    </div>
    <div>
      <h2>재무 요약</h2>
      <div class="kpi-grid" style="grid-template-columns: 1fr 1fr;">
        ${kpi('총 비용', fmtKRW(fn.kpis?.total_cost?.value))}
        ${kpi('마진율', fmtPct(fn.kpis?.margin_pct?.value))}
        ${kpi('미수금', fmtKRW(fn.kpis?.receivable?.value))}
        ${kpi('고정비', fmtKRW(fn.kpis?.overhead?.value))}
      </div>
    </div>
  </div>

  <div class="section">
    <h2>프로젝트 수익성 Top 5</h2>
    ${profitRows ? `
      <table style="width:100%;">
        <thead><tr>
          <th>프로젝트</th><th>고객</th>
          <th class="num">매출</th><th class="num">이익</th><th class="num">마진</th>
        </tr></thead>
        <tbody>${profitRows}</tbody>
      </table>
    ` : '<div style="font-size:11px;color:#94A3B8;padding:12px 0;">완료된 프로젝트 데이터가 누적되면 표시됩니다.</div>'}
  </div>

  <div class="section">
    <h2>팀 성과 Top 5</h2>
    ${teamRows ? `
      <table style="width:100%;">
        <thead><tr>
          <th>이름</th><th>역할</th>
          <th class="num">가동률</th><th class="num">정확도</th>
          <th class="num">완료</th><th class="num">매출 비중</th>
        </tr></thead>
        <tbody>${teamRows}</tbody>
      </table>
    ` : '<div style="font-size:11px;color:#94A3B8;padding:12px 0;">팀 데이터가 누적되면 표시됩니다.</div>'}
  </div>

  ${expenseRows ? `
    <div class="section">
      <h2>지출 카테고리 Top 8</h2>
      <table style="width:100%;">
        <thead><tr><th>카테고리</th><th class="num">금액</th></tr></thead>
        <tbody>${expenseRows}</tbody>
      </table>
    </div>
  ` : ''}

  <div class="signature">
    Generated by PlanQ · ${fmtDate(generatedAt)} · 본 보고서는 ${escapeHtml(period.from)} ~ ${escapeHtml(period.to)} 기간 데이터로 자동 산출되었습니다.
  </div>
</body>
</html>`;
}

module.exports = { invoicePdfHtml, postPdfHtml, reportPdfHtml };
