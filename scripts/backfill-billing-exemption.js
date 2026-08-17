// 결제 면제 백필 (운영 #275) — 멱등. 기본은 dry-run.
//
//   node scripts/backfill-billing-exemption.js              # dry-run (아무것도 안 바꿈)
//   node scripts/backfill-billing-exemption.js --apply      # 실제 적용
//
// 하는 일
//   1) 대상 워크스페이스에 면제 설정 (내부 / 테스터)
//   2) 내부 워크스페이스의 기존 paid/refunded 결제를 is_revenue=0 으로 (비매출)
//   3) 면제 워크스페이스의 잔여 pending 청구를 canceled 로
//   4) 구독·워크스페이스 상태 정상화 (past_due/grace → active, 잠금 해제)
//
// ★ 운영 payment/business id 를 하드코딩하지 않는다 (Fable 설계 게이트 C5).
//   dev 와 운영은 id 매핑이 완전히 다르다 — dev biz 1 은 'Test Company' 다.
//   대상은 slug(UNIQUE) 로만 고른다. 실행 전 대상 목록을 출력하니 육안으로 대조할 것.
//
// 설계: docs/BILLING_EXEMPTION_DESIGN.md
// node_modules 와 .env 는 백엔드 쪽에 있다 — scripts/migrate-qrecord-to-post.js 와 같은 패턴.
// ★ 백엔드 디렉터리 이름이 dev(=dev-backend)와 운영(=backend)에서 다르다. 운영에서 돌려야 하는
//   스크립트이므로 둘 다 찾는다 — 하드코딩하면 운영에서 MODULE_NOT_FOUND 로 죽는다.
const path = require('path');
const fs = require('fs');
const BE = ['dev-backend', 'backend']
  .map((d) => path.join(__dirname, '..', d))
  .find((p) => fs.existsSync(path.join(p, 'models')));
if (!BE) {
  console.error('ERR 백엔드 디렉터리를 찾지 못했습니다 (../dev-backend 또는 ../backend)');
  process.exit(1);
}
console.log(`(backend: ${BE})`);
process.chdir(BE);
require(path.join(BE, 'node_modules', 'dotenv')).config();

const { sequelize } = require(path.join(BE, 'config/database'));
const { Business, Payment, Subscription } = require(path.join(BE, 'models'));
const billing = require(path.join(BE, 'services/billing'));
const planEngine = require(path.join(BE, 'services/plan'));

const APPLY = process.argv.includes('--apply');

// --target=<slug>:<kind>:<plan> (반복 가능) — 아래 TARGETS 를 통째로 대체한다.
// 용도 ① dev 에서 백필 로직 자체를 검증할 때(운영과 slug 가 다르다)
//      ② 운영에서 워크스페이스가 새로 추가/변경돼 코드 수정 없이 돌려야 할 때
const { PLANS } = require(path.join(BE, 'config/plans'));
const VALID_PLANS = Object.keys(PLANS);
const VALID_KINDS = ['internal', 'tester', 'partner'];

const CLI_TARGETS = process.argv
  .filter(a => a.startsWith('--target='))
  .map(a => {
    const [slug, kind, plan] = a.slice('--target='.length).split(':');
    // ★ 오타를 조용히 삼키지 않는다 — getPlan() 은 미지 코드에 starter 를 폴백하므로
    //   검증 없이 넘기면 'prro' 같은 오타가 조용히 starter 면제가 된다 (Fable 권고 2).
    if (kind && !VALID_KINDS.includes(kind)) {
      console.error(`ERR --target 의 kind 가 올바르지 않습니다: '${kind}' (허용: ${VALID_KINDS.join(', ')})`);
      process.exit(1);
    }
    if (plan && !VALID_PLANS.includes(plan)) {
      console.error(`ERR --target 의 plan 이 올바르지 않습니다: '${plan}' (허용: ${VALID_PLANS.join(', ')})`);
      process.exit(1);
    }
    return { slug, kind: kind || 'internal', plan: plan || null, note: 'CLI --target' };
  });

