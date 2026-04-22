// 플랜 만료·체험 종료·grace 종료 배치 (일 1회)
// 실행: node scripts/plan-expiry-check.js
// PM2: ecosystem.config.js 에 cron_restart: '0 1 * * *' (매일 오전 1시)

const { Business, BusinessPlanHistory } = require('../models');
const { Op } = require('sequelize');

async function run() {
  const now = new Date();
  const logs = { trial_ended: 0, plan_expired: 0, grace_ended: 0, scheduled_applied: 0 };

  try {
    // 1) 체험 종료 — trial_ends_at 지남 + plan != free
    const trialExpired = await Business.findAll({
      where: {
        trial_ends_at: { [Op.lt]: now, [Op.not]: null },
        plan: { [Op.ne]: 'free' },
        subscription_status: 'trialing',
      }
    });
    for (const biz of trialExpired) {
      const fromPlan = biz.plan;
      await biz.update({
        plan: 'free',
        subscription_status: 'active',
        trial_ends_at: null,
      });
      await BusinessPlanHistory.create({
        business_id: biz.id, from_plan: fromPlan, to_plan: 'free',
        reason: 'trial_end', note: '체험 14일 종료 — Free 로 전환',
        effective_at: now,
      });
      logs.trial_ended++;
    }

    // 2) 결제 만료 — plan_expires_at 지남 + grace 없음 + plan != free
    const planExpired = await Business.findAll({
      where: {
        plan_expires_at: { [Op.lt]: now, [Op.not]: null },
        plan: { [Op.ne]: 'free' },
        [Op.or]: [{ grace_ends_at: null }, { grace_ends_at: { [Op.lt]: now } }],
      }
    });
    for (const biz of planExpired) {
      const fromPlan = biz.plan;
      await biz.update({ plan: 'free', subscription_status: 'canceled' });
      await BusinessPlanHistory.create({
        business_id: biz.id, from_plan: fromPlan, to_plan: 'free',
        reason: 'expire', note: '결제 기간 만료 — Free 로 전환',
        effective_at: now,
      });
      logs.plan_expired++;
    }

    // 3) grace 종료 — 결제 실패 또는 다운그레이드 grace 끝남
    const graceEnded = await Business.findAll({
      where: {
        grace_ends_at: { [Op.lt]: now, [Op.not]: null },
      }
    });
    for (const biz of graceEnded) {
      // grace 만료 후 처리 — subscription_status=canceled 로
      if (biz.subscription_status === 'past_due') {
        const fromPlan = biz.plan;
        await biz.update({
          plan: 'free',
          subscription_status: 'canceled',
          grace_ends_at: null,
        });
        await BusinessPlanHistory.create({
          business_id: biz.id, from_plan: fromPlan, to_plan: 'free',
          reason: 'payment_failed', note: '결제 실패 grace 7일 종료',
          effective_at: now,
        });
        logs.grace_ended++;
      } else {
        // 다운그레이드 grace 종료 → read-only 해제 (이미 다운그레이드된 상태)
        await biz.update({ grace_ends_at: null });
      }
    }

    // 4) scheduled_plan 적용 — plan_expires_at 도달하여 예정 변경 적용
    const scheduled = await Business.findAll({
      where: {
        scheduled_plan: { [Op.not]: null },
        plan_expires_at: { [Op.lt]: now, [Op.not]: null },
      }
    });
    for (const biz of scheduled) {
      const fromPlan = biz.plan;
      const toPlan = biz.scheduled_plan;
      await biz.update({
        plan: toPlan,
        scheduled_plan: null,
        plan_expires_at: null,
        grace_ends_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),  // 30일 read-only grace
      });
      await BusinessPlanHistory.create({
        business_id: biz.id, from_plan: fromPlan, to_plan: toPlan,
        reason: 'downgrade', note: '예약된 다운그레이드 적용 (30일 grace 시작)',
        effective_at: now,
      });
      logs.scheduled_applied++;
    }

    console.log(`[plan-expiry] ${new Date().toISOString()} trial_ended=${logs.trial_ended} plan_expired=${logs.plan_expired} grace_ended=${logs.grace_ended} scheduled_applied=${logs.scheduled_applied}`);

    const anyChange = Object.values(logs).some(v => v > 0);
    if (anyChange) {
      // TODO: SMTP 설정 후 관리자 이메일 전송
      console.log('[plan-expiry] changes detected — consider notifying admin');
    }

    process.exit(0);
  } catch (err) {
    console.error('[plan-expiry] failed:', err);
    process.exit(1);
  }
}

run();
