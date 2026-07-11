// 청구 알림 수신자 단일 원천 — owner/admin 멤버 + 청구서 담당자 + 워크스페이스 기본 청구담당자.
//
// 청구 알림(연체 제안·송금 알림·카드결제 도착)은 "누를 수 있는 사람"에게만 가야 한다.
// 독촉 발송(send-reminder)은 qbill write 권한이 필요하므로, 권한 없는 일반 멤버에게 알리면
// 눌러도 403 — 알림이 곧 막다른 길이 된다.

const { Op } = require('sequelize');
const { BusinessMember, Business } = require('../models');

/**
 * @param {object} invoice - Invoice 인스턴스 (business_id, owner_user_id)
 * @returns {Promise<{ userIds: number[], business: object|null, workspaceName: string|null }>}
 */
async function resolveBillingRecipients(invoice) {
  const business = await Business.findByPk(invoice.business_id, {
    attributes: ['id', 'name', 'brand_name', 'default_billing_owner_id', 'overdue_grace_days'],
  });
  const members = await BusinessMember.findAll({
    where: {
      business_id: invoice.business_id,
      removed_at: null,
      role: { [Op.in]: ['owner', 'admin'] },
    },
    attributes: ['user_id'],
  });
  const ids = new Set(members.map((m) => m.user_id));
  if (invoice.owner_user_id) ids.add(invoice.owner_user_id);
  if (business?.default_billing_owner_id) ids.add(business.default_billing_owner_id);

  return {
    userIds: [...ids],
    business,
    workspaceName: business?.brand_name || business?.name || null,
  };
}

module.exports = { resolveBillingRecipients };
