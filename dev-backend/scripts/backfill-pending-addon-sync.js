// backfill-pending-addon-sync.js — 미결제 플랜 청구에 현재 애드온을 싣고, 유예·체험 중에 만들어진 애드온 일할 청구를 닫는다 (멱등)
//   2026-11-15 Fable 설계 R9. Irene: «멤버를 추가해도 결제금액이 같아» — 고친 코드는 다음 애드온 변경 때만 금액을 맞추므로
//   이미 만들어진 청구(예: 유예 중 39,000)는 이 스크립트가 맞춘다.
//
//   ① pending 플랜 결제가 있는 워크스페이스마다 services/pendingPlanSync.syncPendingPlanAmount (얼은 건은 건너뛰고 목록 출력)
//   ② 닫을 수 있는 애드온 청구(Fable 완료 검증 B2) — 아래 다섯을 **모두** 만족할 때만 canceled(cancel_reason='folded_into_plan') + 감사:
//      · 이 수정 이전에 만들어진 것(created_at < CUTOFF) — 새 코드의 «separate» 청구를 다음 배포가 닫지 않게
//      · 고객이 «입금했어요» 를 누르지 않았고 카드 결제창도 없다(notify_paid_at·stripe_session_id 없음)
//      · period_start 가 그 워크스페이스의 어떤 paid 플랜 기간 [start, end) 에도 들지 않는다(돌던 유료 기간 일할 아님)
//      · 그 애드온이 **이번 실행에서 얼지 않은 미결제 플랜 청구에 실제로 실렸다**(line_items 에 같은 코드) 또는 워크스페이스가 체험 중(R6 무료)
//      나머지는 «수동 확인» 목록으로 출력만.
//   ③ 금액이 바뀐 청구는 «입금 안내 다시 보낼 대상» 으로 출력만 한다 — 실제 발송은 Irene 승인 뒤.
//
//   기본은 읽기만(dry-run — 트랜잭션을 되돌린다). 쓰려면 --apply.
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Payment } = require('../models');
const sync = require('../services/pendingPlanSync');

const APPLY = process.argv.includes('--apply');
// 새 신청 로직(pendingPlanSync)이 dev 에 처음 올라간 시각보다 앞 — 이후 행은 새 코드가 만든 것이라 닫지 않는다.
//   운영은 배포 전까지 옛 코드라 이 뒤~배포 사이 옛 청구는 «수동 확인» 으로 남는다(안전한 쪽).
const CUTOFF = new Date('2026-11-15T20:40:00Z');
const { Business } = require('../models');
const { writeAudit } = require('../services/auditService');

