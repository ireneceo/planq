#!/usr/bin/env node
// health-check `money` 카테고리 픽스처 러너 — docs/FIX_0AB_MONEY_DESIGN.md §5
//
//   사용: (cwd=/opt/planq/dev-backend) node /opt/planq/scripts/health-money.js <case> <token> <userId> <backend>
//   출력: 마지막 줄 '@@' + JSON { ok, detail } | { ok:false, error }
//
//   원칙
//   · 돈 픽스처는 **그 검사 안에서 새로 만드는 1회용 워크스페이스**만 건드린다(biz 상태를 canceled 로 만들어야 하므로).
//     끝나면 그 워크스페이스의 행을 전부 지운다(dropBiz). 다른 워크스페이스 데이터는 읽기만 한다.
//   · 각 검사는 **양성 대조군**(결함을 되살렸을 때 판정이 뒤집히는가)을 같이 잰다.
//   · 플랫폼 관리자 알림은 막는다(픽스처가 알림 행을 쌓지 않게). dev 메일 발송은 서버 설정으로 꺼져 있다.
'use strict';

const BE = '/opt/planq/dev-backend';
process.chdir(BE);
require(`${BE}/node_modules/dotenv`).config({ path: `${BE}/.env`, quiet: true });

const [, , CASE, TOKEN, USER_ID, BACKEND] = process.argv;
const userId = Number(USER_ID);

// 알림 차단 — billing.js 는 setImmediate 안에서 require('./platformNotify') 로 꺼내 쓴다(속성 교체가 먹는다)
const platformNotify = require(`${BE}/services/platformNotify`);
platformNotify.notifyPlatformAdmins = async () => null;

const M = require(`${BE}/models`);
const { sequelize } = require(`${BE}/config/database`);
const { Op } = require(`${BE}/node_modules/sequelize`);
const billing = require(`${BE}/services/billing`);
const crypto = require('crypto');

const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const made = [];

async function makeBiz(attrs = {}, { member = true } = {}) {
  const biz = await M.Business.create({
    name: `[health-money] ${stamp}`,
    slug: `hm-${stamp}-${made.length}`,
    owner_id: userId,
    plan: 'basic',
    subscription_status: 'active',
    ...attrs,
  });
  made.push(biz.id);
  if (member) await M.BusinessMember.create({ business_id: biz.id, user_id: userId, role: 'owner' });
  return biz;
}

async function dropBiz(id) {
  await sequelize.transaction(async (t) => {
    const q = (sql, rep = []) => sequelize.query(sql, { replacements: rep, transaction: t }).catch((e) => {
      if (process.env.HM_DEBUG) console.warn('[dropBiz]', sql.slice(0, 80), e.message);
    });
    await q('SET FOREIGN_KEY_CHECKS = 0');
    for (const tb of ['invoice_items', 'invoice_installments', 'invoice_payments', 'invoice_status_history']) {
      await q(`DELETE FROM \`${tb}\` WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = ?)`, [id]);
    }
    const [cols] = await sequelize.query(
      "SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'business_id' AND TABLE_NAME <> 'businesses'",
      { transaction: t },
    );
    for (const { t: tb } of cols) await q(`DELETE FROM \`${tb}\` WHERE business_id = ?`, [id]);
    await q('DELETE FROM businesses WHERE id = ?', [id]);
    await q('SET FOREIGN_KEY_CHECKS = 1');
  });
}

