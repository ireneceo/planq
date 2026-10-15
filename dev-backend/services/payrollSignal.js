// 급여 실시간 신호 — 한 문 (docs/PAYROLL_DESIGN.md §5.2-5)
//   owner + 지정 급여 담당자의 **개인 방(user:N)** 에만 `payroll:updated` 신호(id 만). business 방 금지 —
//   급여가 있다는 사실 자체가 정보다. 받는 화면은 id 로 다시 읽는다. 실패해도 응답에는 영향 없다.
const { Business, BusinessMember } = require('../models');

async function payrollAudienceIds(businessId) {
  const { payrollManagerIds } = require('./payrollAccess');
  const biz = await Business.findByPk(businessId, { attributes: ['id', 'owner_id', 'permissions'] });
  const ids = new Set(biz ? await payrollManagerIds(biz) : []);
  const owners = await BusinessMember.findAll({ where: { business_id: businessId, role: 'owner', removed_at: null }, attributes: ['user_id'] });
  owners.forEach((o) => ids.add(o.user_id));
  if (biz?.owner_id) ids.add(biz.owner_id);
  return [...ids];
}

async function signalPayroll(req, businessId, payload) {
  try {
    const io = req?.app?.get('io') || global.__planqIo;
    if (!io) return;
    for (const uid of await payrollAudienceIds(businessId)) io.to(`user:${uid}`).emit('payroll:updated', { business_id: businessId, ...payload });
  } catch (e) { console.warn('[payroll signal]', e.message); }
}

module.exports = { signalPayroll, payrollAudienceIds };
