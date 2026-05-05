// 기존 Free 사용자 일괄 starter + trialing 14일 마이그레이션
// 2026-05-05: Free 플랜 폐지에 따른 일회성 마이그레이션.
//
// 동작:
//   - Business.plan='free' && subscription_status NOT IN ('canceled','demoted') 대상
//   - plan='starter', subscription_status='trialing', trial_ends_at = now + 14일
//   - BusinessPlanHistory 기록 (from_plan='free', to_plan='starter', reason='free_deprecated_2026_05_05')
//
// 안전 가드:
//   - --dry-run 으로 영향받을 row 만 출력
//   - 이미 trial_ends_at 가 있고 미래면 skip (재실행 안전)
//   - 트랜잭션 단위: business 1건씩 (실패 시 그 1건만 영향)

require('dotenv').config();
const { Op } = require('sequelize');

(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const { sequelize } = require('../config/database');
  const { Business, BusinessPlanHistory } = require('../models');

  await sequelize.authenticate();
  console.log(`[migrate] start (dry_run=${dryRun}) ${new Date().toISOString()}`);

  const candidates = await Business.findAll({
    where: {
      plan: 'free',
      subscription_status: { [Op.notIn]: ['canceled', 'demoted'] },
    },
    attributes: ['id', 'brand_name', 'name', 'owner_id', 'subscription_status', 'trial_ends_at'],
  });

  console.log(`[migrate] candidates: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('[migrate] no rows to migrate');
    process.exit(0);
  }

  const TRIAL_DAYS = 14;
  let ok = 0, skip = 0, fail = 0;
  const now = new Date();

  for (const biz of candidates) {
    const wsName = biz.brand_name || biz.name || `(id:${biz.id})`;

    if (biz.trial_ends_at && new Date(biz.trial_ends_at) > now) {
      console.log(`  SKIP id=${biz.id} ${wsName} — trial_ends_at 이미 미래(${biz.trial_ends_at})`);
      skip += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  WOULD migrate id=${biz.id} ${wsName} → starter+trialing+14d`);
      ok += 1;
      continue;
    }

    const t = await sequelize.transaction();
    try {
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400 * 1000);
      await biz.update({
        plan: 'starter',
        subscription_status: 'trialing',
        trial_ends_at: trialEndsAt,
        grace_ends_at: null,
      }, { transaction: t });
      await BusinessPlanHistory.create({
        business_id: biz.id,
        from_plan: 'free',
        to_plan: 'starter',
        reason: 'trial_start',  // 기존 free 폐지 + starter 14일 trial 시작 = 의미상 trial_start
        note: 'Free 플랜 폐지 (2026-05-05) — 기존 워크스페이스 일괄 starter+trialing 14일 적용',
        changed_by: null,
        effective_at: now,
      }, { transaction: t });
      await t.commit();
      console.log(`  OK   id=${biz.id} ${wsName} → starter (trial→${trialEndsAt.toISOString().slice(0, 10)})`);
      ok += 1;
    } catch (e) {
      if (!t.finished) await t.rollback();
      console.warn(`  FAIL id=${biz.id} ${wsName}: ${e.message}`);
      fail += 1;
    }
  }

  console.log(`\n[migrate] done — ok=${ok} skip=${skip} fail=${fail} (dry_run=${dryRun})`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('[migrate] fatal', e); process.exit(2); });
