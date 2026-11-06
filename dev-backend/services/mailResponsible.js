// services/mailResponsible.js — 회사 공용 메일함 «책임자»(email_accounts.responsible_user_id) 판정 한 곳.
//   «활성 멤버» = 이 워크스페이스 business_members · removed_at NULL · role ≠ 'ai' (Fable 설계 2026-11-06).
//   저장 검사(PUT)와 확인필요 귀속(services/mailTodoWhere)이 같은 술어를 쓴다.
const { Op } = require('sequelize');
const { BusinessMember } = require('../models');

async function activeMemberIds(businessId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return new Set();
  const rows = await BusinessMember.findAll({
    where: { business_id: businessId, user_id: ids, removed_at: null, role: { [Op.ne]: 'ai' } },
    attributes: ['user_id'], raw: true,
  });
  return new Set(rows.map((r) => Number(r.user_id)));
}

// PUT body.responsible_user_id → { value } | { error, status }. 공용만 · 관리자만 · 활성 멤버만 · null = 해제.
async function resolveResponsiblePatch({ raw, businessId, willBeTeam, isAdmin }) {
  if (raw === null || raw === '') return { value: null };
  if (!willBeTeam) return { error: 'responsible_team_only', status: 400 };
  if (!isAdmin) return { error: 'admin_required', status: 403 };
  const uid = Number(raw);
  if (!Number.isInteger(uid) || uid <= 0) return { error: 'invalid_responsible', status: 400 };
  const ok = await activeMemberIds(businessId, [uid]);
  if (!ok.has(uid)) return { error: 'invalid_responsible', status: 400 };
  return { value: uid };
}

module.exports = { activeMemberIds, resolveResponsiblePatch };