// ─── 대상 정의 (slug 기준) — **우리 소유 워크스페이스만** ───
// slug 는 운영 실측값 (2026-08-17). 워프로랩은 두 곳 다 name 이 같아 slug 로만 구분된다.
//
// ★★ 테스터를 여기에 넣지 말 것 (Irene 지시 2026-08-17) ★★
//   "테스터는 솔루션 관리자가 지정을 해야지. 지금 가입해서 자동으로 스타터가 된 사람을
//    테스터라고 하면 어떻게 해?" / "내부 워크스페이스인지, 테스터인지 설정해야지."
//
//   **테스터는 지정하는 것이지 가입 상태에서 추론하는 것이 아니다.**
//   가입 직후 자동 부여된 스타터 체험이 만료된 것과, 우리가 테스터로 들인 것은 전혀 다르다.
//   추론으로 면제를 주면 ① 실고객이 조용히 무료가 되어 매출이 새고 ② 그 사람은 결제 없이
//   쓰는 것이 정상인 줄 알게 된다 — 나중에 되돌리면 그게 더 큰 사고다.
//
//   → 내부/테스터/파트너 구분은 platform_admin 이 **/admin/businesses 상세 → "면제 설정"**
//     에서 직접 고른다(구분·부여 플랜·종료일·사유). 누가 언제 지정했는지 AuditLog 에 남는다.
//     이 스크립트는 그 지정 화면을 대신하지 않는다. 여기엔 **우리 회사 워크스페이스만** 둔다.
const TARGETS = [
  { slug: '워프로랩-mon3zaui', kind: 'internal', plan: 'pro', note: '워프로랩 내부 워크스페이스 (Irene)' },
  { slug: '워프로랩-moqg29wi', kind: 'internal', plan: 'pro', note: '워프로랩 내부 워크스페이스 (lua)' },
];

const log = (...a) => console.log(...a);
const tag = APPLY ? '[APPLY]' : '[dry-run]';

