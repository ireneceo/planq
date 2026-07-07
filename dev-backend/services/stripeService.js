// services/stripeService.js — merchant(발행자)별 Stripe 인스턴스.
//   POS utils/stripeService.js 패턴 이식(issuer→merchant). POS 는 secret 평문 JSON,
//   PlanQ 는 AES-256-GCM 복호화(더 안전).
//   merchant='platform' → PlanQ 구독료 수취(platform_settings). merchant='workspace' → Q Bill 워크스페이스 수취(Business).
//   설계: docs/UNIFIED_PAYMENT_ARCHITECTURE.md §1·§2③, 분리: SAAS_BILLING_VS_QBILL_SEPARATION.md
const Stripe = require('stripe');
const { decrypt } = require('./encryption');
const PlatformSetting = require('../models/PlatformSetting');
const Business = require('../models/Business');

function normalizeMerchant(m) {
  return m === 'platform_admin' ? 'platform' : m;
}

// 복호화 안전 래퍼 — 잘못된 blob 이어도 throw 대신 null (설정 미완으로 취급)
function safeDecrypt(enc) {
  if (!enc) return null;
  try { return decrypt(enc); } catch { return null; }
}

// merchant 별 Stripe 키 3종 반환 (secret 복호화, publishable 평문, webhookSecret 복호화)
async function getStripeKeysForMerchant(merchant, merchantId) {
  switch (normalizeMerchant(merchant)) {
    case 'platform': {
      const row = await PlatformSetting.findOne({ order: [['id', 'ASC']] });
      return {
        secret: safeDecrypt(row?.stripe_secret_enc),
        publishable: row?.stripe_publishable_key || null,
        webhookSecret: safeDecrypt(row?.stripe_webhook_secret_enc),
      };
    }
    case 'workspace': {
      // Q Bill — 워크스페이스별 Stripe. Business 에 stripe_* 컬럼 추가 후 활성(Phase Q Bill).
      const biz = await Business.findByPk(merchantId);
      if (!biz) throw new Error(`Business ${merchantId} not found`);
      return {
        secret: safeDecrypt(biz.stripe_secret_enc),
        publishable: biz.stripe_publishable_key || null,
        webhookSecret: safeDecrypt(biz.stripe_webhook_secret_enc),
      };
    }
    default:
      throw new Error(`Unknown merchant: ${merchant}`);
  }
}

// Stripe SDK 인스턴스 — secret 없으면 STRIPE_NOT_CONFIGURED (설정하면 켜짐)
async function getStripeForMerchant(merchant, merchantId) {
  const { secret } = await getStripeKeysForMerchant(merchant, merchantId);
  if (!secret) {
    const e = new Error(`Stripe not configured for ${merchant}${merchantId ? ' ' + merchantId : ''}`);
    e.code = 'STRIPE_NOT_CONFIGURED';
    throw e;
  }
  return new Stripe(secret);
}

// "설정하면 켜짐" 판정 — secret 존재 여부만
async function isStripeEnabled(merchant, merchantId) {
  try {
    const { secret } = await getStripeKeysForMerchant(merchant, merchantId);
    return !!secret;
  } catch { return false; }
}

module.exports = { getStripeForMerchant, getStripeKeysForMerchant, isStripeEnabled, normalizeMerchant };
