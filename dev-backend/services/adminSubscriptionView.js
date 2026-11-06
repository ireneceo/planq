// 플랫폼 관리자 › 구독 관리 — 목록 보조(주인 표시·검색·구독 행 없는 워크스페이스).
// routes/admin_billing.js 가 god-file 상한(500줄)을 넘지 않게 절출. 판정 술어는 여기 한 곳 —
// 목록과 요약 숫자가 같은 함수를 쓴다.
const { Op } = require('sequelize');
const { Business, Subscription, User } = require('../models');
const { isExemptNow } = require('./billingExemptView');

const OWNER_ATTRS = ['id', 'name', 'email'];
const ownerOf = (b) => (b && b.owner ? { id: b.owner.id, name: b.owner.name, email: b.owner.email } : null);

// 검색어 → 워크스페이스 조건. 이름·브랜드·slug + **주인 이름·이메일**.
// 주인은 먼저 User 에서 id 를 찾아 owner_id IN 으로 건다(중첩 include 의 $컬럼$ 은 limit 과 같이 쓰면 깨진다).
async function businessSearchOr(q) {
  if (!q) return null;
  const users = await User.findAll({
    attributes: ['id'],
    where: { [Op.or]: [{ email: { [Op.like]: `%${q}%` } }, { name: { [Op.like]: `%${q}%` } }] },
    limit: 500, raw: true,
  });
  return [
    { name: { [Op.like]: `%${q}%` } },
    { brand_name: { [Op.like]: `%${q}%` } },
    { slug: { [Op.like]: `%${q}%` } },
    ...(users.length ? [{ owner_id: { [Op.in]: users.map((u) => u.id) } }] : []),
  ];
}

// ★ 구독 행이 없는 살아 있는 워크스페이스 — 목록과 집계가 **이 한 함수**를 쓴다.
//   구독 행(subscriptions)은 «결제하기» 를 눌러야 생긴다(services/billing createPendingSubscription).
//   가입만 하고 체험 중인 워크스페이스는 행이 없어 구독관리에 영영 안 나왔다(2026-10-12 Irene 신고).
//   면제·옛 이관분처럼 active 인데 행이 없는 곳도 같은 구멍이라 함께 보인다.
async function workspacesWithoutSubscription({ q = '', onlyTrialing = false } = {}) {
  const withSub = await Subscription.findAll({
    attributes: ['business_id'], where: { status: { [Op.ne]: 'replaced' } }, group: ['business_id'], raw: true,
  });
  const or = await businessSearchOr(q);
  return Business.findAll({
    where: {
      deleted_at: null,
      ...(withSub.length ? { id: { [Op.notIn]: withSub.map((r) => r.business_id) } } : {}),
      ...(onlyTrialing ? { subscription_status: 'trialing' } : {}),
      ...(or ? { [Op.or]: or } : {}),
    },
    attributes: ['id', 'name', 'brand_name', 'slug', 'plan', 'subscription_status', 'trial_ends_at', 'created_at',
      'billing_exempt', 'billing_exempt_kind', 'billing_exempt_until'],
    include: [{ model: User, as: 'owner', attributes: OWNER_ATTRS, required: false }],
    order: [['created_at', 'DESC']],
    limit: 1000,
  });
}

// 구독 행이 없는 워크스페이스를 구독 행과 같은 모양으로 — 화면은 kind 로 가른다(입금확인·강등 버튼 없음).
// 만든 날 — Business 는 timestamps 가 createdAt 속성이라 b.created_at 이 비어 있다(정렬이 NaN 이 됐다).
const createdAtOf = (m) => m.createdAt || m.get?.('created_at') || m.created_at || null;

function workspaceRow(b) {
  return {
    id: `biz-${b.id}`,
    kind: 'workspace',
    business: {
      id: b.id,
      name: b.brand_name || b.name,
      slug: b.slug,
      plan: b.plan,
      subscription_status: b.subscription_status,
      billing_exempt: isExemptNow(b),
      billing_exempt_kind: b.billing_exempt_kind,
      owner: ownerOf(b),
      joined_at: createdAtOf(b),
    },
    plan_code: b.plan,
    cycle: null,
    status: b.subscription_status === 'trialing' ? 'trialing' : 'no_subscription',
    price: null,
    currency: null,
    trial_ends_at: b.trial_ends_at,
    started_at: null, current_period_start: null, current_period_end: null, next_billing_at: null,
    past_due_at: null, grace_ends_at: null, demoted_at: null, canceled_at: null, cancel_reason: null,
    created_at: createdAtOf(b),
    pending_payment: null,
  };
}

// 구독 행 → 화면 한 줄. pp = 그 구독의 가장 최근 pending 결제(입금 확인 대상) 또는 undefined.
function subscriptionRow(s, pp) {
  return {
  id: s.id,
  kind: 'subscription',
  business: s.Business ? {
    id: s.Business.id,
    name: s.Business.brand_name || s.Business.name,
    slug: s.Business.slug,
    plan: s.Business.plan,
    subscription_status: s.Business.subscription_status,
    // 프론트는 이 값만 보고 "면제" 뱃지를 띄우고 상태 라벨을 과거형으로 바꾼다.
    billing_exempt: isExemptNow(s.Business),
    billing_exempt_kind: s.Business.billing_exempt_kind,
    owner: ownerOf(s.Business),
    joined_at: createdAtOf(s.Business),
  } : null,
  plan_code: s.plan_code,
  cycle: s.cycle,
  status: s.status,
  price: Number(s.price),
  currency: s.currency,
  // 체험 종료일은 워크스페이스가 아직 체험 중일 때만 — 결제 뒤엔 지난 기록이라 헷갈린다.
  trial_ends_at: s.Business && s.Business.subscription_status === 'trialing' ? s.Business.trial_ends_at : null,
  started_at: s.started_at,
  current_period_start: s.current_period_start,
  current_period_end: s.current_period_end,
  next_billing_at: s.next_billing_at,
  past_due_at: s.past_due_at,
  grace_ends_at: s.grace_ends_at,
  demoted_at: s.demoted_at,
  canceled_at: s.canceled_at,
  cancel_reason: s.cancel_reason,
  created_at: createdAtOf(s),
  pending_payment: pp ? {
    id: pp.id,
    amount: Number(pp.amount),
    method: pp.method,
    period_start: pp.period_start,
    period_end: pp.period_end,
    created_at: createdAtOf(pp),
    // 고객 입금 통보 — 관리자 확인 우선순위 표시용
    notify_paid_at: pp.notify_paid_at,
    notify_payer_name: pp.notify_payer_name || pp.payer_name || null,
  } : null,
  };
}

module.exports = { createdAtOf, OWNER_ATTRS, ownerOf, businessSearchOr, workspacesWithoutSubscription, workspaceRow, subscriptionRow };
