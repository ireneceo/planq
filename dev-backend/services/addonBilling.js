// Add-on 결제 흐름 — 신청 → 일할 청구서 발행 → 한도 즉시 적용 → mark-paid → 해지
// 2026-05-05 도입. 자체결제(계좌이체) 정책 1순위.
//
// 흐름:
//   1. requestAddon — 사용자가 add-on 신청
//      a) 다음 청구 주기까지 남은 일수 / 30일 비율로 일할 계산
//      b) Payment(kind='addon', subscription_id=NULL, addon_code, addon_quantity, status='pending') 생성
//      c) Business.addon_X += quantity 즉시 적용 (한도 늘어남)
//      d) 입금 안내 메일 발송
//   2. markAddonPaid — owner 가 입금 후 mark-paid 클릭. Payment paid 처리.
//   3. cancelAddon — 사용자 해지 클릭 시 Business.addon_X -= quantity (다음 결제부터 빠짐, 환불 X)
//
// 정기 갱신은 다음 사이클 (plan 정기 결제 cron 에 active add-on 합산) — 본 사이클은 일회성 청구만.

const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Business, Payment, Subscription, BusinessMember, User, AuditLog } = require('../models');
const { ADDONS, getAddon } = require('../config/plans');
const planEngine = require('./plan');
const emailService = require('./emailService');

const DAYS_PER_PERIOD = 30;  // 월 결제 기준

function nextBillingDate(biz) {
  // trial 중이면 trial_ends_at, plan active 면 plan_expires_at, 그 외엔 +30일
  if (biz.subscription_status === 'trialing' && biz.trial_ends_at) return new Date(biz.trial_ends_at);
  if (biz.plan_expires_at) return new Date(biz.plan_expires_at);
  return new Date(Date.now() + DAYS_PER_PERIOD * 86400 * 1000);
}

function daysBetween(from, to) {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(1, Math.ceil(ms / 86400000));
}

function prorateAmount(unitPriceKRW, quantity, daysRemaining) {
  const days = Math.min(Math.max(daysRemaining, 1), DAYS_PER_PERIOD);
  const proportion = days / DAYS_PER_PERIOD;
  const amount = unitPriceKRW * quantity * proportion;
  return Math.round(amount);  // 원단위 반올림
}

