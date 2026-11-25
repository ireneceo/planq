// cronalive-exempt: Business deleted_at:null 로 고른다
// Trial 만료 처리 cron — 신규 가입자 체험 흐름 전용.
// 2026-05-05: Free 플랜 폐지 + Starter 14일 trial 정책으로 전환하면서 신설.
// 2026-11-25: 무료 플랜 재도입(Irene «권고대로» · docs/FREE_PLAN_PROPOSAL_2026-11-25.md) — **체험이 끝나면 잠그지 않고 무료로 내려간다.**
//   유예 7일·잠금은 없어졌다. 자료는 그대로이고, 무료 한도를 넘는 것은 새로 만들기만 막힌다.
//
// 단계:
//   가입       D+0   → Business{plan, subscription_status:'trialing', trial_ends_at:+14d(혼자)·+30d(팀)}
//   사전청구   종료 7일 전 → Subscription(pending) + Payment(pending) 자동 생성
//   체험종료   종료일 → 무료(plan='free', active) · 사전청구 구독은 canceled(trial_expired_no_payment)
//              — 그 입금 안내로 나중에 입금해도 billing.subscriptionConfirmability 가 되살린다(무료에서 원래 플랜으로).
//   past_due 는 약속한 유예(grace_ends_at)가 끝난 것만 같은 함수로 무료로 내린다(옛 체험 유예·체험 중 환불 유예).
//   유료 구독 유예(구독 past_due·grace)는 billing cron 몫이라 건너뛴다.
//
// billing.js 의 runDailyBillingCron 은 Subscription 기반이라 충돌 안 남.
// 입금 확인 → markPaymentPaid → Subscription active + Business active 자동 동기화.

const { Op } = require('sequelize');
const { Business, Subscription, BusinessMember, User } = require('../models');
const billing = require('./billing');
const emailService = require('./emailService');

const TRIAL_PRE_BILL_DAYS_BEFORE = 7;
const GRACE_DAYS = 7;

async function safeNotify(biz, kind) {
  try {
    const owner = await User.findByPk(biz.owner_id, { attributes: ['email', 'name'] });
    if (!owner?.email) return;
    const wsName = biz.brand_name || biz.name;
    // 제목 접두어는 emailService 의 subjectPrefix 가 [워크스페이스명] 으로 붙인다 (#149).
    // 여기서 [PlanQ] 를 또 박으면 '[워크스페이스] [PlanQ] 워크스페이스 — …' 처럼 세 겹이 된다.
    const subjects = {
      pre_bill: '체험 7일 남음, 결제 안내',
      expired: '체험 종료 — 무료 플랜으로 바뀌었습니다',
    };
    // 어느 플랜으로 체험 중인지 말한다 — 가입 때 플랜을 고르게 되면서(2026-10-09) 금액이 사람마다 다르다.
    const { getPlan } = require('../config/plans');
    const pl = getPlan(biz.plan);
    const planLabel = pl && pl.price_monthly && pl.price_monthly.KRW
      ? `${pl.name_ko || pl.name} 월 ${Number(pl.price_monthly.KRW).toLocaleString('ko-KR')}원` : '';
    const bodies = {
      pre_bill: `체험이 7일 남았습니다.${planLabel ? ` 체험 중인 플랜: ${planLabel}.` : ''} 결제 페이지에서 입금 정보를 확인하세요. 결제하지 않아도 워크스페이스는 잠기지 않고 무료 플랜으로 바뀝니다.`,
      expired: '체험이 끝나 무료 플랜으로 바뀌었습니다. 지금까지의 기록은 그대로 남아 있습니다. 무료 플랜은 멤버 1명·고객 3명·진행 중 프로젝트 2개까지이고, 결제하면 체험하던 플랜으로 바로 이어서 씁니다.',
    };
    await emailService.sendNotificationEmail({
      to: owner.email,
      title: subjects[kind] || '결제 안내',
      body: bodies[kind] || '',
      link: `${process.env.APP_URL || 'https://planq.kr'}/business/settings/plan`,
      ctaLabel: '결제 페이지 열기',
      workspaceName: wsName,
      businessId: biz.id,
      eventKind: `trial_${kind}`,
      recipientUserId: biz.owner_id,
    });
  } catch (e) {
    console.warn('[trial] notify failed', biz.id, kind, e.message);
  }
}

