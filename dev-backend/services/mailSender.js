'use strict';
// 보낸 메일(outbound)을 «우리 쪽 누가» 보냈는지 — **표시용** 판정 한 곳.
//
// 신고(2026-10-21): "나 <hssong@kiyul.co.kr> — 내가 보낸 게 아닌데 나라고 나와. 우리끼리는 멤버 이름을 알아야지."
//   sent_by_user_id 는 PlanQ 에서 보낸 메일에만 있다. 보낸메일함을 IMAP 으로 가져온 메일(아웃룩·웹메일·폰)은
//   늘 NULL 이고, 화면은 그것을 «나» 로 그렸다.
//
// 판정 순서
//   ① sent_by_user_id (PlanQ 에서 보냄)                                → source 'planq'
//   ② 개인 계정이고 보낸 주소가 계정 주소/그 계정 별칭 → 계정 주인          → source 'address'
//   ③ 이 워크스페이스 멤버 중 로그인 이메일·확인된 보조 이메일이 보낸 주소와 같은 사람
//      (정확히 한 명일 때만 — 둘 이상이면 모른다)                          → source 'address'
//   그 밖 → null (화면은 헤더 이름 또는 주소만 — 확인 안 된 것을 «나» 로 쓰지 않는다)
//
// ★ sent_by_user_id 자체는 바꾸지 않는다 — «PlanQ 에서 보냄» 판정(mailFolders sent_via 등)이 그 값을 쓴다.
const { Op } = require('sequelize');
const { User, BusinessMember, EmailAccountAlias } = require('../models');
const { applyMemberDisplayName } = require('./displayName');

const norm = (e) => String(e || '').trim().toLowerCase();

/**
 * @param {number} businessId
 * @param {{id:number,email:string,owner_user_id:number|null}|null} account 스레드의 메일 계정
 * @param {Array<{id:number,direction:string,from_email:string,sent_by_user_id:number|null}>} messages
 * @returns {Promise<Map<number,{user_id:number,name:string|null,source:'planq'|'address'}>>} 메시지 id → 보낸 멤버
 */
async function resolveOutboundSenders(businessId, account, messages) {
  const out = new Map();
  const outbound = messages.filter(m => m.direction === 'outbound');
  if (!outbound.length) return out;

  const byMsg = new Map(); // msg id → { user_id, source }
  const unknownAddrs = new Set();
  for (const m of outbound) {
    if (m.sent_by_user_id) byMsg.set(m.id, { user_id: m.sent_by_user_id, source: 'planq' });
    else if (norm(m.from_email)) unknownAddrs.add(norm(m.from_email));
  }

  const addrOwner = new Map(); // 주소 → user_id
  if (unknownAddrs.size) {
    // ② 개인 계정 — 계정 주소와 그 계정 별칭은 주인의 것이다
    if (account && account.owner_user_id) {
      const own = new Set([norm(account.email)]);
      const aliases = await EmailAccountAlias.findAll({
        where: { account_id: account.id, business_id: businessId }, attributes: ['email'], raw: true,
      });
      for (const a of aliases) own.add(norm(a.email));
      for (const addr of unknownAddrs) if (own.has(addr)) addrOwner.set(addr, account.owner_user_id);
    }
    // ③ 이 워크스페이스 멤버의 로그인·확인된 보조 이메일
    const rest = [...unknownAddrs].filter(a => !addrOwner.has(a));
    if (rest.length) {
      const members = await BusinessMember.findAll({
        where: { business_id: businessId, user_id: { [Op.ne]: null }, role: { [Op.ne]: 'ai' } },
        attributes: ['user_id'], raw: true,
      });
      const memberIds = members.map(m => m.user_id);
      if (memberIds.length) {
        const users = await User.findAll({
          where: {
            id: memberIds,
            [Op.or]: [
              { email: rest },
              { secondary_email: rest, secondary_email_verified_at: { [Op.ne]: null } },
            ],
          },
          attributes: ['id', 'email', 'secondary_email', 'secondary_email_verified_at'],
          raw: true,
        });
        const hits = new Map(); // 주소 → Set(user_id)
        const add = (addr, uid) => { if (!hits.has(addr)) hits.set(addr, new Set()); hits.get(addr).add(uid); };
        for (const u of users) {
          if (rest.includes(norm(u.email))) add(norm(u.email), u.id);
          if (u.secondary_email_verified_at && rest.includes(norm(u.secondary_email))) add(norm(u.secondary_email), u.id);
        }
        for (const [addr, set] of hits) if (set.size === 1) addrOwner.set(addr, [...set][0]);
      }
    }
    for (const m of outbound) {
      if (byMsg.has(m.id)) continue;
      const uid = addrOwner.get(norm(m.from_email));
      if (uid) byMsg.set(m.id, { user_id: uid, source: 'address' });
    }
  }

  const ids = [...new Set([...byMsg.values()].map(v => v.user_id))];
  if (!ids.length) return out;
  const users = await User.findAll({ where: { id: ids }, attributes: ['id', 'name'], raw: true });
  const shells = users.map(u => ({ user_id: u.id, sender: { id: u.id, name: u.name, name_localized: null } }));
  // 표시명은 워크스페이스 프로필 우선(BusinessMember.name → User.name) — #220 과 같은 규칙
  await applyMemberDisplayName(shells, businessId, ['sender']);
  const nameOf = new Map(shells.map(sh => [sh.user_id, sh.sender && sh.sender.name ? sh.sender.name : null]));
  for (const [mid, v] of byMsg) out.set(mid, { ...v, name: nameOf.get(v.user_id) || null });
  return out;
}

module.exports = { resolveOutboundSenders };
