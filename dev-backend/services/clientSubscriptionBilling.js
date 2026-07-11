// 고객 정기 구독청구 엔진 (사이클 N+83) — ClientSubscription 이 next_billing_at 도달 시 Invoice 자동 생성.
//   recurring_invoice(billOneProject) 패턴 재사용: Invoice+Item, share_token 공개결제, VAT, 이메일/PDF, auto/draft.
//   멱등: 발행 후 next_billing_at 을 interval 만큼 전진 → 같은 날 재실행/과거 누적분도 1회만 발행하고 미래로 resync.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { ClientSubscription, Client, Business, Invoice, InvoiceItem, BusinessMember } = require('../models');
const { recurringMetaForSub } = require('./invoiceRecurring');
const { sequelize } = require('../config/database');

// invoice_number — recurring_invoice 와 동일 포맷 (INV-YYYY-NNNN)
// 운영 — robust: INV-YYYY- prefix 전체에서 실제 최대 순번을 스캔(깨진/비표준 번호 skip).
//   기존 "last by id" 방식은 다건 순차 발행/비표준 번호에서 NaN·중복 발생(memory recurring_billing_latent_bugs).
async function nextInvoiceNumber() {
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
}

// DATEONLY 값(Date | string) → 'YYYY-MM-DD' 문자열 정규화
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// 날짜(YYYY-MM-DD) 를 interval 만큼 전진. 월/분기/연은 일자 유지(월말 clamp).
function advanceDate(dateInput, interval) {
  const dateStr = toDateStr(dateInput);
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (interval === 'weekly') {
    d.setUTCDate(d.getUTCDate() + 7);
  } else if (interval === 'biweekly') {
    d.setUTCDate(d.getUTCDate() + 14);
  } else {
    const months = interval === 'monthly' ? 1 : interval === 'quarterly' ? 3 : interval === 'semiannual' ? 6 : 12;
    const anchorDay = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(anchorDay, lastDay));
  }
  return d.toISOString().slice(0, 10);
}

function todayStr(today = new Date()) {
  return new Date(today).toISOString().slice(0, 10);
}

// 라벨 — 발행 시점 회차 표기 (예: "월 유지보수 (2026-06)")
function periodLabel(planName, dateInput, interval) {
  const dateStr = toDateStr(dateInput) || '';
  const tag = interval === 'weekly' ? dateStr : dateStr.slice(0, 7);
  return `${planName} (${tag})`;
}

// Invoice.created_by(notNull) 용 creator 해석 — 구독 생성자 > 청구담당 > owner 멤버
async function resolveCreator(sub, business) {
  if (sub.created_by) return sub.created_by;
  if (business.default_billing_owner_id) return business.default_billing_owner_id;
  const owner = await BusinessMember.findOne({ where: { business_id: business.id, role: 'owner', removed_at: null }, attributes: ['user_id'] });
  return owner?.user_id || null;
}

// 단일 구독 1회 발행
// 멱등키의 기간 문자열 — 반드시 YYYY-MM-DD.
//   next_billing_at 은 DATEONLY 라 문자열일 때도, 코드가 advanceDate 로 밀어 Date 객체일 때도 있다.
//   String(Date) 는 "Tue Aug 11 2026 …" 라서 앞 10자를 자르면 "Tue Aug 11" 같은 쓰레기 키가 되고,
//   훗날 엉뚱하게 충돌해 정상 청구를 막을 수 있다. (DATEONLY 함정)
function toPeriodStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// 청구서는 만들어졌는데 next_billing_at 을 밀기 전에 프로세스가 죽으면(배포 중 재시작 등),
// 이후 모든 cron 이 같은 회차를 due 로 보고 → 멱등키에 막혀 skip → 그 구독은 영원히 청구가 멈춘다.
// 중복 청구는 눈에 보이지만 이건 조용한 매출 손실이라 더 위험하다.
// → skip 경로에서도 "청구서는 이미 있는데 아직 안 밀린" 상태면 전진을 마저 수행한다 (자가 치유).
//   fresh 로 다시 읽어 이미 밀렸으면 아무 것도 하지 않는다 (동시 실행의 loser 가 이중 증가시키지 않게).
async function ensureAdvancedAfterBilling(subId, billedPeriod, today) {
  const { ClientSubscription } = require('../models');
  const fresh = await ClientSubscription.findByPk(subId);
  if (!fresh) return false;
  if (toPeriodStr(fresh.next_billing_at) !== billedPeriod) return false;   // 이미 전진 완료

  let next = advanceDate(fresh.next_billing_at, fresh.interval);
  const t = todayStr(today);
  let guard = 0;
  while (next <= t && guard < 120) { next = advanceDate(next, fresh.interval); guard += 1; }

  const occ = Number(fresh.occurrences_count || 0) + 1;
  let ended = false;
  if (fresh.end_mode === 'after_count' && fresh.max_occurrences && occ >= Number(fresh.max_occurrences)) ended = true;
  else if (fresh.end_mode === 'until_date' && fresh.end_date && next > toDateStr(fresh.end_date)) ended = true;

  await fresh.update({
    next_billing_at: next,
    last_invoiced_at: fresh.last_invoiced_at || new Date(),
    occurrences_count: occ,
    ...(ended ? { status: 'completed', canceled_at: new Date() } : {}),
  });
  console.warn('[clientSub] 전진 자가치유 — sub', subId, 'period', billedPeriod, '→', next);
  return true;
}