async function runDailyTrialCron() {
  const now = new Date();
  const stats = { pre_billed: 0, expired: 0, locked: 0, recovered: 0, errors: 0, exempt_skipped: 0 };

  // ★ 결제 면제 판정 (운영 #275). billing.createPendingSubscription 이 면제면 throw 하지만,
  //   그 throw 가 아래 per-biz catch 에 잡히면 stats.errors 로 오염되고 "왜 안 도는지" 가 로그에
  //   errors 로만 남는다. 여기서 **먼저 명시적으로 skip** 해 관측 가능하게 한다
  //   (Fable 설계 게이트 C2). 판정은 plan 엔진 단일 착지점을 재사용한다.
  const { isBillingExempt } = billing;

  // 1) D-7 사전 청구서 발행 (trial_ends_at 가 향후 7일 이내) — 한 번만
  const upcomingExpiry = new Date(now.getTime() + TRIAL_PRE_BILL_DAYS_BEFORE * 86400 * 1000);
  const upcomingTrials = await Business.findAll({
    where: {
      deleted_at: null,   // 삭제된 워크스페이스 제외
      subscription_status: 'trialing',
      trial_ends_at: { [Op.gte]: now, [Op.lte]: upcomingExpiry },
      plan: { [Op.ne]: 'free' },  // free deprecated
    },
  });
  for (const biz of upcomingTrials) {
    try {
      // 면제 워크스페이스에는 사전 청구서도 입금 안내 메일도 만들지 않는다.
      if (await isBillingExempt(biz.id)) {
        await billing.restoreExemptSubscription(biz.id);
        stats.exempt_skipped += 1;
        continue;
      }
      const existing = await Subscription.findOne({
        where: {
          business_id: biz.id,
          status: { [Op.in]: ['pending', 'active'] },
        },
      });
      if (existing) continue;
      await billing.createPendingSubscription({
        businessId: biz.id,
        planCode: biz.plan,
        cycle: 'monthly',
        userId: biz.owner_id,
        currency: 'KRW',
      });
      stats.pre_billed += 1;
      await safeNotify(biz, 'pre_bill');
    } catch (e) {
      console.warn('[trial] pre-bill failed', biz.id, e.message);
      stats.errors += 1;
    }
  }

  // 2) 체험 종료 → 무료 (2026-11-25 — 잠그지 않는다). 옛 흐름의 past_due 체험 유예 행도 같이 내린다.
  const expiredTrials = await Business.findAll({
    where: {
      deleted_at: null,   // 삭제된 워크스페이스 제외
      [Op.or]: [
        { subscription_status: 'trialing', trial_ends_at: { [Op.lt]: now } },
        // 약속한 유예가 **끝난** past_due 만 — 옛 3단계(잠금)와 같은 조건, 결과만 잠금 → 무료.
        //   ★ «plan_expires_at NULL» 로 고르면 안 된다(Fable 2026-11-25 FAIL 재현): 면제가 풀린 유료 곳은 plan_expires_at 이 NULL 이라
        //     결제 유예 7일 없이 그날 밤 무료로 떨어졌고, 체험 중 환불(refund.js — 유예 7일 약속 메일)도 그날 밤 내려갔다.
        { subscription_status: 'past_due', grace_ends_at: { [Op.lt]: now } },
      ],
    },
  });
  for (const biz of expiredTrials) {
    try {
      // 면제면 체험 만료로 내리지 않고 정상 상태로 복원한다.
      if (await isBillingExempt(biz.id)) {
        await billing.restoreExemptSubscription(biz.id);
        stats.exempt_skipped += 1;
        continue;
      }
      // 유료 구독 유예(구독 past_due·grace)는 billing cron(downgradeToFree · 이력 expire) 몫이다 — 여기서 «체험 끝» 으로 적지 않는다.
      if (biz.subscription_status === 'past_due') {
        const paidGrace = await Subscription.count({ where: { business_id: biz.id, status: { [Op.in]: ['past_due', 'grace'] } } });
        if (paidGrace > 0) continue;
      }
      const r = await expireTrialToFree(biz.id);
      if (r.recovered) { stats.recovered += 1; continue; }
      if (!r.changed) continue;
      stats.expired += 1;
      await safeNotify(biz, 'expired');
      // 플랫폼 관리자에게 — 누가 체험 만료됐는지 운영 모니터링용
      try {
        const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
        await notifyPlatformAdmins({
          eventKind: 'trial',
          title: `체험 만료 → 무료 — ${biz.brand_name || biz.name}`,
          body: `워크스페이스 ID ${biz.id} 의 체험(${r.fromPlan})이 끝나 무료 플랜으로 내려갔습니다.`,
          link: `${APP_URL}/admin/businesses?id=${biz.id}`,
          ctaLabel: '워크스페이스 보기',
          relatedEntityId: biz.id,
        }).catch(() => null);
      } catch { /* noop */ }
    } catch (e) {
      console.warn('[trial] expire failed', biz.id, e.message);
      stats.errors += 1;
    }
  }

  return stats;
}

