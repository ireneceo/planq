// Add-on 결제 흐름 — 신청 → 일할 청구서 발행 → 한도 즉시 적용 → mark-paid → 해지
// 2026-05-05 도입. 자체결제(계좌이체) 정책 1순위.
//
// 흐름:
//   1. requestAddon — 사용자가 add-on 신청 (2026-11-15 Fable 설계 R5 — 아래 함수 주석)
//      a) Business.addon_X += quantity 즉시 적용 (한도 늘어남)
//      b) 지금 유료 기간이 돌면 남은 일수 일할 Payment(kind='addon') + 입금 안내 메일
//      c) 미결제 플랜 청구가 있으면 그 금액에 애드온을 더한다(pendingPlanSync) — 체험·유예는 b 없음
//   2. markAddonPaid — owner 가 입금 후 mark-paid 클릭. Payment paid 처리.
//   3. cancelAddon — 사용자 해지 클릭 시 Business.addon_X -= quantity (다음 결제부터 빠짐, 환불 X)
//
// 정기 갱신 — 신청 사이클은 위 일할 청구 한 번. 다음 사이클부터는 플랜 갱신 청구(billing.ensureRenewalPayment)에
//   Business.addon_* 현재값이 합산된다(renewalAddonLines → payments.line_items, FIX_0AB A-④). 해지하면 즉시 0 이므로
//   «다음 결제부터 빠짐» 이 성립한다. 연간은 월단가 ×12(할인 없음).

const { Op } = require('sequelize');
const { writeAudit } = require('./auditService');
const { sequelize } = require('../config/database');
const { Business, Payment, Subscription, BusinessMember, User, AuditLog } = require('../models');
const { ADDONS, getAddon } = require('../config/plans');
const planEngine = require('./plan');
const emailService = require('./emailService');

const DAYS_PER_PERIOD = 30;  // 월 결제 기준
const { roundMoney } = require('./money');

// 갱신 청구에 실을 애드온 줄들 — Business.addon_* 현재값 기준(해지하면 즉시 0 이므로 «다음 결제부터 빠짐» 이 성립)
//   수량 = ceil(필드값 / unit) — 관리자 수기로 unit 배수가 아닌 값이면 올림.
function renewalAddonLines(biz, cycle, currency = 'KRW') {
  const mult = cycle === 'yearly' ? 12 : 1;
  return Object.values(ADDONS).filter((a) => Number((biz && biz[a.field]) || 0) > 0).map((a) => {
    const qty = Math.ceil(Number(biz[a.field]) / a.unit);
    const unit = (a.price_monthly && a.price_monthly[currency]) ?? 0;
    return {
      kind: 'addon', code: a.code, label: a.name_ko || a.name,
      quantity: qty, unit_price: unit, months: mult,
      amount: roundMoney(unit * qty * mult, currency),
    };
  }).filter((l) => l.amount > 0);
}

// 지금 돌고 있는 유료 기간 — 일할 청구(A)의 근거. 체험·past_due·유예·잠금이면 null (Fable R5-A).
//   체험 중 선결제자는 current_period_start = 체험 끝이라 max(지금, 시작) 으로 체험일이 빠진다.
async function runningPaidPeriod(businessId, t, now = new Date()) {
  const sub = await Subscription.findOne({
    where: { business_id: businessId, status: 'active', current_period_end: { [Op.gt]: now } },
    order: [['current_period_end', 'DESC']], transaction: t,
  });
  if (!sub) return null;
  const start = sub.current_period_start && new Date(sub.current_period_start) > now ? new Date(sub.current_period_start) : now;
  const days = Math.ceil((new Date(sub.current_period_end).getTime() - start.getTime()) / 86400000);
  if (days <= 0) return null;
  return { sub, start, end: new Date(sub.current_period_end), days };
}

// 일할 금액 — 상한은 월간 1개월치 · 연간 12개월치(옛 30일 상한은 연간 구독자에게 1개월치만 받았다).
function prorateFor(unitPrice, qty, days, cycle, currency) {
  const cap = cycle === 'yearly' ? 12 : 1;
  return roundMoney(unitPrice * qty * Math.min(days / DAYS_PER_PERIOD, cap), currency);
}