// 사용자가 add-on 신청 — 일할 청구서 발행 + 한도 즉시 적용
async function requestAddon({ businessId, addonCode, quantity = 1, userId, taxInvoice = null }) {
  const addon = getAddon(addonCode);
  if (!addon) throw new Error('invalid_addon_code');
  const qty = Math.max(1, Math.min(100, Number(quantity) || 1));

  const biz = await Business.findByPk(businessId);
  if (!biz) throw new Error('business_not_found');
  if (!addon.available_in.includes(biz.plan)) throw new Error('addon_not_available_for_plan');

  const unitPrice = addon.price_monthly?.KRW || 0;
  const fullAmount = unitPrice * qty;
  const nextBill = nextBillingDate(biz);
  const daysRemain = daysBetween(new Date(), nextBill);
  const proratedAmount = prorateAmount(unitPrice, qty, daysRemain);

  const t = await sequelize.transaction();
  try {
    // 1. Payment 생성 (standalone, subscription_id NULL)
    const pay = await Payment.create({
      business_id: businessId,
      subscription_id: null,
      kind: 'addon',
      addon_code: addon.code,
      addon_quantity: qty,
      method: 'bank_transfer',
      status: 'pending',
      amount: proratedAmount,
      currency: 'KRW',
      cycle: 'monthly',
      period_start: new Date(),
      period_end: nextBill,
      created_by: userId || null,
      tax_invoice_requested: !!(taxInvoice && taxInvoice.biz_no),
      tax_invoice_data: (taxInvoice && taxInvoice.biz_no) ? {
        biz_no: String(taxInvoice.biz_no || '').slice(0, 20),
        biz_name: String(taxInvoice.biz_name || '').slice(0, 200),
        ceo_name: String(taxInvoice.ceo_name || '').slice(0, 80),
        address: String(taxInvoice.address || '').slice(0, 500),
        email: String(taxInvoice.email || '').slice(0, 200),
      } : null,
      tax_invoice_status: (taxInvoice && taxInvoice.biz_no) ? 'requested' : 'none',
    }, { transaction: t });

    // 2. Business.addon_X += quantity (즉시 효력 — 사용자 결정 A 모델)
    const totalUnitsAdded = addon.unit * qty;
    const currentField = Number(biz[addon.field] || 0);
    await biz.update({
      [addon.field]: currentField + totalUnitsAdded,
    }, { transaction: t });

    // 3. AuditLog
    await AuditLog.create({
      user_id: userId || null,
      business_id: businessId,
      action: 'addon_request_created',
      target_type: 'payment',
      target_id: pay.id,
      new_value: {
        addon_code: addon.code,
        addon_field: addon.field,
        quantity: qty,
        unit: addon.unit,
        unit_price_krw: unitPrice,
        full_amount_krw: fullAmount,
        prorated_amount_krw: proratedAmount,
        days_remaining: daysRemain,
        next_billing_at: nextBill.toISOString(),
      },
    }, { transaction: t });

    await t.commit();
    try { planEngine.invalidateBusinessCache(businessId); } catch { /* noop */ }

    // 4. 입금 안내 메일 (best-effort)
    safeSendInstructionEmail({ biz, payment: pay, addon, quantity: qty, daysRemain }).catch(() => null);

    return { payment: pay, prorated_amount: proratedAmount, full_amount: fullAmount, days_remaining: daysRemain, next_billing_at: nextBill };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

// 사용자(owner) 가 입금 완료 → Payment paid 처리. 한도는 이미 적용돼 있음.
async function markAddonPaid({ paymentId, markedByUserId, payerName, payerMemo, taxInvoice }) {
  const t = await sequelize.transaction();
  try {
    const pay = await Payment.findByPk(paymentId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!pay) throw new Error('payment_not_found');
    if (pay.kind !== 'addon') throw new Error('not_addon_payment');
    if (pay.status === 'paid') { await t.rollback(); return { payment: pay, alreadyPaid: true }; }
    if (pay.status !== 'pending') throw new Error('invalid_state');

    const now = new Date();
    const taxFields = (taxInvoice && taxInvoice.biz_no) ? {
      tax_invoice_requested: true,
      tax_invoice_data: {
        biz_no: String(taxInvoice.biz_no || '').slice(0, 20),
        biz_name: String(taxInvoice.biz_name || '').slice(0, 200),
        ceo_name: String(taxInvoice.ceo_name || '').slice(0, 80),
        address: String(taxInvoice.address || '').slice(0, 500),
        email: String(taxInvoice.email || '').slice(0, 200),
      },
      tax_invoice_status: 'requested',
    } : {};
    await pay.update({
      status: 'paid',
      paid_at: now,
      marked_by: markedByUserId || null,
      marked_at: now,
      payer_name: payerName ? String(payerName).slice(0, 80) : pay.payer_name,
      payer_memo: payerMemo ? String(payerMemo).slice(0, 255) : pay.payer_memo,
      ...taxFields,
    }, { transaction: t });

    await AuditLog.create({
      user_id: markedByUserId || null,
      business_id: pay.business_id,
      action: 'addon_payment_paid',
      target_type: 'payment',
      target_id: pay.id,
      new_value: {
        addon_code: pay.addon_code,
        addon_quantity: pay.addon_quantity,
        amount_krw: Number(pay.amount),
      },
    }, { transaction: t });

    await t.commit();

    // 플랫폼 관리자 알림 — addon 결제 입금 확인
    setImmediate(() => {
      const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
      const addon = getAddon(pay.addon_code);
      const addonName = addon?.name_ko || pay.addon_code;
      notifyPlatformAdmins({
        eventKind: 'payment',
        title: `Add-on 결제 입금 확인 — ${addonName}${pay.addon_quantity > 1 ? ` × ${pay.addon_quantity}` : ''} (${Number(pay.amount).toLocaleString()}원)`,
        body: `결제 #${pay.id} (Add-on) mark-paid. 워크스페이스 ID ${pay.business_id}.`,
        link: `${APP_URL}/admin/payments?id=${pay.id}`,
        ctaLabel: '결제 보기',
        relatedEntityId: pay.id,
      }).catch(() => null);
    });
    return { payment: pay };
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
}

// 사용자가 add-on 해지 — 한도 즉시 차감. 환불 X (이미 결제한 부분은 그대로).
async function cancelAddon({ businessId, addonCode, quantity, userId }) {
  const addon = getAddon(addonCode);
  if (!addon) throw new Error('invalid_addon_code');
  const biz = await Business.findByPk(businessId);
  if (!biz) throw new Error('business_not_found');
  const unitsRemoved = addon.unit * Math.max(1, Number(quantity) || 1);
  const current = Number(biz[addon.field] || 0);
  const next = Math.max(0, current - unitsRemoved);
  await biz.update({ [addon.field]: next });
  try { planEngine.invalidateBusinessCache(businessId); } catch { /* noop */ }

  await AuditLog.create({
    user_id: userId || null,
    business_id: businessId,
    action: 'addon_canceled',
    target_type: 'business',
    target_id: businessId,
    old_value: { [addon.field]: current },
    new_value: { [addon.field]: next, addon_code: addon.code, units_removed: unitsRemoved },
  }).catch(() => null);

  return { addon_field: addon.field, previous: current, current: next, removed: unitsRemoved };
}

async function safeSendInstructionEmail({ biz, payment, addon, quantity, daysRemain }) {
  try {
    const owners = await BusinessMember.findAll({
      where: { business_id: biz.id, role: 'owner', removed_at: null },
      include: [{ model: User, as: 'user', attributes: ['email', 'name'] }],
    });
    const wsName = biz.brand_name || biz.name;
    for (const m of owners) {
      if (m.user?.email) {
        await emailService.sendBillingInstructionEmail({
          to: m.user.email,
          kind: 'addon',
          workspaceName: wsName,
          itemName: addon.name_ko || addon.name,
          quantity,
          daysRemain,
          amount: Number(payment.amount),
          currency: 'KRW',
          paymentId: payment.id,
          businessId: biz.id,
        }).catch(() => null);
      }
    }
  } catch (e) {
    console.warn('[addonBilling] email failed', e.message);
  }
}

module.exports = {
  requestAddon,
  markAddonPaid,
  cancelAddon,
  prorateAmount,
  nextBillingDate,
};