// 체험 끝 → 무료 한 함수 (cron·옛 잠금 되살리기 스크립트가 같이 쓴다).
//   결제가 확정된 구독(active)이 있으면 무료로 내리지 않고 active 로 맞춘다(옛 lock 단계의 «입금 확인됐으면 복구» 그대로).
//   사전청구 구독은 canceled(trial_expired_no_payment) — 고객이 받은 입금 안내로 나중에 입금하면 billing 이 되살린다.
//   이력 trial_end(from = 체험 플랜)는 teamTrialAvailability 가 «팀 체험을 이미 썼나» 를 읽는 근거다.
async function expireTrialToFree(businessId, { note = null } = {}) {
  const { sequelize } = require('../config/database');
  const { BusinessPlanHistory } = require('../models');
  const t = await sequelize.transaction();
  try {
    const biz = await Business.findByPk(businessId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!biz) { await t.rollback(); return { changed: false }; }
    const activeSub = await Subscription.findOne({ where: { business_id: biz.id, status: 'active' }, transaction: t });
    if (activeSub) {
      await biz.update({ subscription_status: 'active', grace_ends_at: null }, { transaction: t });
      await t.commit();
      try { require('./plan').invalidateBusinessCache(biz.id); } catch { /* noop */ }
      return { changed: false, recovered: true };
    }
    if (biz.plan === 'free' && biz.subscription_status === 'active') { await t.rollback(); return { changed: false }; }
    const fromPlan = biz.plan;
    await Subscription.update(
      { status: 'canceled', canceled_at: new Date(), cancel_reason: 'trial_expired_no_payment' },
      { where: { business_id: biz.id, status: { [Op.in]: ['pending', 'past_due', 'grace'] } }, transaction: t },
    );
    await biz.update({
      plan: 'free', subscription_status: 'active', grace_ends_at: null, plan_expires_at: null, scheduled_plan: null,
    }, { transaction: t });
    if (fromPlan !== 'free') {
      await BusinessPlanHistory.create({
        business_id: biz.id, from_plan: fromPlan, to_plan: 'free', reason: 'trial_end',
        changed_by: null, note: note || '체험 종료 → 무료',
      }, { transaction: t });
    }
    await t.commit();
    try { require('./plan').invalidateBusinessCache(biz.id); } catch { /* noop */ }
    return { changed: true, fromPlan };
  } catch (e) {
    if (!t.finished) await t.rollback();
    throw e;
  }
}

module.exports = { runDailyTrialCron, expireTrialToFree, GRACE_DAYS, TRIAL_PRE_BILL_DAYS_BEFORE };
