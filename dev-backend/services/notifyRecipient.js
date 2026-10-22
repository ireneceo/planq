// 알림을 받을 자격 — 그 워크스페이스 활성 멤버(removed_at NULL) 또는 계정이 붙은 고객(보관 아님).
//   routes/notifications.notify 한 곳이 부른다(조직 0단계, Fable 2026-10-22 차단 2). 확인 실패 = 아님(fail-closed).
const { Op } = require('sequelize');

async function isWorkspaceRecipient(userId, businessId) {
  try {
    const { BusinessMember, Client, Business } = require('../models');
    const m = await BusinessMember.findOne({ where: { business_id: businessId, user_id: userId, removed_at: null }, attributes: ['id'] });
    if (m) return true;
    // 멤버 행이 없는 옛 워크스페이스의 대표(businesses.owner_id) — 환불·결제 알림이 이 칸으로 간다(Fable 완료 검증 비차단 2)
    const own = await Business.findOne({ where: { id: businessId, owner_id: userId }, attributes: ['id'] });
    if (own) return true;
    const c = await Client.findOne({
      where: { business_id: businessId, user_id: userId, status: { [Op.ne]: 'archived' } },
      attributes: ['id'],
    });
    return !!c;
  } catch (e) {
    console.warn('[notify recipient check]', e.message);
    return false;
  }
}

module.exports = { isWorkspaceRecipient };