// 사용자가 add-on 신청 — 한도 즉시 적용 + 청구(2026-11-15 Fable 설계 R5):
//   A. 지금 유료 기간이 돌고 있으면 남은 기간 일할 결제(별도 kind='addon')
//   B. 다음 기간분 — 미결제 플랜 청구가 있으면 그 금액에 더한다(pendingPlanSync). 없으면 다음 청구가 포함한다.
//      그 청구가 이미 얼었고(입금 통보·Stripe) A 도 없으면 한 기간 전액을 별도 결제로.
//   체험 중에는 무료(체험일 일할 폐지 — R6), 첫 결제부터 전액 포함.
async function requestAddon({ businessId, addonCode, quantity = 1, userId, taxInvoice = null }) {
  // ★ 결제 면제 워크스페이스는 애드온 청구도 만들지 않는다 (운영 #275).
  //   게이트는 라우트가 아니라 서비스에 둔다 — pending Payment 를 만드는 3경로 중 하나다
  //   (Fable 재심 M-B). 면제 워크스페이스 한도 부여는 admin 전용 apply 경로로만.
  if (await require('./billing').isBillingExempt(businessId)) {
    const e = new Error('billing_exempt'); e.code = 'billing_exempt'; throw e;
  }

  const addon = getAddon(addonCode);
  if (!addon) throw new Error('invalid_addon_code');
  const qty = Math.max(1, Math.min(100, Number(quantity) || 1));
  const sync = require('./pendingPlanSync');
  await sync.releaseStripeSession(businessId);   // 트랜잭션 전에 — 열린 카드 결제창을 닫아야 금액을 바꿀 수 있다

  const t = await sequelize.transaction();
  let syncResult = null;
  let pay = null;
  let biz = null;
  try {
    // 잠금 순서: 미결제 플랜 청구 → biz (markPaymentPaid 와 같다)
    const pendingPay = await sync.lockPayablePending(businessId, t);
    biz = await Business.findByPk(businessId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!biz) throw new Error('business_not_found');
    if (!addon.available_in.includes(biz.plan)) throw new Error('addon_not_available_for_plan');

    const now = new Date();
    const running = await runningPaidPeriod(businessId, t, now);
    const currency = (running && running.sub.currency) || (pendingPay && pendingPay.currency) || 'KRW';
    const cycle = (running && running.sub.cycle) || (pendingPay && pendingPay.cycle) || 'monthly';
    const unitPrice = (addon.price_monthly && addon.price_monthly[currency]) ?? 0;
    const periodMult = cycle === 'yearly' ? 12 : 1;
    const nextPeriodAmount = roundMoney(unitPrice * qty * periodMult, currency);

    // 1. 한도 즉시 적용(사용자 결정 A 모델)
    const totalUnitsAdded = addon.unit * qty;
    await biz.update({ [addon.field]: Number(biz[addon.field] || 0) + totalUnitsAdded }, { transaction: t });

    // 2. B — 다음 기간분을 미결제 플랜 청구에 접는다
    if (pendingPay) syncResult = await sync.syncPendingPlanAmount(businessId, { transaction: t, payment: pendingPay, userId });
    const frozen = !!(syncResult && syncResult.frozen);

    // 3. A — 돌고 있는 유료 기간 일할 / 얼었고 A 없음 → 한 기간 전액 별도
    let mode;
    let chargeAmount = 0;
    let periodStart = null;
    let periodEnd = null;
    let daysRemain = null;
    if (running) {
      mode = 'prorated';
      daysRemain = running.days;
      chargeAmount = prorateFor(unitPrice, qty, running.days, running.sub.cycle, currency);
      periodStart = running.start; periodEnd = running.end;
    } else if (frozen) {
      mode = 'separate';
      chargeAmount = nextPeriodAmount;
      const billing = require('./billing');
      const psub = await Subscription.findByPk(pendingPay.subscription_id, { transaction: t });
      const pv = psub ? billing.previewPeriod({ sub: psub, biz, now }) : null;
      periodStart = pv ? pv.period_start : now; periodEnd = pv ? pv.period_end : null;
    } else if (syncResult && syncResult.payment) {
      mode = 'folded';
    } else {
      mode = 'next_bill';
    }

    if (chargeAmount > 0) {
      pay = await Payment.create({
        business_id: businessId,
        subscription_id: null,
        kind: 'addon',
        addon_code: addon.code,
        addon_quantity: qty,
        method: 'bank_transfer',
        status: 'pending',
        amount: chargeAmount,
        currency,
        cycle,
        period_start: periodStart,
        period_end: periodEnd,
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
    }

    await writeAudit({
      user_id: userId || null,
      business_id: businessId,
      action: 'addon_request_created',
      target_type: pay ? 'payment' : 'business',
      target_id: pay ? pay.id : businessId,
      new_value: {
        addon_code: addon.code, addon_field: addon.field, quantity: qty, unit: addon.unit,
        unit_price: unitPrice, currency, mode,
        charge_amount: chargeAmount, days_remaining: daysRemain,
        next_period_addon_amount: nextPeriodAmount,
        pending_payment_id: syncResult && syncResult.payment ? syncResult.payment.id : null,
        pending_total: syncResult && syncResult.payment ? Number(syncResult.payment.amount) : null,
      },
    }, { transaction: t });

    await t.commit();
    try { planEngine.invalidateBusinessCache(businessId); } catch { /* noop */ }

    if (pay) safeSendInstructionEmail({ biz, payment: pay, addon, quantity: qty, daysRemain, currency }).catch(() => null);
    sync.notifyIfChanged(syncResult);

    return {
      mode,
      payment: pay,
      currency,
      prorated_amount: mode === 'prorated' ? chargeAmount : 0,
      charge_amount: chargeAmount,
      days_remaining: daysRemain,
      next_period_addon_amount: nextPeriodAmount,
      pending_total: syncResult && syncResult.payment ? Number(syncResult.payment.amount) : null,
      pending_frozen: frozen,
      quantity: qty,
    };
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
    // ★ 매출 계상 여부를 결제 확정 시점에 박제 — markPaymentPaid 와 동일 규칙 (운영 #275).
    //   여기가 status:'paid' 를 쓰는 두 번째(그리고 마지막) 지점이다 (Fable 설계 게이트 C1).
    const isRevenue = !(await require('./billing').isBillingExempt(pay.business_id));

    await pay.update({
      status: 'paid',
      paid_at: now,
      marked_by: markedByUserId || null,
      marked_at: now,
      payer_name: payerName ? String(payerName).slice(0, 80) : pay.payer_name,
      payer_memo: payerMemo ? String(payerMemo).slice(0, 255) : pay.payer_memo,
      is_revenue: isRevenue,
      ...taxFields,
    }, { transaction: t });

    await writeAudit({
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
// 애드온 한도 회수 — 해지(cancelAddon)와 환불(refund.refundPayment, docs/REFUND_CANCEL_DESIGN.md §5-1)이 같은 산식을 쓴다.
//   0 아래로 내려가지 않는다. t 가 있으면 그 트랜잭션 안에서(biz 는 호출부가 잡아 넘긴다).
async function revokeUnitsInTx({ biz, addonCode, quantity, t }) {
  const addon = getAddon(addonCode);
  if (!addon) throw new Error('invalid_addon_code');
  const removed = addon.unit * Math.max(1, Number(quantity) || 1);
  const previous = Number(biz[addon.field] || 0);
  const current = Math.max(0, previous - removed);
  await biz.update({ [addon.field]: current }, t ? { transaction: t } : undefined);
  return { field: addon.field, previous, current, removed };
}

// 해지 — 한도 즉시 차감(환불 X) + 미결제 플랜 청구 금액을 같이 줄인다(얼었으면 그대로 · Fable R7).
async function cancelAddon({ businessId, addonCode, quantity, userId }) {
  const addon = getAddon(addonCode);
  if (!addon) throw new Error('invalid_addon_code');
  const sync = require('./pendingPlanSync');
  await sync.releaseStripeSession(businessId);
  const t = await sequelize.transaction();
  let syncResult = null;
  let r;
  try {
    const pendingPay = await sync.lockPayablePending(businessId, t);
    const biz = await Business.findByPk(businessId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!biz) throw new Error('business_not_found');
    r = await revokeUnitsInTx({ biz, addonCode, quantity, t });
    if (pendingPay) syncResult = await sync.syncPendingPlanAmount(businessId, { transaction: t, payment: pendingPay, userId });
    await writeAudit({
      user_id: userId || null,
      business_id: businessId,
      action: 'addon_canceled',
      target_type: 'business',
      target_id: businessId,
      old_value: { [addon.field]: r.previous },
      new_value: {
        [addon.field]: r.current, addon_code: addon.code, units_removed: r.removed,
        pending_total: syncResult && syncResult.payment ? Number(syncResult.payment.amount) : null,
        pending_frozen: !!(syncResult && syncResult.frozen),
      },
    }, { transaction: t });
    await t.commit();
  } catch (err) {
    if (!t.finished) await t.rollback();
    throw err;
  }
  try { planEngine.invalidateBusinessCache(businessId); } catch { /* noop */ }
  sync.notifyIfChanged(syncResult);
  return {
    addon_field: r.field, previous: r.previous, current: r.current, removed: r.removed,
    pending_total: syncResult && syncResult.payment ? Number(syncResult.payment.amount) : null,
    frozen: !!(syncResult && syncResult.frozen),
  };
}

async function safeSendInstructionEmail({ biz, payment, addon, quantity, daysRemain, currency = 'KRW' }) {
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
          currency,
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
  revokeUnitsInTx,
  requestAddon,
  markAddonPaid,
  cancelAddon,
  prorateFor,
  runningPaidPeriod,
  renewalAddonLines,
};
