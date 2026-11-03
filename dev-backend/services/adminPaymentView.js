// 플랫폼 관리자 › 결제 이력 — 행마다 «누구의 · 언제 가입한 · 어떻게 생긴 청구인가».
// routes/admin_billing.js 가 god-file 상한(500줄)을 넘지 않게 뺐다. 주인 표시는 구독 관리와 같은 함수(adminSubscriptionView).
//
// ★ 청구가 생긴 길(origin)은 컬럼이 아니라 파생이다. Payment 를 만드는 문은 셋뿐이다:
//   ① 사용자가 [결제하기] → POST /api/plan/:biz/checkout — 감사 `subscription.checkout`(newValue.payment_id) 이 남는다
//   ② 체험 끝나기 7일 전 cron(services/trial.js) — 같은 createPendingSubscription 을 created_by = 주인으로 부른다.
//      created_by 만 보면 «주인이 골랐다» 로 읽히므로 ①의 감사가 없는 플랜 청구를 ②로 본다.
//   ③ 기간 갱신 cron(billing.ensureRenewalPayment) — created_by NULL
//   애드온은 kind='addon'(신청한 사람 = created_by).
const { Op } = require('sequelize');
const { AuditLog, User } = require('../models');
const { createdAtOf, ownerOf } = require('./adminSubscriptionView');

// 결제 요청 감사(subscription.checkout)가 남기 시작한 날(5daecf12, 2026-05-24) — 그 전 청구는 감사가 없어도
//   자동 청구라고 단정할 수 없다(사용자가 골랐을 수도 있다) → 'unknown' 으로 «만든 사람» 만 보인다.
const CHECKOUT_AUDIT_SINCE = new Date('2026-05-25T00:00:00+09:00');

async function paymentOrigins(rows) {
  const ids = rows.map((p) => p.id);
  const audits = ids.length ? await AuditLog.findAll({
    where: { action: 'subscription.checkout', target_type: 'subscription',
      target_id: { [Op.in]: [...new Set(rows.map((p) => p.subscription_id).filter(Boolean))] } },
    attributes: ['user_id', 'acting_for_user_id', 'target_id', 'new_value', 'created_at'],
  }) : [];
  const byPayment = new Map();
  for (const a of audits) {
    let nv = a.new_value;
    if (typeof nv === 'string') { try { nv = JSON.parse(nv); } catch { nv = null; } }
    if (nv && nv.payment_id) byPayment.set(Number(nv.payment_id), { a, nv });
  }

  const userIds = new Set();
  for (const p of rows) if (p.created_by) userIds.add(p.created_by);
  for (const { a } of byPayment.values()) if (a.user_id) userIds.add(a.user_id);
  const users = userIds.size ? await User.findAll({ where: { id: { [Op.in]: [...userIds] } }, attributes: ['id', 'name', 'email'] }) : [];
  const userMap = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, email: u.email }]));

  const out = new Map();
  for (const p of rows) {
    const hit = byPayment.get(p.id);
    if (p.kind === 'addon') {
      out.set(p.id, { kind: 'addon', at: createdAtOf(p), by: userMap.get(p.created_by) || null });
    } else if (hit) {
      out.set(p.id, {
        kind: 'checkout', at: createdAtOf(hit.a) || createdAtOf(p), by: userMap.get(hit.a.user_id) || null,
        // 체험 화면에서 고른 선택지 — 실제로 붙은 보너스 개월과 같이(자격 미달이면 0)
        trial_option: hit.nv.trial_option || null, bonus_months: Number(hit.nv.bonus_months) || 0,
      });
    } else if (!p.created_by) {
      out.set(p.id, { kind: 'renewal', at: createdAtOf(p), by: null });
    } else if (new Date(createdAtOf(p)) < CHECKOUT_AUDIT_SINCE) {
      out.set(p.id, { kind: 'unknown', at: createdAtOf(p), by: userMap.get(p.created_by) || null });
    } else {
      out.set(p.id, { kind: 'trial_prebill', at: createdAtOf(p), by: null });
    }
  }
  return out;
}

// 워크스페이스 쪽 — 가입일(= 워크스페이스를 만든 날)·체험 종료일·주인
function businessInfo(b) {
  if (!b) return null;
  return {
    id: b.id,
    name: b.brand_name || b.name,
    slug: b.slug,
    created_at: createdAtOf(b),
    trial_ends_at: b.trial_ends_at || null,
    subscription_status: b.subscription_status || null,
    owner: ownerOf(b),
  };
}

// 카드 결제를 Stripe 대시보드에서 직접 환불할 때 여는 주소 — 관리자 처리 창이 «이 결제 열기» 로 쓴다(2026-11-03).
//   결제 번호(pi_)가 있으면 그 결제, 없으면(옛 행·cs_) 대표 이메일로 검색. 테스트 키면 /test 경로.
//   어느 Stripe 계정에 로그인했느냐는 주소로 못 고른다 — 처리 창 안내가 «결제를 받은 계정» 을 말한다.
async function stripeDashboardLinker() {
  const { PlatformSetting } = require('../models');
  const row = await PlatformSetting.findOne({ order: [['id', 'ASC']], attributes: ['stripe_publishable_key'] });
  const base = `https://dashboard.stripe.com${/^pk_test_/.test(row?.stripe_publishable_key || '') ? '/test' : ''}`;
  return (p, b) => {
    if (p.method !== 'stripe' && p.method !== 'card') return null;
    const pi = p.stripe_payment_intent || '';
    if (/^pi_[A-Za-z0-9]+$/.test(pi)) return `${base}/payments/${pi}`;
    const email = b?.owner?.email || ownerOf(b)?.email;
    return email ? `${base}/search?query=${encodeURIComponent(email)}` : `${base}/payments`;
  };
}

module.exports = { paymentOrigins, businessInfo, stripeDashboardLinker };
