// 카드 결제 «환불 기록» 되돌리기 — Stripe 에서 돈이 안 나갔는데 PlanQ 에 «환불» 로만 적힌 결제를 «결제 완료» 로 되돌린다.
//   2026-11-03 Irene «한수정 거 환불 안한걸로 바꿔서 제대로 플랫폼에서 따라 하게» — 확인 없이 기록만 하던 길(a74d5ef8 이전)로
//   적힌 건을 되돌려, 관리자가 결제 이력 처리 창의 «Stripe 에서 직접 환불하는 순서» 를 따라 다시 처리하게 한다.
//
//   사용:  node scripts/revert-card-refund-record.js --find=<이름·이메일·워크스페이스 일부>   (읽기만 — 후보 목록)
//          node scripts/revert-card-refund-record.js --payment=<id>                        (읽기만 — 바뀔 내용)
//          node scripts/revert-card-refund-record.js --payment=<id> --apply                (쓰기)
//
//   되돌리는 것: 결제 status refunded → paid · refunded_at·refund_reason·refund_kind 비움. 환불 요청(refund_requested_at)은 그대로라
//     요청이 있던 건은 «환불 요청» 탭에 다시 뜬다. 감사 payment.refund_record_reverted 에 옛 값을 남긴다.
//   되돌리지 않는 것: 그때 같이 바뀐 구독 해지·무료 전환·체험 복귀·애드온 한도 회수(돈이 아니라 서비스 상태라 그대로 둔다 —
//     다시 처리할 때 이미 해지된 구독은 다시 해지되지 않는다. 애드온은 출력의 안내대로 «구독은 유지» 를 체크해야 두 번 안 줄어든다).
//   거절: 카드 결제가 아님 · 환불 상태가 아님 · Stripe 환불 번호(stripe_refund_id)가 있음(그건 Stripe 에서 실제로 돌려준 건이다).
require('dotenv').config({ quiet: true });
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Payment, Business, User, AuditLog } = require('../models');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const APPLY = process.argv.includes('--apply');
const isCard = (p) => p.method === 'stripe' || p.method === 'card';
const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

async function find(q) {
  const like = { [Op.like]: `%${q}%` };
  const owners = await User.findAll({ where: { [Op.or]: [{ name: like }, { email: like }] }, attributes: ['id'] });
  const bizs = await Business.findAll({
    where: { [Op.or]: [{ name: like }, { brand_name: like }, ...(owners.length ? [{ owner_id: owners.map((u) => u.id) }] : [])] },
    attributes: ['id', 'name', 'brand_name', 'owner_id'],
  });
  if (!bizs.length) { console.log('찾는 워크스페이스 없음'); return; }
  const pays = await Payment.findAll({ where: { business_id: bizs.map((b) => b.id) }, order: [['id', 'DESC']], limit: 30 });
  const byBiz = new Map(bizs.map((b) => [b.id, b.brand_name || b.name]));
  for (const p of pays) {
    console.log(`#${p.id} · ${byBiz.get(p.business_id)} · ${p.kind} · ${p.method} · ${p.currency} ${Number(p.amount)} · ${p.status}` +
      ` · 결제번호 ${p.stripe_payment_intent ? p.stripe_payment_intent.slice(0, 8) + '…' : '없음'} · Stripe 환불 ${p.stripe_refund_id || '없음'}` +
      ` · 환불 ${p.refunded_at ? new Date(p.refunded_at).toISOString() : '-'} · 요청 ${p.refund_requested_at ? '있음' : '없음'}`);
  }
}

async function revert(id) {
  const p = await Payment.findByPk(id);
  if (!p) throw new Error(`결제 #${id} 없음`);
  const biz = await Business.findByPk(p.business_id, { attributes: ['id', 'name', 'brand_name', 'plan', 'subscription_status'] });
  console.log(`결제 #${p.id} · ${biz ? (biz.brand_name || biz.name) : p.business_id} · ${p.kind} · ${p.method} · ${p.currency} ${Number(p.amount)} · ${p.status}`);
  if (!isCard(p)) throw new Error('카드 결제가 아님 — 되돌리지 않는다');
  if (p.status !== 'refunded') throw new Error(`환불 상태가 아님(${p.status}) — 되돌릴 것 없음`);
  if (p.stripe_refund_id) throw new Error(`Stripe 환불 번호 ${p.stripe_refund_id} 가 있다 — Stripe 에서 실제로 돌려준 건이라 되돌리지 않는다`);

  const au = await AuditLog.findOne({ where: { action: 'payment.refunded', target_type: 'payment', target_id: p.id }, order: [['id', 'DESC']] });
  const nv = parse(au && au.new_value) || {};
  console.log(`그때 기록: ${au ? new Date(au.created_at || au.createdAt).toISOString() : '감사 없음'} · 종류 ${p.refund_kind || '-'} · 사유 ${p.refund_reason || '-'}`);
  console.log(`지금 워크스페이스: 플랜 ${biz ? biz.plan : '-'} · 상태 ${biz ? biz.subscription_status : '-'}`);
  if (nv.canceled_subscription_id) console.log(`※ 그때 구독 #${nv.canceled_subscription_id} 이 해지·무료 전환됐다 — 되돌리지 않는다. 다시 처리해도 다시 해지되지 않는다(이미 해지됨).`);
  if (nv.restored_to) console.log(`※ 그때 워크스페이스가 ${nv.restored_to} 로 돌아갔다(체험 환불) — 되돌리지 않는다.`);
  if (Number(nv.addon_units_removed) > 0) console.log(`※ 그때 애드온 한도 ${nv.addon_units_removed} 이 회수됐다 — 다시 처리할 때 «구독은 유지 — 보상성 환불» 을 체크해야 두 번 안 줄어든다.`);
  console.log(`되돌린 뒤: paid · 환불 요청 ${p.refund_requested_at ? '그대로 → «환불 요청» 탭에 다시 뜬다' : '없음 → 결제 이력 [환불] 로 처리'}`);
  if (!APPLY) { console.log('읽기만 했다 — 쓰려면 --apply'); return; }

  const t = await sequelize.transaction();
  try {
    const row = await Payment.findByPk(p.id, { transaction: t, lock: t.LOCK.UPDATE });
    if (row.status !== 'refunded' || row.stripe_refund_id) throw new Error('그 사이 바뀌었다 — 다시 확인');
    const old = { status: row.status, refunded_at: row.refunded_at ? new Date(row.refunded_at).toISOString() : null, refund_reason: row.refund_reason, refund_kind: row.refund_kind };
    await row.update({ status: 'paid', refunded_at: null, refund_reason: null, refund_kind: null }, { transaction: t });
    await require('../services/auditService').writeAudit({
      userId: null, businessId: row.business_id, action: 'payment.refund_record_reverted', targetType: 'payment', targetId: row.id,
      oldValue: old, newValue: { status: 'paid', reason: 'Stripe 환불 없이 기록만 된 카드 환불 — 다시 처리하도록 되돌림(scripts/revert-card-refund-record.js)' },
    }, { transaction: t });
    await t.commit();
    console.log(`되돌림 완료 — 결제 #${row.id} paid`);
  } catch (e) { await t.rollback().catch(() => {}); throw e; }
}

(async () => {
  const q = arg('find'); const id = Number(arg('payment'));
  if (q) await find(q);
  else if (id) await revert(id);
  else console.log('사용: --find=<이름·이메일> | --payment=<id> [--apply]');
  process.exit(0);
})().catch((e) => { console.error('중단:', e.message); process.exit(1); });
