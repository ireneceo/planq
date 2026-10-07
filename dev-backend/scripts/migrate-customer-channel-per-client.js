// 프로젝트 고객 채널을 «프로젝트 × 고객» 으로 정리 — 멱등. 2026-10-07 (Fable B 판정 7, Irene "fable 판정대로 해").
//
//   왜: 한 프로젝트에 고객사가 둘이면 한 고객 채널에 둘이 같이 들어가 있었다(운영 K-DINE — 프로젝트 6 · 방 18:
//   Kate 의 방에 Aidan). 그 방으로 청구서 카드가 가서 Kate 의 청구서가 Aidan 에게도 보였다.
//
//   하는 일
//   ①주인 없는(client_id 비어 있는) 프로젝트 고객 채널 — 안에 있는 고객이 한 고객사면 그 고객 것으로,
//     아무도 없으면 프로젝트의 연결 고객이 하나일 때만 그 고객 것으로(여럿이면 비워 두고, 처음 들어오는 고객이 가져간다).
//   ②채널 주인이 아닌 고객(그 프로젝트에 연결된 다른 고객사)은 **자기 고객사의 방**으로 옮긴다
//     (services/project_channel.ensureClientChannel — 없으면 만든다, 멤버·Cue 포함). 옛 방에서는 뺀다.
//     그 사람이 옛 방에 남긴 메시지는 옛 방에 그대로 있다(지우지 않는다) — 다만 앞으로 남의 방은 안 보인다.
//   ③프로젝트에 연결되지 않은 고객이 그 방에 있으면 손대지 않고 보고만 한다(사람이 판단).
//
//   기본은 **미리보기**(아무것도 안 바꾼다). `--apply` 로 실행. 실행 뒤 재조회해 남은 것이 있으면 exit 1.
//   롤백: 출력의 «moved» 줄(conv·user)로 참여자 행을 되돌리고, 새로 만든 방은 created 줄의 id 로 지운다.
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log('[customer-channel-per-client]', ...a);

async function scan() {
  const { Conversation, ConversationParticipant, ProjectClient, Client, BusinessMember, Project } = require('../models');
  const convs = await Conversation.findAll({
    where: { channel_type: 'customer', project_id: { [Op.ne]: null } },
    attributes: ['id', 'business_id', 'project_id', 'client_id'], order: [['id', 'ASC']],
  });
  const plan = [];
  for (const cv of convs) {
    const project = await Project.findByPk(cv.project_id, { attributes: ['id', 'business_id', 'name'] });
    if (!project || Number(project.business_id) !== Number(cv.business_id)) continue;
    // 이 프로젝트의 연결 고객 — 먼저 연결된 순
    const pcs = await ProjectClient.findAll({
      where: { project_id: cv.project_id, client_id: { [Op.ne]: null } },
      attributes: ['id', 'client_id', 'contact_user_id'], order: [['id', 'ASC']],
    });
    const linkedClientIds = [...new Set(pcs.map((p) => p.client_id))];
    // 방 안의 고객(워크스페이스 멤버가 아닌 사람) → 그 사람이 이 프로젝트의 어느 고객사인가
    const parts = await ConversationParticipant.findAll({ where: { conversation_id: cv.id }, attributes: ['id', 'user_id', 'role'] });
    const clientParts = [];
    for (const p of parts) {
      const isMember = await BusinessMember.findOne({ where: { business_id: cv.business_id, user_id: p.user_id, removed_at: null }, attributes: ['id'] });
      if (isMember) continue;
      const pc = pcs.find((x) => x.contact_user_id === p.user_id);
      let clientId = pc ? pc.client_id : null;
      if (!clientId) {
        const cl = await Client.findOne({ where: { business_id: cv.business_id, user_id: p.user_id, id: { [Op.in]: linkedClientIds.length ? linkedClientIds : [0] } }, attributes: ['id'] });
        clientId = cl ? cl.id : null;
      }
      clientParts.push({ partId: p.id, userId: p.user_id, clientId });
    }
    let owner = cv.client_id || null;
    let setOwner = null;
    if (!owner) {
      const present = linkedClientIds.filter((id) => clientParts.some((c) => c.clientId === id));
      if (present.length) setOwner = present[0];
      else if (linkedClientIds.length === 1) setOwner = linkedClientIds[0];
      owner = setOwner;
    }
    const move = owner ? clientParts.filter((c) => c.clientId && c.clientId !== owner) : [];
    const unknown = clientParts.filter((c) => !c.clientId);
    if (setOwner || move.length || unknown.length) {
      plan.push({ conv: cv.id, business_id: cv.business_id, project, owner, setOwner, move, unknown });
    }
  }
  return plan;
}

(async () => {
  try {
    const { Conversation, ConversationParticipant } = require('../models');
    const { ensureClientChannel } = require('../services/project_channel');
    const plan = await scan();
    for (const p of plan) {
      log(`conv ${p.conv} (project ${p.project.id})`
        + (p.setOwner ? ` · 주인 지정 client ${p.setOwner}` : '')
        + (p.move.length ? ` · 옮길 고객 ${p.move.map((m) => `user ${m.userId}→client ${m.clientId}`).join(', ')}` : '')
        + (p.unknown.length ? ` · 연결 안 된 고객(보고만) user ${p.unknown.map((u) => u.userId).join(',')}` : ''));
    }
    if (!APPLY) { log(`미리보기 ${plan.length}건 — 바꾸려면 --apply`); await sequelize.close(); process.exit(0); }

    for (const p of plan) {
      await sequelize.transaction(async (t) => {
        if (p.setOwner) {
          await Conversation.update({ client_id: p.setOwner }, { where: { id: p.conv, client_id: null }, transaction: t });
          log(`set conv ${p.conv} client_id=${p.setOwner}`);
        }
        for (const m of p.move) {
          const { conversation: target, created } = await ensureClientChannel(p.project, m.clientId, null, { transaction: t });
          if (!target) throw new Error(`client ${m.clientId} 방을 만들 수 없음`);
          if (created) log(`created conv ${target.id} (project ${p.project.id} · client ${m.clientId})`);
          const [row, made] = await ConversationParticipant.findOrCreate({
            where: { conversation_id: target.id, user_id: m.userId },
            defaults: { conversation_id: target.id, user_id: m.userId, role: 'client' },
            transaction: t,
          });
          if (!made && row.role !== 'client') await row.update({ role: 'client' }, { transaction: t });
          await ConversationParticipant.destroy({ where: { id: m.partId }, transaction: t });
          log(`moved user ${m.userId}: conv ${p.conv} → conv ${target.id}`);
        }
      });
    }
    const after = (await scan()).filter((p) => p.setOwner || p.move.length);
    if (after.length) { console.error('[customer-channel-per-client] 남은 것', JSON.stringify(after.map((a) => a.conv))); process.exit(1); }
    log('OK — 남은 것 0');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[customer-channel-per-client] 실패:', e.message); process.exit(1); }
})();
