// services/mailTodoWhere.js — 확인필요(·Q mail 메뉴 배지)에 «내 것» 으로 올릴 답변 필요 메일의 술어 한 벌.
//
// Fable 설계 (2026-11-06, DESIGN-READY) — 한 스레드의 귀속:
//   ① 스레드 «답변 담당»(email_thread_participants.is_assigned) 있음 → 그 사람만 (더 구체적인 결정이 이긴다)
//   ② 없음 ∧ 메일함 책임자(email_accounts.responsible_user_id) 있음 ∧ 책임자가 이 워크스페이스 활성 멤버 → 책임자만
//   ③ 그 밖(책임자 없음 · 책임자가 떠남) → 그 메일함을 볼 수 있는 사람 전원 (아무에게도 안 뜨는 메일을 만들지 않는다)
// ★ 보는 권한은 바꾸지 않는다 — Q mail 폴더·목록·검색은 그대로. 좁아지는 것은 확인필요 항목뿐이다.
// ★ 술어를 SQL 에 넣고 LIMIT 는 그 뒤에 — 옛 코드는 120건을 먼저 자르고 담당 필터를 나중에 걸어
//   남의 것이 앞을 차지하면 내 것이 잘렸다.
// 알림(mailNotify)·답변 담당 자동 지정은 이 술어를 쓰지 않는다(이번 범위 밖 — 바꾸면 별도 Fable 설계).
const { Op, literal } = require('sequelize');
const { EmailAccount, User } = require('../models');
const { getMemberNameMap } = require('./displayName');
const { activeMemberIds } = require('./mailResponsible');

// → { accounts: [{id,email,responsible_user_id}], where (EmailThread 조건, 계정 포함) | null, responsibleNames: Map<accountId, name> }
async function mailTodoScope(businessId, userId) {
  const me = Number(userId);
  const accounts = await EmailAccount.findAll({
    where: {
      business_id: businessId,
      is_active: true,
      [Op.or]: [{ owner_user_id: null }, { owner_user_id: me }],  // 남의 개인 메일함은 제외
    },
    attributes: ['id', 'email', 'owner_user_id', 'responsible_user_id'],
    raw: true,
  });
  if (!accounts.length) return { accounts, where: null, responsibleNames: new Map() };

  const active = await activeMemberIds(businessId, accounts.filter((a) => a.owner_user_id == null).map((a) => a.responsible_user_id));
  // 개인 메일함에는 책임자를 두지 않는다 — 값이 남아 있어도 무시(공용일 때만 뜻이 있다)
  const effResp = (a) => (a.owner_user_id == null && a.responsible_user_id && active.has(Number(a.responsible_user_id)))
    ? Number(a.responsible_user_id) : null;
  const allIds = accounts.map((a) => a.id);
  const mineIds = accounts.filter((a) => { const r = effResp(a); return r == null || r === me; }).map((a) => a.id);

  const assignedToMe = `EXISTS (SELECT 1 FROM email_thread_participants p WHERE p.thread_id = EmailThread.id AND p.is_assigned = 1 AND p.user_id = ${me})`;
  const assignedToAnyone = 'EXISTS (SELECT 1 FROM email_thread_participants p WHERE p.thread_id = EmailThread.id AND p.is_assigned = 1)';
  const where = {
    account_id: { [Op.in]: allIds },
    [Op.or]: [
      literal(assignedToMe),
      ...(mineIds.length ? [{ [Op.and]: [{ account_id: { [Op.in]: mineIds } }, literal(`NOT ${assignedToAnyone}`)] }] : []),
    ],
  };

  // 표시용 이름(설정된 책임자가 활성일 때만) — 워크스페이스 표시명 우선, 없으면 계정 이름
  const respIds = [...new Set(accounts.map(effResp).filter(Boolean))];
  const responsibleNames = new Map();
  if (respIds.length) {
    const dn = await getMemberNameMap(businessId, respIds);
    const users = await User.findAll({ where: { id: respIds }, attributes: ['id', 'name'], raw: true });
    const uname = new Map(users.map((u) => [Number(u.id), u.name]));
    for (const a of accounts) {
      const r = effResp(a);
      if (r) responsibleNames.set(a.id, (dn.get(r) && dn.get(r).name) || uname.get(r) || null);
    }
  }
  return { accounts, where, responsibleNames };
}

module.exports = { mailTodoScope };
