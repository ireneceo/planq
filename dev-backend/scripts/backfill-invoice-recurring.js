// #92 — 기존 정기/구독 청구서에 meta.recurring 스냅샷 백필 (멱등).
//   신규 발행분은 엔진이 생성 시 기록하지만, 백필 전 옛 청구서는 출처 링크가 없어
//   "정기 발송 기준"이 안 보임. 출처를 역추적해 채운다.
//   - client_subscription: business_id + client_id + title LIKE 'plan_name (%' + notes='정기 구독 자동 청구'
//   - project: project_id + notes='정기 자동 청구 (월정액)'
//   실행: node scripts/backfill-invoice-recurring.js
require('dotenv').config();
const { Op } = require('sequelize');
const { Invoice, ClientSubscription, Project } = require('../models');
const { sequelize } = require('../config/database');
const { recurringMetaForSub, recurringMetaForProject } = require('../services/invoiceRecurring');

async function run() {
  let subFilled = 0, projFilled = 0;

  // ── 클라이언트 구독 ──
  const subs = await ClientSubscription.findAll({ attributes: ['id', 'business_id', 'client_id', 'plan_name', 'interval'] });
  for (const sub of subs) {
    const invs = await Invoice.findAll({
      where: {
        business_id: sub.business_id,
        client_id: sub.client_id,
        notes: '정기 구독 자동 청구',
        title: { [Op.like]: `${sub.plan_name} (%` },
      },
    });
    for (const inv of invs) {
      const cur = (inv.meta && typeof inv.meta === 'object') ? inv.meta : {};
      if (cur.recurring && cur.recurring.source) continue;   // 이미 있음 → skip (멱등)
      await inv.update({ meta: recurringMetaForSub(sub, cur) });
      subFilled++;
    }
  }

  // ── 프로젝트 월정액 ──
  const projects = await Project.findAll({
    where: { billing_type: 'subscription' },
    attributes: ['id', 'business_id', 'invoice_billing_day'],
  });
  for (const project of projects) {
    const invs = await Invoice.findAll({
      where: { business_id: project.business_id, project_id: project.id, notes: '정기 자동 청구 (월정액)' },
    });
    for (const inv of invs) {
      const cur = (inv.meta && typeof inv.meta === 'object') ? inv.meta : {};
      if (cur.recurring && cur.recurring.source) continue;
      await inv.update({ meta: recurringMetaForProject(project, cur) });
      projFilled++;
    }
  }

  console.log(`백필 완료 — client_subscription 청구서 ${subFilled}건, project 청구서 ${projFilled}건`);
  await sequelize.close();
}
run().catch((e) => { console.error('백필 실패', e); process.exit(1); });
