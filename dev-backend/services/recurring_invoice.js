// 정기청구 자동 발행 서비스 — daily cron 으로 호출.
//
// 흐름:
//   1) Project 가 active && billing_type='subscription' && auto_invoice_enabled=true && monthly_fee > 0
//   2) 오늘이 invoice_billing_day (또는 마지막 1~3일 동안 누락된 경우 catch-up)
//   3) 같은 달에 이미 자동 발행된 적 없으면 (last_auto_invoice_at YYYY-MM 다름)
//   4) mode='auto'         → invoice + 이메일 자동 발송
//      mode='draft_review' → draft invoice + 워크스페이스 owner/member notify
//   5) last_auto_invoice_at = NOW
//
// 멱등: 같은 날 여러 번 호출돼도 안전 (last_auto_invoice_at 검사로 중복 방지)
// 안전: 한 프로젝트 실패해도 나머지는 계속 진행 (try/catch per project)

const { Op } = require('sequelize');
const crypto = require('crypto');
const { Project, Business, Client, Invoice, InvoiceItem, User, BusinessMember } = require('../models');
const { sequelize } = require('../config/database');
const { recurringMetaForProject } = require('./invoiceRecurring');

// invoice_number 생성 — 동시성 고려 (같은 트랜잭션 / 락 미적용. cron 단일 실행이라 충분)
// 운영 — robust: INV-YYYY- prefix 전체에서 실제 최대 순번 스캔 (깨진 번호 skip).
//   기존 "last by id" 는 같은 날 다건 발행/비표준 번호에서 NaN·중복 → 2번째부터 발행 실패
//   (memory recurring_billing_latent_bugs). clientSubscriptionBilling 과 동일 fix.
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

// 오늘이 billing_day 인지 (월 말일 보정 — 31 설정인데 그달은 30일 → 30일에 발행)
function isBillingDayToday(billingDay, today = new Date()) {
  const todayDate = today.getDate();
  if (billingDay >= 1 && billingDay <= 28) return todayDate === billingDay;
  // 29-31 의 경우: 그 달 마지막 날에 발행
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return todayDate === Math.min(billingDay, lastDayOfMonth);
}

// 같은 달에 이미 자동 발행된 적 있는가?
function alreadyBilledThisMonth(lastAt, today = new Date()) {
  if (!lastAt) return false;
  const last = new Date(lastAt);
  return last.getFullYear() === today.getFullYear() && last.getMonth() === today.getMonth();
}

