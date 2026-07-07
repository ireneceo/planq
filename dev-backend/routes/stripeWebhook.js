// routes/stripeWebhook.js — Stripe webhook (platform merchant = PlanQ 구독).
//   서명검증 필수 → 결제 성공 시 기존 멱등 착지점 billing.markPaymentPaid 호출(webhook 이 진실원천).
//   ⚠️ raw body 필요 — server.js 에서 express.json() 前에 express.raw 로 마운트:
//      app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));
//   POS routes/webhooks-payments.js 패턴 이식. 분리: SAAS_BILLING_VS_QBILL_SEPARATION.md (payments 만, invoices 무관)
const express = require('express');
const router = express.Router();
const { getStripeForMerchant, getStripeKeysForMerchant } = require('../services/stripeService');
const billing = require('../services/billing');
const Payment = require('../models/Payment');

router.post('/', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let stripe, webhookSecret;
  try {
    stripe = await getStripeForMerchant('platform');
    ({ webhookSecret } = await getStripeKeysForMerchant('platform'));
  } catch {
    return res.status(503).send('stripe not configured');
  }
  if (!webhookSecret) return res.status(503).send('no webhook secret');

  // 서명 검증 — req.body 는 raw Buffer 여야 함(마운트 시 express.raw)
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
      const obj = event.data.object;
      // metadata 는 session·payment_intent 양쪽에 심어둠(startPlatformSubscriptionCheckout)
      const paymentId = Number(obj.metadata?.payment_id || 0);
      const kind = obj.metadata?.kind;
      if (paymentId && kind === 'saas_subscription') {
        const pay = await Payment.findByPk(paymentId);
        if (pay && pay.status === 'pending') {
          await pay.update({
            stripe_payment_intent: typeof obj.payment_intent === 'string' ? obj.payment_intent : (obj.id || pay.stripe_payment_intent),
            stripe_customer_id: obj.customer || pay.stripe_customer_id,
          });
          // 멱등 단일 착지점 — 이미 paid 면 내부에서 alreadyPaid 반환(webhook 재전송 안전). system 호출(marked_by=null).
          await billing.markPaymentPaid({ paymentId: pay.id, markedByUserId: null, payerName: 'Stripe' });
        }
      }
    }
    // 그 외 이벤트는 무시(2xx 로 ack — Stripe 재전송 방지)
    return res.json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err.message);
    return res.status(500).send('handler error');
  }
});

module.exports = router;