async function api(method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
async function pub(method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, raw: text };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const DAY = 86400e3;
const planPrice = (code, cycle = 'monthly') => Number(billing.getPlanPrice(code, cycle, 'KRW'));

// 잠금 상태 재현 — biz canceled · sub canceled(trial_expired_no_payment) · pay pending
async function lockedFixture(bizAttrs = {}) {
  const biz = await makeBiz({ plan: 'basic', subscription_status: 'canceled', trial_ends_at: new Date(Date.now() - 20 * DAY), ...bizAttrs });
  const sub = await M.Subscription.create({
    business_id: biz.id, plan_code: 'basic', cycle: 'monthly', status: 'canceled',
    cancel_reason: 'trial_expired_no_payment', canceled_at: new Date(), price: planPrice('basic'), currency: 'KRW', bonus_months: 0,
  });
  const pay = await M.Payment.create({
    business_id: biz.id, subscription_id: sub.id, kind: 'plan', method: 'bank_transfer', status: 'pending',
    amount: planPrice('basic'), currency: 'KRW', cycle: 'monthly',
  });
  return { biz, sub, pay };
}

async function expectConflict(paymentId, code) {
  try {
    await billing.markPaymentPaid({ paymentId, markedByUserId: userId, source: 'manual' });
  } catch (e) {
    if (e.code === code && e.statusCode === 409) return true;
    throw new Error(`기대 409 ${code} 인데 ${e.statusCode || '?'} ${e.code || e.message}`);
  }
  throw new Error(`기대 409 ${code} 인데 확정이 통과했다`);
}

function validBizNo(prefix9) {
  const d = String(prefix9).padStart(9, '0').slice(0, 9);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return d + String((10 - (sum % 10)) % 10);
}

const cases = {
  // 잔여 정리 — 시간 초과로 죽은 이전 실행이 남긴 1회용 워크스페이스(이름 접두어 + 10분 지난 것)만 지운다.
  async sweep() {
    const rows = await M.Business.findAll({
      where: { name: { [Op.like]: '[health-money]%' }, created_at: { [Op.lt]: new Date(Date.now() - 10 * 60e3) } },
      attributes: ['id'],
    });
    for (const r of rows) await dropBiz(r.id);
    return `잔여 ${rows.length}건 정리`;
  },

  // ─── money-1: 청구서 공개 링크 cron (A-①) ───
  async m1() {
    const { cleanupInvoiceTokens } = require(`${BE}/services/shareTokenCleanup`);
    const biz = await makeBiz({}, { member: false });
    // 기준 시각을 2001-01-01 로 둬서 픽스처만 대상이 되게 한다(dev 의 다른 청구서는 updated_at 이 그 뒤라 안 걸린다)
    const now = new Date('2001-01-01T00:00:00Z');
    const ago = (d) => new Date(now.getTime() - d * DAY);
    const spec = {
      sent: ['sent', ago(40), null, ago(40)],
      overdue: ['overdue', ago(40), null, ago(40)],
      partial: ['partially_paid', ago(40), null, ago(40)],
      canceled: ['canceled', ago(40), null, null],
      paidOld: ['paid', ago(200), ago(200), ago(220)],
      paidRecent: ['paid', ago(10), ago(10), ago(30)],
      paidNoDate: ['paid', ago(200), null, ago(220)],
      draftUnsent: ['draft', ago(40), null, null],
    };
    const ids = {};
    let n = 0;
    for (const [k, [status, upd, paidAt, sentAt]] of Object.entries(spec)) {
      n += 1;
      const inv = await M.Invoice.create({
        business_id: biz.id, invoice_number: `HM-${stamp}-${n}`, title: `[hm] ${k}`, created_by: userId,
        status, share_token: crypto.randomBytes(16).toString('hex'),
      });
      await sequelize.query('UPDATE invoices SET updated_at = ?, paid_at = ?, sent_at = ?, issued_at = ? WHERE id = ?',
        { replacements: [upd, paidAt, sentAt, sentAt || upd, inv.id] });
      ids[k] = inv.id;
    }
    const tokenOf = async () => {
      const rows = await M.Invoice.findAll({ where: { id: Object.values(ids) }, attributes: ['id', 'share_token'] });
      const m = new Map(rows.map((r) => [r.id, r.share_token]));
      return Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, !!m.get(id)]));
    };
    // 양성 대조군 — 옛 where(updated_at 단독)를 트랜잭션 안에서 돌려 sent 가 지워지는 것을 보고 되돌린다
    const oldKills = await sequelize.transaction(async (t) => {
      await M.Invoice.update({ share_token: null }, {
        where: { id: Object.values(ids), share_token: { [Op.ne]: null }, updated_at: { [Op.lt]: new Date(now.getTime() - 30 * DAY) } },
        transaction: t,
      });
      const r = await M.Invoice.findByPk(ids.sent, { attributes: ['share_token'], transaction: t });
      const killed = !r.share_token;
      throw Object.assign(new Error('rollback'), { killed });
    }).catch((e) => e.killed);
    assert(oldKills === true, '양성 대조군 실패 — 옛 where 로도 sent 토큰이 살아 있다(픽스처가 결함을 재현하지 못함)');
    await cleanupInvoiceTokens(now);
    const after = await tokenOf();
    const want = { sent: true, overdue: true, partial: true, canceled: false, paidOld: false, paidRecent: true, paidNoDate: false, draftUnsent: false };
    const bad = Object.keys(want).filter((k) => after[k] !== want[k]);
    assert(!bad.length, `토큰 판정 불일치: ${bad.map((k) => `${k}=${after[k] ? '있음' : '없음'}(기대 ${want[k] ? '있음' : '없음'})`).join(', ')}`);
    return 'sent·overdue·partial·paid(10일) 유지 · canceled·paid(200일)·paid(paid_at 없음)·미발송 draft 정리 · 옛 where 는 sent 를 지움(대조군)';
  },

  // ─── money-2: 잠긴 워크스페이스 되살림 (A-②) ───
  async m2() {
    const out = [];
    // 정상 — /status 가 그 pay 를 보여주고 확정하면 되살아난다
    {
      const { biz, sub, pay } = await lockedFixture();
      const st = await api('GET', `/api/plan/${biz.id}/status`);
      assert(st.status === 200, `/status ${st.status}`);
      const pp = st.data.data && st.data.data.pending_payment;
      assert(pp && pp.id === pay.id, `/status pending_payment 가 그 결제가 아니다: ${pp ? pp.id : null} (기대 ${pay.id})`);
      const r = await billing.markPaymentPaid({ paymentId: pay.id, markedByUserId: userId, source: 'manual' });
      assert(r && r.payment && r.payment.status === 'paid', '확정 실패');
      const b = await M.Business.findByPk(biz.id); const s = await M.Subscription.findByPk(sub.id);
      assert(b.subscription_status === 'active', `biz.subscription_status=${b.subscription_status}`);
      assert(s.status === 'active' && s.started_at, `sub=${s.status} started_at=${s.started_at}`);
      assert(!s.cancel_reason, `cancel_reason 남음: ${s.cancel_reason}`);
      const [[a]] = await sequelize.query("SELECT new_value FROM audit_logs WHERE action='payment.paid' AND target_id=? ORDER BY id DESC LIMIT 1", { replacements: [pay.id] });
      const nv = a ? (typeof a.new_value === 'string' ? JSON.parse(a.new_value) : a.new_value) : null;
      assert(nv && nv.revived === true, `감사 행 revived=${nv && nv.revived}`);
      out.push('잠금 고아 결제 → /status 노출 · 확정 → biz active · sub active(started_at) · 감사 revived');
    }
    // 대조군 1 — replaced 구독은 되살리지 않는다
    {
      const { sub, pay } = await lockedFixture();
      await sub.update({ status: 'replaced', cancel_reason: null });
      await expectConflict(pay.id, 'subscription_superseded');
      out.push('replaced → 409 subscription_superseded');
    }
    // 대조군 2 — 그 사이 플랜이 바뀌었으면 거절
    {
      const { biz, pay } = await lockedFixture();
      await biz.update({ plan: 'pro' });
      await expectConflict(pay.id, 'plan_mismatch');
      out.push('플랜 변경 → 409 plan_mismatch');
    }
    // 대조군 3 — 살아 있는 pending 구독이 생기면 /status 는 새 것을, 옛 것 확정은 409
    {
      const { biz, pay } = await lockedFixture();
      const sub2 = await M.Subscription.create({ business_id: biz.id, plan_code: 'basic', cycle: 'monthly', status: 'pending', price: planPrice('basic'), currency: 'KRW', bonus_months: 0 });
      const pay2 = await M.Payment.create({ business_id: biz.id, subscription_id: sub2.id, kind: 'plan', method: 'bank_transfer', status: 'pending', amount: planPrice('basic'), currency: 'KRW', cycle: 'monthly' });
      const st = await api('GET', `/api/plan/${biz.id}/status`);
      const pp = st.data.data && st.data.data.pending_payment;
      assert(pp && pp.id === pay2.id, `/status 가 새 pending 을 고르지 않았다: ${pp ? pp.id : null} (기대 ${pay2.id})`);
      await expectConflict(pay.id, 'subscription_superseded');
      out.push('후계 pending 있음 → /status 새 것 · 옛 것 409');
    }
    return out.join(' · ');
  },

  // ─── money-3: 애드온 pending 은 플랜 결제창을 열지 않는다 (A-②) ───
  async m3() {
    const biz = await makeBiz({ plan: 'basic', subscription_status: 'active' });
    await M.Payment.create({ business_id: biz.id, subscription_id: null, kind: 'addon', addon_code: 'member', addon_quantity: 1, method: 'bank_transfer', status: 'pending', amount: 4900, currency: 'KRW', cycle: 'monthly' });
    // 양성 대조군 — 옛 쿼리(kind 미필터)는 애드온을 잡는다
    const old = await M.Payment.findOne({ where: { business_id: biz.id, status: 'pending' }, order: [['created_at', 'DESC']] });
    assert(old && old.kind === 'addon', '양성 대조군 실패 — 옛 쿼리가 애드온을 못 잡았다(픽스처 불량)');
    const st = await api('GET', `/api/plan/${biz.id}/status`);
    assert(st.status === 200, `/status ${st.status}`);
    assert(st.data.data.pending_payment === null, `pending_payment 가 null 이 아니다: ${JSON.stringify(st.data.data.pending_payment)}`);
    return '애드온 pending 만 있음 → pending_payment null (옛 쿼리는 애드온을 잡음)';
  },

  // ─── money-4: 예약 다운그레이드 적용 (A-③) ───
  async m4() {
    const out = [];
    const mkActive = async (bizAttrs) => {
      const biz = await makeBiz({ plan: 'basic', subscription_status: 'past_due', ...bizAttrs });
      const sub = await M.Subscription.create({
        business_id: biz.id, plan_code: 'basic', cycle: 'monthly', status: 'past_due', price: planPrice('basic'), currency: 'KRW', bonus_months: 0,
        started_at: new Date(Date.now() - 40 * DAY), current_period_start: new Date(Date.now() - 32 * DAY), current_period_end: new Date(Date.now() - 2 * DAY),
      });
      return { biz, sub };
    };
    {
      const { biz, sub } = await mkActive({ scheduled_plan: 'starter' });
      const r1 = await billing.ensureRenewalPayment(sub);
      const r2 = await billing.ensureRenewalPayment(sub);
      assert(r1.payment && r1.created, `갱신 청구 생성 안 됨: ${JSON.stringify(r1.skipped || null)}`);
      assert(r2.payment && r2.payment.id === r1.payment.id && !r2.created, '두 번째 호출이 새 결제를 만들었다(멱등 깨짐)');
      const tsub = await M.Subscription.findByPk(r1.payment.subscription_id);
      assert(tsub.plan_code === 'starter' && tsub.status === 'pending', `대상 구독 ${tsub.plan_code}/${tsub.status}`);
      assert(Number(r1.payment.amount) === planPrice('starter'), `금액 ${r1.payment.amount} ≠ starter ${planPrice('starter')}`);
      const cnt = await M.Payment.count({ where: { business_id: biz.id, status: 'pending' } });
      assert(cnt === 1, `pending 결제 ${cnt}건`);
      await billing.markPaymentPaid({ paymentId: r1.payment.id, markedByUserId: userId, source: 'manual' });
      const b = await M.Business.findByPk(biz.id); const old = await M.Subscription.findByPk(sub.id);
      assert(b.plan === 'starter', `biz.plan=${b.plan}`);
      assert(b.scheduled_plan === null, `scheduled_plan=${b.scheduled_plan}`);
      assert(old.status === 'replaced', `옛 basic 구독=${old.status}`);
      out.push('예약 starter → pending 구독(starter) + starter 가격 · 2회 호출 1건 · 확정 → plan starter · 예약 NULL · 옛 구독 replaced');
    }
    // 대조군 — 예약 없으면 기존 구독에 basic 가격
    {
      const { sub } = await mkActive({ scheduled_plan: null });
      const r = await billing.ensureRenewalPayment(sub);
      assert(r.payment && r.payment.subscription_id === sub.id && Number(r.payment.amount) === planPrice('basic'), `예약 없음: sub ${r.payment && r.payment.subscription_id} 금액 ${r.payment && r.payment.amount}`);
      out.push('예약 없음 → 같은 구독 basic 가격');
    }
    // 대조군 — 같은 플랜 갱신 확정은 예약을 지우지 않는다(다음 사이클로 넘김)
    {
      const { biz, sub } = await mkActive({ scheduled_plan: null });
      const r = await billing.ensureRenewalPayment(sub);
      await biz.update({ scheduled_plan: 'starter' });
      await billing.markPaymentPaid({ paymentId: r.payment.id, markedByUserId: userId, source: 'manual' });
      const b = await M.Business.findByPk(biz.id);
      assert(b.plan === 'basic' && b.scheduled_plan === 'starter', `같은 플랜 갱신 후 plan=${b.plan} scheduled=${b.scheduled_plan}`);
      out.push('같은 플랜 갱신 확정 → 예약 유지');
    }
    return out.join(' · ');
  },

  // ─── money-5: 애드온 갱신 합산 (A-④) ───
  async m5() {
    const out = [];
    const mk = async (cycle, addons) => {
      const biz = await makeBiz({ plan: 'basic', subscription_status: 'past_due', ...addons });
      const sub = await M.Subscription.create({
        business_id: biz.id, plan_code: 'basic', cycle, status: 'past_due', price: planPrice('basic', cycle), currency: 'KRW', bonus_months: 0,
        started_at: new Date(Date.now() - 400 * DAY), current_period_end: new Date(Date.now() - 2 * DAY),
      });
      return billing.ensureRenewalPayment(sub);
    };
    const addonMonthly = 2 * 4900 + 4900;
    {
      const r = await mk('monthly', { addon_members: 2, addon_cue_actions: 1000 });
      const want = planPrice('basic') + addonMonthly;
      assert(r.payment && Number(r.payment.amount) === want, `월간 금액 ${r.payment && r.payment.amount} ≠ ${want}`);
      const li = r.payment.line_items;
      assert(Array.isArray(li) && li.length === 3, `line_items ${JSON.stringify(li)}`);
      out.push(`월간 ${want} (플랜 + 2×4,900 + 4,900) · 3줄`);
    }
    {
      const r = await mk('yearly', { addon_members: 2, addon_cue_actions: 1000 });
      const want = planPrice('basic', 'yearly') + addonMonthly * 12;
      assert(r.payment && Number(r.payment.amount) === want, `연간 금액 ${r.payment && r.payment.amount} ≠ ${want}`);
      out.push(`연간 ${want} (애드온 ×12)`);
    }
    {
      const r = await mk('monthly', {});
      assert(r.payment && Number(r.payment.amount) === planPrice('basic') && r.payment.line_items.length === 1, `애드온 0: ${r.payment && r.payment.amount} · ${JSON.stringify(r.payment && r.payment.line_items)}`);
      out.push('애드온 0 → 플랜 가격 그대로 · 1줄');
    }
    return out.join(' · ');
  },

  // ─── money-6: 체험 잔여일 승계 (A-⑤) ───
  async m6() {
    const out = [];
    {
      const trialEnd = new Date(Date.now() + 10 * DAY);
      const biz = await makeBiz({ plan: 'basic', subscription_status: 'trialing', trial_ends_at: trialEnd });
      const co = await api('POST', `/api/plan/${biz.id}/checkout`, { plan_code: 'basic', cycle: 'monthly' });
      assert(co.status === 200, `/checkout ${co.status} ${JSON.stringify(co.data).slice(0, 200)}`);
      const d = co.data.data;
      assert(d.trial_days_carried === 10, `trial_days_carried=${d.trial_days_carried}`);
      assert(d.period_end_preview, 'period_end_preview 없음');
      const st = await api('GET', `/api/plan/${biz.id}/status`);
      const pp = st.data.data.pending_payment;
      assert(pp && pp.id === d.payment_id && pp.trial_days_carried === 10 && pp.period_end_preview, `/status pending 미리보기 ${JSON.stringify(pp)}`);
      await billing.markPaymentPaid({ paymentId: d.payment_id, markedByUserId: userId, source: 'manual' });
      const sub = await M.Subscription.findByPk(d.subscription_id);
      const b = await M.Business.findByPk(biz.id);
      const te = new Date(b.trial_ends_at).getTime();
      assert(new Date(sub.current_period_start).getTime() === te, `period_start ${sub.current_period_start} ≠ trial_ends_at ${b.trial_ends_at}`);
      const wantEnd = billing.computePeriodEnd(new Date(te), 'monthly', 0).getTime();
      assert(new Date(sub.current_period_end).getTime() === wantEnd, `period_end ${sub.current_period_end} ≠ ${new Date(wantEnd).toISOString()}`);
      assert(Math.abs(new Date(d.period_end_preview).getTime() - wantEnd) < 1000, `미리보기 ${d.period_end_preview} ≠ 확정 ${new Date(wantEnd).toISOString()}`);
      out.push('체험 +10일 → carried 10 · 시작=체험 끝 · 미리보기 == 확정 끝');
    }
    // 대조군 — 체험이 이미 끝났으면 now 시작(carried 0)
    {
      const biz = await makeBiz({ plan: 'basic', subscription_status: 'trialing', trial_ends_at: new Date(Date.now() - 1 * DAY) });
      const co = await api('POST', `/api/plan/${biz.id}/checkout`, { plan_code: 'basic', cycle: 'monthly' });
      assert(co.status === 200, `/checkout ${co.status}`);
      assert(co.data.data.trial_days_carried === 0, `carried=${co.data.data.trial_days_carried}`);
      const t0 = Date.now();
      await billing.markPaymentPaid({ paymentId: co.data.data.payment_id, markedByUserId: userId, source: 'manual' });
      const sub = await M.Subscription.findByPk(co.data.data.subscription_id);
      assert(Math.abs(new Date(sub.current_period_start).getTime() - t0) < 60e3, `지난 체험인데 시작=${sub.current_period_start}`);
      out.push('지난 체험 → carried 0 · now 시작');
    }
    return out.join(' · ');
  },

  // ─── money-7: 통화별 금액 (B-①) ───
  async m7() {
    const { toMinorUnits } = require(`${BE}/services/money`);
    const biz = await makeBiz({ plan: 'basic', subscription_status: 'active' });
    const [[col]] = await sequelize.query("SHOW COLUMNS FROM invoices LIKE 'grand_total'");
    assert(String(col.Type).toLowerCase() === 'decimal(14,2)', `invoices.grand_total 형식 ${col.Type}`);
    const usd = await api('POST', `/api/invoices/${biz.id}`, {
      title: '[hm] usd', currency: 'USD', vat_rate: 0.1, items: [{ description: 'x', quantity: 1, unit_price: 99.99 }],
      installment_mode: 'split', installments: [{ label: 'a', percent: 33.33 }, { label: 'b', percent: 33.33 }, { label: 'c', percent: 33.34 }],
    });
    assert(usd.status === 201, `USD 생성 ${usd.status} ${JSON.stringify(usd.data).slice(0, 200)}`);
    const g = await api('GET', `/api/invoices/${biz.id}/${usd.data.data.id}`);
    const inv = g.data.data;
    assert(Number(inv.grand_total) === 109.99 && Number(inv.tax_amount) === 10, `USD 재조회 grand ${inv.grand_total} tax ${inv.tax_amount}`);
    const instSum = Math.round((inv.installments || []).reduce((s, i) => s + Number(i.amount), 0) * 100) / 100;
    assert(instSum === 109.99, `회차 합 ${instSum} ≠ 109.99`);
    assert(toMinorUnits(109.99, 'USD') === 10999 && toMinorUnits(9999, 'KRW') === 9999, 'toMinorUnits');
    const krw = await api('POST', `/api/invoices/${biz.id}`, { title: '[hm] krw', currency: 'KRW', vat_rate: 0.1, items: [{ description: 'x', quantity: 1, unit_price: 9999.4 }] });
    assert(krw.status === 201, `KRW 생성 ${krw.status}`);
    const k = (await api('GET', `/api/invoices/${biz.id}/${krw.data.data.id}`)).data.data;
    assert(Number(k.items[0].unit_price) === 9999 && Number(k.total_amount) === 9999 && Number(k.grand_total) === 10999, `KRW 단가 ${k.items[0].unit_price} 소계 ${k.total_amount} 합계 ${k.grand_total}`);
    const bad = await api('POST', `/api/invoices/${biz.id}`, { title: '[hm] neg', currency: 'KRW', items: [{ description: 'x', quantity: 1, unit_price: -5 }] });
    assert(bad.status === 400, `음수 단가가 ${bad.status}`);
    // 양성 대조군 — 옛 공식(정수 컬럼 + Math.round)이면 같은 입력이 110 이 된다(판정이 갈리는 입력인지 확인)
    const oldTotal = Math.round(99.99) + Math.round(Math.round(99.99) * 0.1);
    assert(oldTotal !== 109.99, '대조 입력이 판정을 가르지 못한다');
    return `USD 99.99 → 합계 109.99 · VAT 10.00 · 회차 합 109.99 · Stripe 10999 · KRW 9999.4 → 9999 · 음수 400 (옛 공식 ${oldTotal})`;
  },

  // ─── money-8: 번호 — 워크스페이스 축 + 동시성 (B-②) ───
  async m8() {
    const fs = require('fs');
    const path = require('path');
    const year = new Date().getFullYear();
    const a = await makeBiz(); const b = await makeBiz();
    const ra = await api('POST', `/api/invoices/${a.id}`, { title: '[hm] a' });
    const rb = await api('POST', `/api/invoices/${b.id}`, { title: '[hm] b' });
    assert(ra.status === 201 && rb.status === 201, `첫 생성 ${ra.status}/${rb.status}`);
    assert(ra.data.data.invoice_number === `INV-${year}-0001` && rb.data.data.invoice_number === `INV-${year}-0001`, `첫 번호 ${ra.data.data.invoice_number} / ${rb.data.data.invoice_number}`);
    const many = await Promise.all(Array.from({ length: 6 }, (_, i) => api('POST', `/api/invoices/${a.id}`, { title: `[hm] c${i}` })));
    assert(many.every((r) => r.status === 201), `동시 6건 상태 ${many.map((r) => r.status).join(',')}`);
    const nums = many.map((r) => Number(r.data.data.invoice_number.split('-').pop())).sort((x, y) => x - y);
    assert(new Set(nums).size === 6 && nums[0] === 2 && nums[5] === 7, `동시 6건 번호 ${nums.join(',')}`);
    // 기존 번호가 있는 워크스페이스(카운터 없음) → MAX+1
    const c = await makeBiz();
    await M.Invoice.create({ business_id: c.id, invoice_number: `INV-${year}-0042`, title: '[hm] legacy', created_by: userId });
    const rc = await api('POST', `/api/invoices/${c.id}`, { title: '[hm] next' });
    assert(rc.status === 201 && rc.data.data.invoice_number === `INV-${year}-0043`, `이어가기 ${rc.status} ${rc.data.data && rc.data.data.invoice_number}`);
    // 소스 — 'INV-${' 번호 생성이 services/invoiceNumber.js 밖에 0곳
    const roots = [`${BE}/routes`, `${BE}/services`];
    const hits = [];
    for (const r of roots) {
      for (const f of fs.readdirSync(r, { recursive: true })) {
        const p = path.join(r, String(f));
        if (!p.endsWith('.js') || p.endsWith('services/invoiceNumber.js')) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (/INV-\$\{/.test(src)) hits.push(p.replace(`${BE}/`, ''));
      }
    }
    assert(!hits.length, `번호 생성이 한 곳 밖에 있다: ${hits.join(', ')}`);
    // 양성 대조군 — 카운터 없이(옛 방식: MAX 스캔 후 INSERT) 동시 6건을 만들면 충돌·중복이 난다
    let reproduced = false;
    for (let round = 0; round < 3 && !reproduced; round += 1) {
      const d = await makeBiz({}, { member: false });
      const oldWay = async (i) => {
        const rows = await M.Invoice.findAll({ where: { business_id: d.id, invoice_number: { [Op.like]: `INV-${year}-%` } }, attributes: ['invoice_number'] });
        let max = 0; for (const r of rows) { const m = /-(\d+)$/.exec(r.invoice_number); if (m) max = Math.max(max, Number(m[1])); }
        await new Promise((res) => setTimeout(res, 5));
        return M.Invoice.create({ business_id: d.id, invoice_number: `INV-${year}-${String(max + 1).padStart(4, '0')}`, title: `[hm] old${i}`, created_by: userId });
      };
      const rs = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => oldWay(i)));
      reproduced = rs.some((r) => r.status === 'rejected');
    }
    assert(reproduced, '양성 대조군 실패 — 카운터 없는 동시 생성이 충돌을 재현하지 못했다');
    return `두 워크스페이스 첫 번호 둘 다 0001 · 동시 6건 0002~0007 · 기존 0042 → 0043 · 생성 지점 1곳 · 옛 방식은 동시 충돌(대조군)`;
  },

  // ─── money-9: client_id · project_id 테넌트 검증 (B-③) ───
  async m9() {
    const mine = await makeBiz(); const other = await makeBiz({}, { member: false });
    const ins = async (sql, rep) => { const [id] = await sequelize.query(sql, { replacements: rep }); return id; };
    const myClient = await ins('INSERT INTO clients (business_id, display_name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [mine.id, '[hm] mine']);
    const otherClient = await ins('INSERT INTO clients (business_id, display_name, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [other.id, '[hm] other']);
    const otherProject = await ins('INSERT INTO projects (business_id, name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())', [other.id, '[hm] other', userId]);
    const r1 = await api('POST', `/api/invoices/${mine.id}`, { title: '[hm] x', client_id: otherClient });
    assert(r1.status === 400 && r1.data.message === 'client_not_in_workspace', `남의 client_id → ${r1.status} ${r1.data.message}`);
    const r2 = await api('POST', `/api/invoices/${mine.id}`, { title: '[hm] x', project_id: otherProject });
    assert(r2.status === 400 && r2.data.message === 'project_not_in_workspace', `남의 project_id → ${r2.status} ${r2.data.message}`);
    const ok = await api('POST', `/api/invoices/${mine.id}`, { title: '[hm] ok', client_id: myClient });
    assert(ok.status === 201, `자기 고객 → ${ok.status}`);
    const r3 = await api('PUT', `/api/invoices/${mine.id}/${ok.data.data.id}`, { title: '[hm] ok', client_id: otherClient });
    assert(r3.status === 400 && r3.data.message === 'client_not_in_workspace', `PUT 남의 client_id → ${r3.status} ${r3.data.message}`);
    const r4 = await api('PUT', `/api/invoices/${mine.id}/${ok.data.data.id}`, { title: '[hm] ok2', client_id: myClient });
    assert(r4.status === 200, `PUT 자기 고객 → ${r4.status}`);
    const left = await M.Invoice.count({ where: { business_id: mine.id } });
    assert(left === 1, `거절된 생성이 행을 남겼다: ${left}건`);
    return 'POST 남의 고객 400 · 남의 프로젝트 400 · PUT 남의 고객 400 · 자기 것 201/200 · 거절 시 행 0';
  },

  // ─── money-10: 공개 증빙 제출은 고객 마스터를 고치지 않는다 (B-⑤) ───
  async m10() {
    const e = await makeBiz(); const f = await makeBiz({}, { member: false });
    const ins = async (sql, rep) => { const [id] = await sequelize.query(sql, { replacements: rep }); return id; };
    const cx = await ins("INSERT INTO clients (business_id, display_name, biz_name, tax_invoice_email, is_business, created_at, updated_at) VALUES (?, '[hm] 같은이름', '원래상호', 'orig@hm.invalid', 1, NOW(), NOW())", [e.id]);
    const cy = await ins("INSERT INTO clients (business_id, display_name, biz_name, is_business, created_at, updated_at) VALUES (?, '[hm] 같은이름', '다른회사', 1, NOW(), NOW())", [f.id]);
    const mkInv = async (biz, client, n) => M.Invoice.create({
      business_id: biz, client_id: client, invoice_number: `HM-${stamp}-${n}`, title: '[hm] r', created_by: userId,
      status: 'sent', sent_at: new Date(), share_token: crypto.randomBytes(16).toString('hex'),
    });
    const i1 = await mkInv(e.id, cx, 1); const i2 = await mkInv(e.id, cx, 2); const i3 = await mkInv(f.id, cy, 3);
    const snap = async (id) => JSON.stringify((await sequelize.query('SELECT * FROM clients WHERE id = ?', { replacements: [id] }))[0][0]);
    const before = await snap(cx);
    const profile = { biz_type: 'business', biz_name: '제출상호', biz_tax_id: validBizNo('123456789'), biz_ceo: '홍길동', tax_email: 'submit@hm.invalid' };
    // 대조군 전제 — 제출값이 마스터와 달라야 «안 바뀜» 이 판정을 가른다
    assert(!before.includes('제출상호') && !before.includes('submit@hm.invalid'), '대조 전제 실패 — 제출값이 이미 마스터에 있다');
    const r = await pub('POST', `/api/invoices/public/${i1.share_token}/receipt-request`, profile);
    assert(r.status === 200, `제출 ${r.status} ${r.raw.slice(0, 200)}`);
    const after = await snap(cx);
    assert(before === after, '공개 제출이 고객 마스터(clients)를 바꿨다');
    const saved = await M.Invoice.findByPk(i1.id);
    assert(saved.receipt_profile && saved.receipt_profile.biz_name === '제출상호', 'receipt_profile 미저장');
    const g2 = await pub('GET', `/api/invoices/public/${i2.share_token}`);
    const rc2 = g2.data.data.receipt;
    assert(rc2.profile_source === 'history' && rc2.profile && rc2.profile.biz_name === '제출상호', `두 번째 청구서 prefill ${rc2.profile_source} ${rc2.profile && rc2.profile.biz_name}`);
    const g3 = await pub('GET', `/api/invoices/public/${i3.share_token}`);
    const rc3 = g3.data.data.receipt;
    assert(rc3.profile_source !== 'history' && !(rc3.profile && rc3.profile.biz_name === '제출상호'), `다른 워크스페이스가 제출본을 받았다: ${rc3.profile_source}`);
    return '제출 전후 clients 행 동일 · receipt_profile 저장 · 같은 고객 다음 청구서 = 제출본(history) · 다른 워크스페이스 같은 이름 고객은 안 받음';
  },

  // ─── secrets-4: 공개 청구서 응답에 출처 문서 토큰이 없다 (B-④) ───
  async s4() {
    const biz = await makeBiz({}, { member: false });
    const postTok = `hmpost${crypto.randomBytes(12).toString('hex')}`;
    const [postId] = await sequelize.query("INSERT INTO posts (business_id, title, author_id, status, share_token, created_at, updated_at) VALUES (?, '[hm] 출처문서', ?, 'published', ?, NOW(), NOW())", { replacements: [biz.id, userId, postTok] });
    const inv = await M.Invoice.create({
      business_id: biz.id, invoice_number: `HM-${stamp}-s4`, title: '[hm] s4', created_by: userId, status: 'sent', sent_at: new Date(),
      share_token: crypto.randomBytes(16).toString('hex'), source_post_id: postId,
    });
    const r = await pub('GET', `/api/invoices/public/${inv.share_token}`);
    assert(r.status === 200, `공개 GET ${r.status}`);
    assert(!r.raw.includes(postTok), '공개 청구서 응답 원문에 출처 문서 공유 토큰이 있다');
    assert(r.data.data.source_post && r.data.data.source_post.title === '[hm] 출처문서', '출처 문서 제목이 없다 — 응답이 비었을 가능성(거짓 통과)');
    return '원문에 문서 토큰 0 · source_post.title 유지';
  },
};

(async () => {
  let result;
  try {
    if (!cases[CASE]) throw new Error(`알 수 없는 케이스 ${CASE}`);
    if (!TOKEN || !userId || !BACKEND) throw new Error('인자 부족(token·userId·backend)');
    const detail = await cases[CASE]();
    result = { ok: true, detail };
  } catch (e) {
    result = { ok: false, error: e.message };
  } finally {
    for (const id of made) {
      try { await dropBiz(id); } catch (e) { result = result || {}; result.cleanup_error = `${id}: ${e.message}`; }
    }
  }
  process.stdout.write(`\n@@${JSON.stringify(result)}\n`);
  setTimeout(() => process.exit(0), 300);   // setImmediate 알림 루프가 남아도 끝낸다(알림은 위에서 막았다)
})();