async function billOneSubscription(sub, today = new Date()) {
  const client = await Client.findByPk(sub.client_id);
  if (!client) return { subscription_id: sub.id, skipped: 'client_not_found' };
  const business = await Business.findByPk(sub.business_id);
  if (!business) return { subscription_id: sub.id, skipped: 'business_not_found' };
  const creatorId = await resolveCreator(sub, business);
  if (!creatorId) return { subscription_id: sub.id, skipped: 'no_creator' };

  // 회차 자동 종료 — until_date 이고 이번 발행 예정일이 이미 종료일을 넘었으면 발행 없이 정상 만료.
  if (sub.end_mode === 'until_date' && sub.end_date && toDateStr(sub.next_billing_at) > toDateStr(sub.end_date)) {
    await sub.update({ status: 'completed', canceled_at: new Date() });
    return { subscription_id: sub.id, skipped: 'past_end_date', completed: true };
  }

  const isAuto = sub.auto_mode === 'auto';
  const fee = Number(sub.amount || 0);
  if (fee <= 0) return { subscription_id: sub.id, skipped: 'no_amount' };
  const vatRate = Number(sub.vat_rate || 0);

  const subtotal = fee;
  const taxAmount = Math.round(subtotal * (vatRate / 100));
  const grandTotal = subtotal + taxAmount;
  let invoiceNumber = await nextInvoiceNumber();
  const shareToken = crypto.randomBytes(24).toString('hex');
  const title = periodLabel(sub.plan_name, sub.next_billing_at, sub.interval);

  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + Number(sub.due_days || 14));

  const bankSnapshot = {
    bank_name: business.bank_name || null,
    account_number: business.bank_account_number || null,
    account_holder: business.bank_account_name || business.brand_name || business.name || null,
  };

  // 멱등키 — 이 구독의 이 회차는 청구서 한 장 (period = next_billing_at 기준일).
  //   여태 유일한 방어가 invoice_number UNIQUE 였는데, 아래 재시도 루프가 충돌 시 번호를 새로 뽑아
  //   다시 INSERT 해서 그 방어를 무력화했다 → 동시 실행 시 청구서 2장 발행(실증). DB UNIQUE 로 못 박는다.
  const period = toPeriodStr(sub.next_billing_at);
  if (!period) return { subscription_id: sub.id, skipped: 'invalid_next_billing_at' };
  const idemKey = `sub:${sub.id}:${period}`;
  const already = await Invoice.findOne({ where: { idempotency_key: idemKey }, attributes: ['id'] });
  if (already) {
    // 크래시로 전진이 누락된 상태면 여기서 마저 민다 (안 그러면 이 구독은 영원히 청구 정지)
    const healed = await ensureAdvancedAfterBilling(sub.id, period, today);
    return { subscription_id: sub.id, skipped: 'already_billed', invoice_id: already.id, healed };
  }

  const invoicePayload = () => ({
    business_id: sub.business_id,
    project_id: null,
    client_id: client.id,
    invoice_number: invoiceNumber,
    idempotency_key: idemKey,
    title,
    due_date: dueDate.toISOString().slice(0, 10),
    notes: '정기 구독 자동 청구',
    created_by: creatorId,
    owner_user_id: creatorId,
    installment_mode: 'single',
    bank_snapshot: bankSnapshot,
    meta: recurringMetaForSub(sub),   // #92 — 정기 발송 기준 표시용 스냅샷
    vat_rate: vatRate / 100, // ClientSubscription 은 %(10), Invoice.vat_rate 는 분수(0.1)
    currency: sub.currency || business.default_currency || 'KRW',
    subtotal,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    total_amount: subtotal,
    share_token: shareToken,
    status: isAuto ? 'sent' : 'draft',
    sent_at: isAuto ? new Date() : null,
  });
  // unique 충돌 분기 (재시도 대상은 '번호' 뿐 — 멱등키 충돌은 재시도하면 안 된다):
  //   - idempotency_key 충돌 → 다른 실행이 이 회차를 이미 발행 → 조용히 종료
  //   - invoice_number 충돌 → 번호만 재생성해 재시도
  let invoice = null;
  for (let attempt = 0; attempt < 5 && !invoice; attempt += 1) {
    try {
      invoice = await Invoice.create(invoicePayload());
    } catch (e) {
      if (e?.name !== 'SequelizeUniqueConstraintError') throw e;
      const dup = await Invoice.findOne({ where: { idempotency_key: idemKey }, attributes: ['id'] });
      if (dup) {
        const healed = await ensureAdvancedAfterBilling(sub.id, period, today);
        return { subscription_id: sub.id, skipped: 'already_billed', invoice_id: dup.id, healed };
      }
      if (attempt >= 4) throw e;
      invoiceNumber = await nextInvoiceNumber();
    }
  }
  await InvoiceItem.create({
    invoice_id: invoice.id,
    description: title,
    quantity: 1,
    unit_price: fee,
    amount: fee,
    sort_order: 0,
  });

  // 발행 후 next_billing_at 전진 (과거 누적분은 미래로 resync — 1회만 발행)
  let next = advanceDate(sub.next_billing_at, sub.interval);
  const t = todayStr(today);
  let guard = 0;
  while (next <= t && guard < 120) { next = advanceDate(next, sub.interval); guard++; }

  // 회차 자동 종료 (운영) — 이번 발행으로 누적 회차 +1 후 종료 조건 평가.
  const occ = Number(sub.occurrences_count || 0) + 1;
  let ended = false;
  if (sub.end_mode === 'after_count' && sub.max_occurrences && occ >= Number(sub.max_occurrences)) {
    ended = true;  // 목표 회차 도달
  } else if (sub.end_mode === 'until_date' && sub.end_date && next > toDateStr(sub.end_date)) {
    ended = true;  // 다음 발행일이 종료일을 넘김 → 더 이상 발행 안 함
  }
  await sub.update({
    next_billing_at: next,
    last_invoiced_at: new Date(),
    occurrences_count: occ,
    ...(ended ? { status: 'completed', canceled_at: new Date() } : {}),
  });

  // 이메일(auto) / 멤버 검토 알림(draft) — cron 차단 방지 위해 setImmediate
  if (isAuto) {
    setImmediate(async () => {
      try {
        const { sendInvoiceEmail } = require('./emailService');
        const recipient = client.tax_invoice_email || client.billing_contact_email || client.invite_email;
        if (!recipient) { console.warn('[clientSub email] sub', sub.id, 'no recipient'); return; }
        const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/public/invoices/${shareToken}`;
        let attachments = null;
        try {
          const { buildInvoicePdf } = require('./pdfBuilder');
          if (typeof buildInvoicePdf === 'function') {
            const { pdf } = await buildInvoicePdf(invoice.id);
            attachments = [{ filename: `${invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }];
          }
        } catch { /* pdf 미지원 */ }
        await sendInvoiceEmail({
          to: recipient, invoiceNumber, title, total: grandTotal, currency: invoice.currency,
          dueDate: invoice.due_date, senderName: business.brand_name || business.name || '',
          workspaceName: business.brand_name || business.name || '',
          message: '정기 구독 자동 청구 메일입니다. 결제 안내는 첨부된 청구서를 참고해주세요.',
          shareUrl, attachments,
          fromName: business.mail_from_name || business.brand_name || business.name || null,
          replyTo: business.mail_reply_to || null,
        });
      } catch (e) { console.warn('[clientSub email async] sub', sub.id, e.message); }
    });
  } else {
    setImmediate(async () => {
      try {
        const members = await BusinessMember.findAll({
          where: { business_id: sub.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
          attributes: ['user_id'],
        });
        const { notifyMany } = require('../routes/notifications');
        await notifyMany({
          userIds: members.map((m) => m.user_id), businessId: sub.business_id, eventKind: 'invoice',
          title: '정기 구독 청구서 검토 요청',
          body: `${title} 초안이 생성되었습니다. 검토 후 발송해주세요.`,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
          ctaLabel: '검토하기', workspaceName: business.brand_name || business.name || null,
        });
      } catch (e) { console.warn('[clientSub notify async] sub', sub.id, e.message); }
    });
  }

  return { subscription_id: sub.id, invoice_id: invoice.id, mode: sub.auto_mode, next_billing_at: next };
}

// Cron 진입점 — next_billing_at 도달한 active 구독 모두 처리
async function runClientSubscriptionBilling(today = new Date()) {
  const due = await ClientSubscription.findAll({
    where: { status: 'active', next_billing_at: { [Op.lte]: todayStr(today) } },
  });
  const results = [];
  for (const sub of due) {
    try { results.push(await billOneSubscription(sub, today)); }
    catch (e) { console.warn('[clientSubscriptionBilling] sub', sub.id, e.message); results.push({ subscription_id: sub.id, error: e.message }); }
  }
  // skip 결과도 invoice_id 를 담으므로 그것만 세면 "이미 발행됨" 을 신규 발행으로 오집계한다.
  // 로그가 거짓말하면 다음 사고를 못 본다 → 신규 발행만 billed 로 센다.
  const billed = results.filter((r) => r.invoice_id && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  if (due.length) console.log(`[clientSubscriptionBilling] ${due.length} due, ${billed} invoiced, ${skipped} skipped`);
  return { due: due.length, billed, skipped, results };
}

module.exports = { runClientSubscriptionBilling, billOneSubscription, advanceDate };
