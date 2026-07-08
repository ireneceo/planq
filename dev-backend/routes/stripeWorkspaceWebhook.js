// routes/stripeWorkspaceWebhook.js — Q Bill 워크스페이스 카드결제 webhook (merchant='workspace').
//   각 워크스페이스가 자기 Stripe 대시보드에 이 endpoint(/api/stripe/webhook/ws/:businessId)를 등록.
//   자기 Business.stripe_webhook_secret 으로 서명검증 → 회차 결제 확정(markInstallmentPaid 멱등 착지).
//   ⚠️ raw body 필요 — server.js 에서 express.json() 前에 express.raw 로 마운트.
//   분리: SAAS_BILLING_VS_QBILL_SEPARATION.md — invoices/installments(Business 수취), 구독 payments 와 무관.
const express = require('express');
const router = express.Router({ mergeParams: true }); // :businessId 접근
const { getStripeForMerchant, getStripeKeysForMerchant } = require('../services/stripeService');
const { markInstallmentPaid, markInvoicePaid } = require('../services/invoicePayments');

router.post('/', async (req, res) => {
  const businessId = Number(req.params.businessId);
  if (!businessId) return res.status(400).send('bad business id');

  const sig = req.headers['stripe-signature'];
  let stripe, webhookSecret;
  try {
    stripe = await getStripeForMerchant('workspace', businessId);
    ({ webhookSecret } = await getStripeKeysForMerchant('workspace', businessId));
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
      const kind = obj.metadata?.kind;
      const metaBiz = Number(obj.metadata?.business_id || 0);
      const invoiceId = Number(obj.metadata?.invoice_id || 0);
      const installmentId = Number(obj.metadata?.installment_id || 0);
      // 멀티테넌트 격리 — metadata.business_id 가 endpoint :businessId 와 일치해야 함(교차 워크스페이스 착지 방지)
      if (kind === 'qbill_invoice' && metaBiz === businessId && invoiceId) {
        const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : (obj.id || null);
        const io = req.app.get('io') || global.__planqIo || null;
        // 멱등 단일 착지점 — 이미 paid 면 alreadyPaid(재전송/이중세션 안전). system 호출(marked_by=null).
        //   분할(installment_id 있음) → 회차 착지 / 단일 발행(없음) → invoice 착지.
        try {
          if (installmentId) {
            await markInstallmentPaid({
              businessId, invoiceId, installmentId,
              paidAt: new Date(), payerMemo: 'Stripe 카드결제',
              markedByUserId: null, method: 'stripe', pgTransactionId: pi, io,
            });
          } else {
            await markInvoicePaid({
              businessId, invoiceId,
              paidAt: new Date(),
              markedByUserId: null, method: 'stripe', pgTransactionId: pi, io,
            });
          }
        } catch (e) {
          // 영구 조건(invoice/회차 없음·취소·draft)은 재시도해도 안 바뀜 → 200 ack 로 Stripe 재전송 중단.
          //   일시 오류(DB 등)만 아래 바깥 catch 로 500 → Stripe 재시도.
          if (e.code === 'NOT_FOUND' || e.code === 'INVALID_STATE') {
            console.warn(`[stripe-ws-webhook] terminal skip biz=${businessId} inv=${invoiceId}: ${e.message}`);
          } else {
            throw e;
          }
        }
      }
    }
    // 그 외 이벤트는 무시(2xx ack — Stripe 재전송 방지)
    return res.json({ received: true });
  } catch (err) {
    console.error('[stripe-ws-webhook] handler error:', err.message);
    return res.status(500).send('handler error');
  }
});

module.exports = router;