(async () => {
  const out = { synced: [], frozen: [], unchanged: 0, closed: [], manual: [] };
  try {
    const pendingBizIds = (await Payment.findAll({
      where: { kind: 'plan', status: 'pending' }, attributes: ['business_id'], group: ['business_id'], raw: true,
    })).map((r) => r.business_id);
    // 지운 워크스페이스는 뺀다 — 그 청구는 삭제 흐름이 소유한다(sync 도 건너뛰지만 목록부터 뺀다 · 2026-11-16)
    const deletedIds = new Set((await Business.findAll({
      where: { id: pendingBizIds, deleted_at: { [Op.ne]: null } }, attributes: ['id'], raw: true,
    })).map((r) => r.id));
    const bizIds = pendingBizIds.filter((id) => !deletedIds.has(id));

    const foldedCodes = new Map();   // biz → 이번 실행에서 얼지 않은 미결제 플랜 청구에 실린 애드온 코드들
    for (const bizId of bizIds) {
      const t = await sequelize.transaction();
      try {
        const r = await sync.syncPendingPlanAmount(bizId, { transaction: t });
        if (r.frozen) { out.frozen.push({ biz: bizId, payment: r.payment.id, amount: r.old_amount }); }
        else if (r.payment && (r.changed || r.old_amount !== r.new_amount)) out.synced.push({ biz: bizId, payment: r.payment.id, from: r.old_amount, to: r.new_amount });
        else out.unchanged += 1;
        if (APPLY) await t.commit(); else await t.rollback();
        // «실렸다» 는 커밋이 끝난 뒤에만 센다 — 커밋이 실패했는데 애드온 청구를 닫으면 어디에도 안 실린다(Fable 3차 비차단 1)
        if (r.payment && !r.frozen) {
          foldedCodes.set(bizId, new Set((r.payment.line_items || []).filter((l) => l.kind === 'addon').map((l) => l.code)));
        }
      } catch (e) {
        if (!t.finished) await t.rollback();
        console.error(`[backfill] biz ${bizId} 실패: ${e.message}`);
      }
    }

    const addons = await Payment.findAll({ where: { kind: 'addon', status: 'pending' } });
    for (const a of addons) {
      const at = a.period_start ? new Date(a.period_start) : new Date(a.createdAt || a.created_at);
      const inPaid = await Payment.count({
        where: {
          business_id: a.business_id, kind: 'plan', status: 'paid',
          period_start: { [Op.lte]: at }, period_end: { [Op.gt]: at },
        },
      });
      if (inPaid > 0) continue;   // 돌던 유료 기간의 일할 — 정당한 청구
      const row = { biz: a.business_id, payment: a.id, code: a.addon_code, qty: a.addon_quantity, amount: Number(a.amount) };
      let why = null;
      if (deletedIds.has(a.business_id) || await Business.count({ where: { id: a.business_id, deleted_at: { [Op.ne]: null } } })) why = '지운 워크스페이스';
      else if (new Date(a.createdAt || a.created_at) >= CUTOFF) why = '새 코드가 만든 청구';
      else if (a.notify_paid_at || a.stripe_session_id) why = '고객이 입금 통보·카드 결제창';
      else {
        const folded = foldedCodes.get(a.business_id);
        const biz = await Business.findByPk(a.business_id, { attributes: ['id', 'subscription_status'] });
        const trialing = biz && biz.subscription_status === 'trialing';
        if (!(folded && folded.has(a.addon_code)) && !trialing) why = '미결제 플랜 청구에 실리지 않음';
      }
      if (why) { out.manual.push({ ...row, why }); continue; }
      out.closed.push(row);
      if (APPLY) {
        const [n] = await Payment.update({ status: 'canceled', cancel_reason: 'folded_into_plan' }, {
          where: { id: a.id, status: 'pending', notify_paid_at: null, stripe_session_id: null },
        });
        if (n) {
          await writeAudit({
            user_id: null, business_id: a.business_id, action: 'payment.addon_folded_closed',
            target_type: 'payment', target_id: a.id,
            old_value: { status: 'pending', amount: Number(a.amount) },
            new_value: { status: 'canceled', cancel_reason: 'folded_into_plan', script: 'backfill-pending-addon-sync' },
          });
        }
      }
    }

    console.log(`${APPLY ? '[적용]' : '[미리보기 — 바꾸지 않음]'} pending 플랜 청구 워크스페이스 ${bizIds.length}곳`);
    console.log(`  금액 맞춤 ${out.synced.length}건 · 그대로 ${out.unchanged}건 · 얼어서 건너뜀 ${out.frozen.length}건`);
    for (const s of out.synced) console.log(`  · 맞춤 biz ${s.biz} 결제 #${s.payment}: ${s.from} → ${s.to} (입금 안내 다시 보낼 대상)`);
    for (const f of out.frozen) console.log(`  · 얼음 biz ${f.biz} 결제 #${f.payment}: ${f.amount} (입금 통보·카드 결제창 — 그대로)`);
    console.log(`  유예·체험 중 애드온 청구 닫음 ${out.closed.length}건 · 수동 확인 ${out.manual.length}건`);
    for (const c of out.closed) console.log(`  · 닫음 biz ${c.biz} 애드온 결제 #${c.payment} ${c.code}×${c.qty} ${c.amount}`);
    for (const c of out.manual) console.log(`  · 수동 확인 biz ${c.biz} 애드온 결제 #${c.payment} ${c.code}×${c.qty} ${c.amount} — ${c.why}`);
    process.exit(0);
  } catch (e) {
    console.error('[backfill-pending-addon-sync] 실패', e);
    process.exit(1);
  }
})();
