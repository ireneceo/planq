// services/saleNotify.js — Q sale 알림의 **단일 착지점** (eventKind 'sale', docs/Q_SALE_DESIGN.md §11)
//
// 왜 서비스로 빼는가: 알림을 부르는 곳이 라우트마다 흩어지면 한 곳이 빠져도 아무도 모른다
// (CLAUDE.md 운영 안정성 §13 — 그래서 가드가 파일 단위로 notify 호출을 잠근다).
// 여기 한 곳이 잠겨 있으면 Q sale 계열 알림이 통째로 사라지는 회귀를 막을 수 있다.
//
// 받는 사람 = **그 고객에 귀속된 사람** (services/saleCommon.saleOwnerWhere 와 같은 규칙):
//   담당자가 있으면 담당자, 없거나 지금 멤버가 아니면 owner·admin 전원.
//   ★ 알림 설정(notification_prefs)·게스트 계정 차단·삭제된 워크스페이스 검사는 notify 안에서 한다.
const { Op } = require('sequelize');
const { Client, BusinessMember } = require('../models');
const { notify } = require('../routes/notifications');

/** 이 고객의 알림을 받을 사용자 id 들 */
async function recipientsFor(client) {
  const businessId = client.business_id;
  const members = await BusinessMember.findAll({
    where: { business_id: businessId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
    attributes: ['user_id', 'role'], raw: true,
  });
  const activeIds = new Set(members.map((m) => m.user_id).filter(Boolean));
  if (client.assigned_member_id && activeIds.has(client.assigned_member_id)) return [client.assigned_member_id];
  return members.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.user_id).filter(Boolean);
}

/**
 * 게스트가 "계정 요청" 을 눌렀다 — 멤버가 초대를 보내야 진행된다(게스트 화면에는 가입 문이 없다).
 * @param {object} opts { client, requestedEmail, ioApp }
 */
async function notifyAccountRequested({ client, requestedEmail, ioApp }) {
  if (!client) return { sent: 0 };
  const userIds = await recipientsFor(client);
  const name = client.display_name || client.company_name || `#${client.id}`;
  let sent = 0;
  for (const userId of userIds) {
    const r = await notify({
      userId,
      businessId: client.business_id,
      eventKind: 'sale',
      // 제목은 발송 시점에 수신자 언어로 해석된다(services/notifyTitle) — 문자열을 직접 만들지 않는다
      titleSpec: { feature: 'sale', action: 'sale_account_request', detail: name },
      body: requestedEmail || null,
      entityType: 'client',
      entityId: client.id,
      ioApp,
    });
    if (r && (r.inbox || r.push || r.email)) sent += 1;
  }
  return { sent, recipients: userIds.length };
}

/** 고객 id 로 부르는 얇은 래퍼 — 라우트가 모델을 직접 읽지 않게 */
async function notifyAccountRequestedByClientId({ businessId, clientId, requestedEmail, ioApp }) {
  if (!clientId) return { sent: 0 };
  const client = await Client.findOne({ where: { id: clientId, business_id: businessId } });
  return notifyAccountRequested({ client, requestedEmail, ioApp });
}

module.exports = { notifyAccountRequested, notifyAccountRequestedByClientId, recipientsFor };
