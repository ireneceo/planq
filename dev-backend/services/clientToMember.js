// 고객이 같은 계정으로 멤버가 되면 — «멤버가 이긴다» (2026-10-16, docs/MEMBER_PROJECT_SCOPE_DESIGN.md · Fable 설계)
//
//   Irene: *"어떤 프로젝트에서 고객이었는데 같은 이메일로 멤버 가입했는데 그대로 고객이야.
//           전반적으로 표시가 고객이 아닌 것으로 바뀌어야지?"*
//
//   멤버 초대 수락은 멤버 자리만 만들고 «고객 자국» 셋을 그대로 두었다:
//     ① clients 행(Q sale 고객 목록)  ② project_clients 행(프로젝트 «참여 고객»)
//     ③ conversation_participants.role='client'(대화 «고객» 표시 · 내부 메시지 알림 제외 — conversations.js)
//   여기 한 함수가 셋을 같이 바꾼다. 부르는 곳: services/invites.js acceptInviteInner(workspace_member 두 분기) ·
//   scripts/migrate-client-to-member.js(옛 데이터). 베끼지 않는다.
//
//   ① 행은 지우지 않는다 — 청구·상담 이력이 client_id 로 달려 있다. archived + member_converted_at.
//   ② 행은 지우고 같은 프로젝트의 멤버로 넣는다 — 남겨 두면 멤버십이 끊기는 날 contact_user_id 로 고객 권한이 되살아난다.
//   ③ role → member.
//   역방향(멤버 해제 → 고객 복귀)은 하지 않는다. 활성 멤버를 고객으로 붙이는 문은 assertNotWorkspaceMember 로 막는다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

/** 이 워크스페이스의 활성 멤버(owner/admin/member)인가 — 고객으로 붙이는 문이 부른다. */
async function isActiveWorkspaceMember(businessId, userId, opts = {}) {
  if (!businessId || !userId) return false;
  const { BusinessMember } = require('../models');
  const bm = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: userId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
    attributes: ['id'], transaction: opts.transaction,
  });
  return !!bm;
}

/**
 * 고객 자국 → 멤버. 멱등(두 번째 호출은 바뀌는 것 0).
 * @returns {{ clients:number, projectClients:number, projectMembersAdded:number, participants:number, projectIds:number[], before:object }}
 */
async function promoteClientToMember({ businessId, userId, transaction }) {
  const { Client, ProjectClient, ProjectMember, Project, Conversation } = require('../models');
  const t = transaction;
  const out = { clients: 0, projectClients: 0, projectMembersAdded: 0, participants: 0, projectIds: [], before: {} };
  if (!businessId || !userId) return out;

  // ① 고객 행 — 보관(이력 유지)
  const cls = await Client.findAll({
    where: { business_id: businessId, user_id: userId, status: { [Op.ne]: 'archived' } },
    attributes: ['id', 'status'], transaction: t,
  });
  if (cls.length) {
    out.before.clients = cls.map((c) => ({ id: c.id, status: c.status }));
    await Client.update(
      { status: 'archived', member_converted_at: new Date() },
      { where: { id: { [Op.in]: cls.map((c) => c.id) } }, transaction: t },
    );
    out.clients = cls.length;
  }

  // ② 프로젝트 고객 행 → 같은 프로젝트 멤버
  const pcs = await ProjectClient.findAll({
    where: { contact_user_id: userId },
    include: [{ model: Project, attributes: ['id'], where: { business_id: businessId }, required: true }],
    transaction: t,
  });
  if (pcs.length) {
    out.before.projectClients = pcs.map((pc) => {
      const j = pc.get({ plain: true }); delete j.Project; delete j.invite_token; return j;
    });
    for (const pc of pcs) {
      const [, created] = await ProjectMember.findOrCreate({
        where: { project_id: pc.project_id, user_id: userId },
        defaults: { project_id: pc.project_id, user_id: userId, role: null, is_pm: false },
        transaction: t,
      });
      if (created) out.projectMembersAdded += 1;
      out.projectIds.push(Number(pc.project_id));
    }
    await ProjectClient.destroy({ where: { id: { [Op.in]: pcs.map((pc) => pc.id) } }, transaction: t });
    out.projectClients = pcs.length;
  }
  out.projectIds = [...new Set(out.projectIds)];

  // ③ 대화 참여 역할
  const convIds = (await Conversation.findAll({ where: { business_id: businessId }, attributes: ['id'], transaction: t, raw: true }))
    .map((c) => c.id);
  if (convIds.length) {
    out.participants = await require('./convParticipants').changeRole(userId, convIds, 'client', 'member', { transaction: t });
  }
  return out;
}

/** 커밋 뒤 — 감사·실시간 신호. 바뀐 것이 없으면 아무것도 안 한다. */
function afterPromote(r, { businessId, userId, actorUserId, io }) {
  if (!r || (!r.clients && !r.projectClients && !r.participants)) return;
  try {
    const { createAuditLog } = require('./auditService');
    createAuditLog({
      userId: actorUserId || userId, businessId,
      action: 'client.converted_to_member', targetType: 'user', targetId: userId,
      oldValue: r.before,
      newValue: { clients_archived: r.clients, project_clients_removed: r.projectClients, project_members_added: r.projectMembersAdded, participants_to_member: r.participants },
    });
  } catch (e) { console.warn('[clientToMember audit]', e.message); }
  if (!io) return;
  try {
    io.to(`business:${businessId}`).emit('client:updated', { business_id: businessId });
    io.to(`business:${businessId}`).emit('member:updated', { user_id: userId });
    const { emitProject } = require('./projectRoom');
    for (const pid of r.projectIds) emitProject(io, pid, 'project:updated', { id: pid, business_id: businessId });
  } catch (e) { console.warn('[clientToMember emit]', e.message); }
}

module.exports = { promoteClientToMember, afterPromote, isActiveWorkspaceMember };
