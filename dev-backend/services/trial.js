// Trial 만료 처리 cron — 신규 가입자(starter+trialing+14일) 흐름 전용.
// 2026-05-05: Free 플랜 폐지 + Starter 14일 trial 정책으로 전환하면서 신설.
//
// 단계:
//   가입       D+0   → Business{plan:'starter', subscription_status:'trialing', trial_ends_at:+14d}
//   사전청구   D+7   → Subscription(pending) + Payment(pending) 자동 생성
//   체험종료   D+14  → Business.subscription_status='past_due', grace_ends_at = trial_ends_at + 7d
//   잠금      D+21  → Business.subscription_status='canceled' (입금 미확인 시)
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
      expired: '체험 종료 — 7일 안에 결제가 필요합니다',
      locked: '결제 미확인 — 워크스페이스가 잠금됐습니다',
    };
    const bodies = {
      pre_bill: '14일 체험이 7일 남았습니다. 결제 페이지에서 입금 정보를 확인하세요.',
      expired: '14일 체험이 종료됐습니다. 7일 안에 결제하지 않으면 워크스페이스가 잠금됩니다.',
      locked: '결제가 확인되지 않아 워크스페이스가 잠금 상태로 전환됐습니다. 결제 후 자동 복구됩니다.',
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
  const stats = { pre_billed: 0, expired: 0, locked: 0, recovered: 0, errors: 0 };

  // 1) D-7 사전 청구서 발행 (trial_ends_at 가 향후 7일 이내) — 한 번만
  const upcomingExpiry = new Date(now.getTime() + TRIAL_PRE_BILL_DAYS_BEFORE * 86400 * 1000);
  const upcomingTrials = await Business.findAll({
    where: {
      subscription_status: 'trialing',
      trial_ends_at: { [Op.gte]: now, [Op.lte]: upcomingExpiry },
      plan: { [Op.ne]: 'free' },  // free deprecated
    },
  });
  for (const biz of upcomingTrials) {
    try {
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

  // 2) D+0 trial 종료 → past_due + grace 7일
  const expiredTrials = await Business.findAll({
    where: {
      subscription_status: 'trialing',
      trial_ends_at: { [Op.lt]: now },
    },
  });
  for (const biz of expiredTrials) {
    try {
      const trialEnd = biz.trial_ends_at || now;
      const graceEndsAt = new Date(trialEnd.getTime() + GRACE_DAYS * 86400 * 1000);
      await biz.update({
        subscription_status: 'past_due',
        grace_ends_at: graceEndsAt,
      });
      try { require('./plan').invalidateBusinessCache(biz.id); } catch { /* noop */ }
      stats.expired += 1;
      await safeNotify(biz, 'expired');
      // 플랫폼 관리자에게 — 누가 체험 만료됐는지 운영 모니터링용
      try {
        const { notifyPlatformAdmins, APP_URL } = require('./platformNotify');
        await notifyPlatformAdmins({
          eventKind: 'trial',
          title: `체험 만료 — ${biz.brand_name || biz.name}`,
          body: `워크스페이스 ID ${biz.id} 의 14일 체험이 종료됐습니다. grace 7일 후 미입금 시 잠금됩니다.`,
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

  // 3) D+7 grace 종료 → canceled (잠금) — 단, 입금 확인됐으면 active 복구
  const expiredGrace = await Business.findAll({
    where: {
      subscription_status: 'past_due',
      grace_ends_at: { [Op.lt]: now },
    },
  });
  for (const biz of expiredGrace) {
    try {
      const activeSub = await Subscription.findOne({
        where: { business_id: biz.id, status: 'active' },
      });
      if (activeSub) {
        await biz.update({ subscription_status: 'active', grace_ends_at: null });
        try { require('./plan').invalidateBusinessCache(biz.id); } catch { /* noop */ }
        stats.recovered += 1;
        continue;
      }
      await biz.update({ subscription_status: 'canceled' });
      await Subscription.update(
        { status: 'canceled', canceled_at: now, cancel_reason: 'trial_expired_no_payment' },
        {
          where: {
            business_id: biz.id,
            status: { [Op.in]: ['pending', 'past_due', 'grace'] },
          },
        }
      );
      try { require('./plan').invalidateBusinessCache(biz.id); } catch { /* noop */ }
      stats.locked += 1;
      await safeNotify(biz, 'locked');
    } catch (e) {
      console.warn('[trial] lock failed', biz.id, e.message);
      stats.errors += 1;
    }
  }

  return stats;
}

module.exports = { runDailyTrialCron, GRACE_DAYS, TRIAL_PRE_BILL_DAYS_BEFORE };