async function main() {
  log(`\n${'='.repeat(70)}`);
  log(`결제 면제 백필 — ${APPLY ? '실제 적용' : 'DRY-RUN (아무것도 바꾸지 않음)'}`);
  log(`${'='.repeat(70)}\n`);

  // ── 0. 대상 확인 — slug 로 찾고 이름을 출력해 육안 대조 ──
  const all = await Business.findAll({
    attributes: ['id', 'name', 'slug', 'plan', 'subscription_status', 'billing_exempt', 'billing_exempt_kind'],
    order: [['id', 'ASC']],
  });
  log('── 전체 워크스페이스 ──');
  for (const b of all) {
    const mark = (CLI_TARGETS.length ? CLI_TARGETS : TARGETS).some(t => t.slug === b.slug) ? '★' : ' ';
    log(`${mark} #${b.id}  ${String(b.slug).padEnd(20)} ${String(b.name).padEnd(18)} plan=${String(b.plan).padEnd(10)} status=${String(b.subscription_status).padEnd(9)} exempt=${b.billing_exempt ? b.billing_exempt_kind : '-'}`);
  }

  const targets = CLI_TARGETS.length ? CLI_TARGETS : TARGETS;
  if (CLI_TARGETS.length) log(`\n(--target 로 지정된 ${CLI_TARGETS.length}건을 사용합니다 — 코드의 TARGETS 무시)`);

  const resolved = [];
  const missing = [];
  for (const t of targets) {
    const biz = all.find(b => b.slug === t.slug);
    if (biz) resolved.push({ ...t, id: biz.id, name: biz.name });
    else missing.push(t.slug);
  }
  log(`\n── 면제 대상 ${resolved.length}건 ──`);
  for (const r of resolved) log(`  #${r.id} ${r.name} (${r.slug}) → ${r.kind} / plan=${r.plan}`);
  if (missing.length) {
    log(`\n⚠ slug 를 찾지 못한 대상 ${missing.length}건: ${missing.join(', ')}`);
    log('  → 위 전체 목록에서 실제 slug 를 확인하고 TARGETS 를 고친 뒤 다시 실행하세요.');
    if (APPLY) { log('\n중단 — 대상이 불완전한 채로 적용하지 않습니다.'); process.exit(1); }
  }
  if (!resolved.length) { log('\n적용할 대상이 없습니다.'); process.exit(missing.length ? 1 : 0); }

  const ids = resolved.map(r => r.id);
  const internalIds = resolved.filter(r => r.kind === 'internal').map(r => r.id);

  // ── 1. 면제 설정 ──
  log(`\n── 1. 면제 설정 ──`);
  let changed1 = 0;
  for (const r of resolved) {
    const biz = await Business.findByPk(r.id);
    const same = !!biz.billing_exempt
      && biz.billing_exempt_kind === r.kind
      && biz.billing_exempt_plan === r.plan
      && biz.billing_exempt_until === null;
    if (same) { log(`  skip  #${r.id} ${r.name} — 이미 동일 설정`); continue; }
    log(`  ${tag} #${r.id} ${r.name} → exempt=1 kind=${r.kind} plan=${r.plan}`);
    if (APPLY) {
      await biz.update({
        billing_exempt: true,
        billing_exempt_kind: r.kind,
        billing_exempt_plan: r.plan,
        billing_exempt_until: null,
        billing_exempt_note: r.note,
        billing_exempt_set_at: new Date(),
      });
      planEngine.invalidateBusinessCache(r.id);
    }
    changed1 += 1;
  }

  // ── 2. 내부 워크스페이스의 기존 결제 → 비매출 ──
  // 테스터는 실제로 낸 돈이 있을 수 있으므로 internal 만 대상으로 한다.
  // refunded 도 포함 — 환불 행이 매출 통계에 음수로 남지 않게.
  log(`\n── 2. 내부 워크스페이스 기존 결제 → 비매출(is_revenue=0) ──`);
  let changed2 = 0;
  if (internalIds.length) {
    const rows = await Payment.findAll({
      where: { business_id: internalIds, status: ['paid', 'refunded'], is_revenue: true },
      order: [['id', 'ASC']],
    });
    if (!rows.length) log('  skip  대상 없음 (이미 전부 비매출)');
    for (const p of rows) {
      log(`  ${tag} payment #${p.id} biz=${p.business_id} ${p.currency} ${Number(p.amount).toLocaleString()} (${p.status}) → is_revenue=0`);
    }
    if (APPLY && rows.length) {
      await Payment.update({ is_revenue: false }, {
        where: { business_id: internalIds, status: ['paid', 'refunded'], is_revenue: true },
      });
    }
    changed2 = rows.length;
    const sum = rows.reduce((a, p) => a + Number(p.amount), 0);
    if (rows.length) log(`  → 합계 ${sum.toLocaleString()}원 이 매출에서 제외됩니다`);
  }

  // ── 3. 잔여 미결제 청구 취소 ──
  log(`\n── 3. 면제 워크스페이스 잔여 pending 청구 취소 ──`);
  const pendings = await Payment.findAll({ where: { business_id: ids, status: 'pending' }, order: [['id', 'ASC']] });
  if (!pendings.length) log('  skip  대상 없음');
  for (const p of pendings) {
    log(`  ${tag} payment #${p.id} biz=${p.business_id} ${Number(p.amount).toLocaleString()}원 → canceled`);
  }
  if (APPLY && pendings.length) {
    await Payment.update(
      { status: 'canceled', cancel_reason: 'billing_exempt' },
      { where: { business_id: ids, status: 'pending' } }
    );
  }

  // ── 4. 구독·워크스페이스 상태 정상화 ──
  // 구독 row 가 없거나 전부 canceled 인 곳(체험 만료 후 잠금된 테스터)도 Business 상태는 고쳐야 한다.
  log(`\n── 4. 구독·워크스페이스 상태 정상화 ──`);
  for (const r of resolved) {
    const alive = await Subscription.count({
      where: { business_id: r.id, status: ['pending', 'active', 'past_due', 'grace'] },
    });
    const biz = await Business.findByPk(r.id);
    const needsBiz = biz.subscription_status !== 'active' || biz.grace_ends_at !== null || biz.plan_expires_at !== null;
    if (!alive && !needsBiz) { log(`  skip  #${r.id} ${r.name} — 이미 정상`); continue; }
    log(`  ${tag} #${r.id} ${r.name} — 살아있는 구독 ${alive}건 · biz status=${biz.subscription_status} grace=${biz.grace_ends_at ? 'Y' : 'N'}`);
    if (APPLY) {
      const res = await billing.restoreExemptSubscription(r.id);
      log(`        → restored=${res.restored} subscription=${res.subscriptionId ?? '없음(Business 상태만 정상화)'}`);
    }
  }

  // ── 결과 ──
  log(`\n${'='.repeat(70)}`);
  if (!APPLY) {
    log('DRY-RUN 종료 — 아무것도 바꾸지 않았습니다.');
    log('실제 적용: node scripts/backfill-billing-exemption.js --apply');
  } else {
    log(`적용 완료 — 면제 ${changed1}건 · 비매출 마킹 ${changed2}건 · pending 취소 ${pendings.length}건`);
    log('재실행하면 전부 skip 되어야 합니다 (멱등 확인).');
  }
  log(`${'='.repeat(70)}\n`);
  await sequelize.close();
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