// 단일 프로젝트 처리 — 결과 반환
async function billOneProject(project, today = new Date()) {
  if (project.last_auto_invoice_at && alreadyBilledThisMonth(project.last_auto_invoice_at, today)) {
    return { project_id: project.id, skipped: 'already_billed_this_month' };
  }
  const fee = Number(project.monthly_fee || 0);
  if (fee <= 0) return { project_id: project.id, skipped: 'no_monthly_fee' };

  // 청구 대상 client — 프로젝트 소속 첫 번째 client
  const { ProjectClient } = require('../models');
  const projClient = await ProjectClient.findOne({
    where: { project_id: project.id },
    attributes: ['client_id'],
  });
  if (!projClient?.client_id) {
    return { project_id: project.id, skipped: 'no_client' };
  }

  const client = await Client.findByPk(projClient.client_id);
  if (!client) return { project_id: project.id, skipped: 'client_not_found' };

  const business = await Business.findByPk(project.business_id);
  if (!business) return { project_id: project.id, skipped: 'business_not_found' };

  // Invoice.created_by(notNull) — 청구담당 > owner 멤버 (cron 은 user context 없음)
  let creatorId = business.default_billing_owner_id || null;
  if (!creatorId) {
    const owner = await BusinessMember.findOne({ where: { business_id: business.id, role: 'owner', removed_at: null }, attributes: ['user_id'] });
    creatorId = owner?.user_id || null;
  }
  if (!creatorId) return { project_id: project.id, skipped: 'no_creator' };

  const ym = today.toISOString().slice(0, 7); // YYYY-MM
  const dueDate = new Date(today);
  dueDate.setDate(today.getDate() + (business.default_due_days || 14));

  const isAuto = project.auto_invoice_mode === 'auto';

  const invoiceNumber = await nextInvoiceNumber();
  const subtotal = fee;
  const vatRate = Number(business.default_vat_rate || 0.1);
  const taxAmount = Math.round(subtotal * vatRate);
  const grandTotal = subtotal + taxAmount;

  const shareToken = crypto.randomBytes(24).toString('hex');

  const bankSnapshot = {
    bank_name: business.bank_name || null,
    account_number: business.bank_account_number || null,
    account_holder: business.bank_account_name || business.brand_name || business.name || null,
  };

  const invoice = await Invoice.create({
    business_id: project.business_id,
    project_id: project.id,
    client_id: client.id,
    invoice_number: invoiceNumber,
    title: `${project.name} ${ym} 월 사용료`,
    due_date: dueDate.toISOString().slice(0, 10),
    notes: '정기 자동 청구 (월정액)',
    created_by: creatorId,
    owner_user_id: creatorId,
    installment_mode: 'single',
    bank_snapshot: bankSnapshot,
    meta: recurringMetaForProject(project),   // #92 — 정기 발송 기준 표시용 스냅샷
    vat_rate: vatRate,
    currency: business.default_currency || 'KRW',
    subtotal,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    total_amount: subtotal,
    share_token: shareToken,
    // mode=auto 면 즉시 sent, draft_review 면 draft
    status: isAuto ? 'sent' : 'draft',
    sent_at: isAuto ? new Date() : null,
  });

  await InvoiceItem.create({
    invoice_id: invoice.id,
    description: `${project.name} ${ym} 월 사용료`,
    quantity: 1,
    unit_price: fee,
    amount: fee,
    sort_order: 0,
  });

  // 자동 발행/검토 알림 — 메인 cron 흐름 차단 방지 위해 fan-out 은 setImmediate.
  // 결과 추적은 EmailLog (best-effort recordLog) 와 console.warn 으로. cron 응답 시간이
  // SMTP/알림 처리 시간과 무관해야 다음 프로젝트 청구가 안 막힘.
  const emailResult = isAuto ? 'queued' : 'draft_notified';
  if (isAuto) {
    setImmediate(async () => {
      try {
        const { sendInvoiceEmail } = require('./emailService');
        const recipient = client.tax_invoice_email || client.billing_contact_email || client.invite_email;
        if (!recipient) {
          console.warn('[recurring_invoice email] proj', project.id, 'no recipient');
          return;
        }
        const shareUrl = `${process.env.APP_URL || 'https://dev.planq.kr'}/invoice/${shareToken}`;
        let attachments = null;
        try {
          const { buildInvoicePdf } = require('./pdfBuilder');
          if (typeof buildInvoicePdf === 'function') {
            const { pdf } = await buildInvoicePdf(invoice.id);
            attachments = [{ filename: `${invoiceNumber}.pdf`, content: pdf, contentType: 'application/pdf' }];
          }
        } catch { /* pdf 미지원 — 이메일만 */ }
        await sendInvoiceEmail({
          to: recipient,
          invoiceNumber,
          title: invoice.title,
          total: grandTotal,
          currency: invoice.currency,
          dueDate: invoice.due_date,
          senderName: business.brand_name || business.name || '',
          workspaceName: business.brand_name || business.name || '',
          message: '정기 자동 청구 메일입니다. 결제 안내는 본 메일에 첨부된 청구서를 참고해주세요.',
          shareUrl,
          attachments,
          fromName: business.mail_from_name || business.brand_name || business.name || null,
          replyTo: business.mail_reply_to || null,
        });
      } catch (e) {
        console.warn('[recurring_invoice email async] proj', project.id, e.message);
      }
    });
  } else {
    setImmediate(async () => {
      try {
        const members = await BusinessMember.findAll({
          where: { business_id: project.business_id, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
          attributes: ['user_id'],
        });
        const userIds = members.map((m) => m.user_id);
        const { notifyMany } = require('../routes/notifications');
        await notifyMany({
          userIds,
          businessId: project.business_id,
          eventKind: 'invoice',
          title: '정기 청구서 검토 요청',
          body: `${project.name} ${ym} 월 사용료 초안이 생성되었습니다. 검토 후 발송해주세요.`,
          link: `${process.env.APP_URL || 'https://dev.planq.kr'}/bills?tab=invoices&invoice=${invoice.id}`,
          ctaLabel: '검토하기',
          workspaceName: business.brand_name || business.name || null,
        });
      } catch (e) {
        console.warn('[recurring_invoice notify async] proj', project.id, e.message);
      }
    });
  }

  await project.update({ last_auto_invoice_at: new Date() });

  return {
    project_id: project.id,
    invoice_id: invoice.id,
    mode: project.auto_invoice_mode,
    email_sent: emailResult,
  };
}

// Cron 진입점 — 모든 적격 프로젝트 처리
async function runDailyRecurringBilling(today = new Date()) {
  // billing_day 후보 — 오늘 일자 OR 월 말일 (29~31 처리용)
  const todayDate = today.getDate();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const eligibleDays = [todayDate];
  if (todayDate === lastDayOfMonth) {
    // 마지막 날엔 29-31 설정 모두 발행
    for (let d = lastDayOfMonth; d <= 31; d++) eligibleDays.push(d);
  }

  const projects = await Project.findAll({
    where: {
      status: 'active',
      billing_type: 'subscription',
      auto_invoice_enabled: true,
      paused_at: null,
      monthly_fee: { [Op.gt]: 0 },
      invoice_billing_day: { [Op.in]: eligibleDays },
    },
  });

  const out = { ok: 0, skip: 0, fail: 0, results: [] };
  for (const p of projects) {
    try {
      const r = await billOneProject(p, today);
      if (r.invoice_id) out.ok += 1;
      else out.skip += 1;
      out.results.push(r);
    } catch (e) {
      console.warn('[recurring_invoice] project', p.id, 'crash', e.message);
      out.fail += 1;
      out.results.push({ project_id: p.id, error: e.message });
    }
  }
  return out;
}

module.exports = {
  runDailyRecurringBilling,
  billOneProject,
  isBillingDayToday,
  alreadyBilledThisMonth,
};
