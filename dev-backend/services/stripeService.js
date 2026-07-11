// services/stripeService.js — merchant(발행자)별 Stripe 인스턴스.
//   POS utils/stripeService.js 패턴 이식(issuer→merchant). POS 는 secret 평문 JSON,
//   PlanQ 는 AES-256-GCM 복호화(더 안전).
//   merchant='platform' → PlanQ 구독료 수취(platform_settings). merchant='workspace' → Q Bill 워크스페이스 수취(Business).
//   설계: docs/UNIFIED_PAYMENT_ARCHITECTURE.md §1·§2③, 분리: SAAS_BILLING_VS_QBILL_SEPARATION.md
const Stripe = require('stripe');
const { decrypt } = require('./encryption');
const PlatformSetting = require('../models/PlatformSetting');
const Business = require('../models/Business');

// merchant 는 항상 서버 상수('platform'|'workspace')로만 호출 — 절대 request 입력에서 받지 말 것(권한 pivot 방지, Fable F6).
// 별칭 매핑 없음(platform_admin→platform 같은 alias 제거): 알 수 없는 값은 아래 switch default 에서 throw.
function normalizeMerchant(m) {
  return m;
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

// "카드 결제 켜짐" 판정 — secret + webhook secret 둘 다 있어야 한다.
//
// 여태 secret 만 검사했다. 그래서 Secret Key 만 넣고 Webhook Secret 을 안 넣으면
// 결제 버튼은 켜지는데 웹훅 엔드포인트가 503 → 고객이 카드로 결제해서 돈은 Stripe 로 들어오는데
// 청구서는 영영 '결제 완료'로 확정되지 않는다 (돈은 받았는데 미수금으로 남음).
// 결제 확정 경로가 없는 결제 버튼은 켜면 안 된다.
async function isStripeEnabled(merchant, merchantId) {
  try {
    const { secret, webhookSecret } = await getStripeKeysForMerchant(merchant, merchantId);
    return !!secret && !!webhookSecret;
  } catch { return false; }
}

module.exports = { getStripeForMerchant, getStripeKeysForMerchant, isStripeEnabled, normalizeMerchant };
