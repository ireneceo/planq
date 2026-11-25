// 옛 «체험 끝 잠금» 워크스페이스를 무료 플랜으로 다시 연다 (2026-11-25 · docs/FREE_PLAN_PROPOSAL_2026-11-25.md)
//
// 무료 플랜을 다시 열면서 체험 끝은 잠금이 아니라 무료로 내려간다(services/trial.expireTrialToFree).
// 그 전에 잠긴 곳(subscription_status='canceled' + 체험 미결제 잠금)도 같은 함수로 무료로 연다 — 자료는 그대로.
//
// 대상: 지워지지 않음 ∧ subscription_status='canceled' ∧ 면제 아님 ∧ 활성 구독 없음 ∧
//       (구독이 trial_expired_no_payment 로 닫혔거나, 구독이 하나도 없고 trial_ends_at 이 있음)
//   — 대표가 직접 해지한 유료 구독 등 다른 이유의 canceled 는 건드리지 않는다.
//
// 기본은 읽기만(dry-run). 실제로 바꾸려면 --apply. 멱등(이미 무료 active 면 건너뜀).
// 안내 메일은 보내지 않는다 — 외부 발송이라 Irene 승인 뒤 따로.

require('dotenv').config();
const { Op } = require('sequelize');

(async () => {
  const apply = process.argv.includes('--apply');
  const { sequelize } = require('../config/database');
  const { Business, Subscription } = require('../models');
  const { expireTrialToFree } = require('../services/trial');
  const { isBillingExempt } = require('../services/billing');

  await sequelize.authenticate();
  console.log(`[locked-to-free] start (apply=${apply}) ${new Date().toISOString()}`);

  const rows = await Business.findAll({
    where: { deleted_at: null, subscription_status: 'canceled' },
    attributes: ['id', 'name', 'brand_name', 'plan', 'trial_ends_at'],
  });

  const targets = [];
  for (const biz of rows) {
    if (await isBillingExempt(biz.id)) continue;
    const subs = await Subscription.findAll({ where: { business_id: biz.id }, attributes: ['status', 'cancel_reason'] });
    if (subs.some((s) => s.status === 'active')) continue;
    const trialLock = subs.some((s) => s.status === 'canceled' && s.cancel_reason === 'trial_expired_no_payment');
    const noSubTrial = subs.length === 0 && !!biz.trial_ends_at;
    if (!trialLock && !noSubTrial) continue;
    targets.push(biz);
  }

  console.log(`[locked-to-free] canceled ${rows.length} · 대상 ${targets.length}`);
  for (const b of targets) console.log(`  - #${b.id} ${b.brand_name || b.name} (${b.plan})`);

  if (!apply) {
    console.log('[locked-to-free] 읽기만 — 바꾸려면 --apply');
    process.exit(0);
  }

  let ok = 0; let fail = 0;
  for (const b of targets) {
    try {
      const r = await expireTrialToFree(b.id, { note: '옛 체험 잠금 → 무료 (2026-11-25 무료 재도입)' });
      if (r.changed || r.recovered) ok += 1;
    } catch (e) {
      fail += 1;
      console.warn(`  ! #${b.id} ${e.message}`);
    }
  }
  console.log(`[locked-to-free] done ok=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
