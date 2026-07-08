// services/stripeCheckoutService.js — PlanQ Stripe Hosted Checkout. POS services/stripeCheckoutService.js 이식.
//   Hosted Checkout = 카드번호가 우리 서버를 안 거침(Stripe 페이지 처리, PCI 안전). webhook 이 진실원천.
//   platform merchant = PlanQ 구독료 수취(payments/subscriptions). Q Bill(workspace)은 후속(Business stripe 컬럼 후).
//   설계: docs/UNIFIED_PAYMENT_ARCHITECTURE.md §2③, 분리: SAAS_BILLING_VS_QBILL_SEPARATION.md
const { getStripeForMerchant } = require('./stripeService');
const Payment = require('../models/Payment');

// 무소수점(zero-decimal) 통화 — Stripe unit_amount 는 최소단위. KRW/JPY 등은 ×100 하면 안 됨(POS는 MYR ×100).
const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'CLP', 'KMF', 'XOF', 'XAF', 'BIF', 'DJF', 'GNF', 'PYG', 'RWF', 'UGX', 'VUV', 'XPF']);
function toStripeAmount(amount, currency) {
  const cur = String(currency || 'KRW').toUpperCase();
  const n = Number(amount);
  return ZERO_DECIMAL.has(cur) ? Math.round(n) : Math.round(n * 100);
}

// SaaS 구독 결제 — 기존 pending Payment(createPendingSubscription 생성)를 Stripe Checkout(mode=payment)로 결제.
//   성공은 webhook 이 markPaymentPaid 로 반영(멱등 단일 착지점). 이중결제 가드: 열린 세션 재사용(POS P1-3).
async function startPlatformSubscriptionCheckout({ paymentId, successUrl, cancelUrl }) {
  const pay = await Payment.findByPk(paymentId);
  if (!pay) { const e = new Error('payment_not_found'); e.code = 'NOT_FOUND'; throw e; }
  if (pay.status !== 'pending') { const e = new Error('payment_not_pending'); e.code = 'INVALID_STATE'; throw e; }

  const stripe = await getStripeForMerchant('platform'); // secret 없으면 STRIPE_NOT_CONFIGURED

  // 이중결제 가드 — 이 Payment 에 아직 열린 세션 있으면 재사용(두 개 열면 각각 성공→중복청구 위험)
  if (pay.stripe_session_id) {
    try {
      const ex = await stripe.checkout.sessions.retrieve(pay.stripe_session_id);
      if (ex && ex.status === 'open' && ex.url) return { url: ex.url, session_id: ex.id, reused: true };
    } catch { /* 만료/무효 세션 → 새로 생성 */ }
  }

  const currency = String(pay.currency || 'KRW').toLowerCase();
  const amount = toStripeAmount(pay.amount, pay.currency);
  if (amount <= 0) { const e = new Error('amount_must_be_positive'); e.code = 'INVALID_AMOUNT'; throw e; }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency,
        product_data: { name: `PlanQ 구독 결제 #${pay.id}` },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    // metadata 는 webhook 에서 Payment 매칭 키. payment_intent 에도 심어 payment_intent.succeeded 대비.
    payment_intent_data: { metadata: { payment_id: String(pay.id), kind: 'saas_subscription', business_id: String(pay.business_id) } },
    metadata: { payment_id: String(pay.id), kind: 'saas_subscription', business_id: String(pay.business_id) },
  });

  await pay.update({ method: 'stripe', stripe_session_id: session.id });
  return { url: session.url, session_id: session.id };
}

// Q Bill 워크스페이스 인보이스 카드결제 — merchant='workspace'(Business.stripe_*). 회차(installment) 단위.
//   성공은 워크스페이스 webhook 이 markInstallmentPaid 로 반영(멱등 착지). 이중결제 가드: 열린 세션 재사용.
//   분리: SAAS_BILLING_VS_QBILL_SEPARATION.md — 여기 수취처는 Business(고객결제), payments/subscriptions 무관.
async function startWorkspaceInvoiceCheckout({ businessId, invoiceId, installmentId, amount, currency, productName, existingSessionId, successUrl, cancelUrl }) {
  const stripe = await getStripeForMerchant('workspace', businessId); // secret 없으면 STRIPE_NOT_CONFIGURED

  // 이중결제 가드 — 이 회차에 아직 열린 세션 있으면 재사용(두 세션 각각 결제되면 이중청구)
  if (existingSessionId) {
    try {
      const ex = await stripe.checkout.sessions.retrieve(existingSessionId);
      if (ex && ex.status === 'open' && ex.url) return { url: ex.url, session_id: ex.id, reused: true };
    } catch { /* 만료/무효 세션 → 새로 생성 */ }
  }

  const cur = String(currency || 'KRW').toLowerCase();
  const unit = toStripeAmount(amount, currency);
  if (unit <= 0) { const e = new Error('amount_must_be_positive'); e.code = 'INVALID_AMOUNT'; throw e; }

  // installment_id 는 분할 회차 결제에만. 단일 발행(installment 없음)은 invoice_id 만 → webhook 이 invoice-level 착지.
  const meta = { kind: 'qbill_invoice', business_id: String(businessId), invoice_id: String(invoiceId) };
  if (installmentId) meta.installment_id = String(installmentId);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: { currency: cur, product_data: { name: productName || `Invoice #${invoiceId}` }, unit_amount: unit },
      quantity: 1,
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    payment_intent_data: { metadata: meta }, // payment_intent.succeeded 대비 동일 메타
    metadata: meta,
  });
  return { url: session.url, session_id: session.id };
}

module.exports = { startPlatformSubscriptionCheckout, startWorkspaceInvoiceCheckout, toStripeAmount, ZERO_DECIMAL };
