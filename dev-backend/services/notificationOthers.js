// ★ P1 (2026-10-15 Fable 결정 B) — 다른 워크스페이스의 안 읽은 알림 수. 종 드롭다운 하단 «○○ 새 알림 N [전환]».
//   종 배지는 그대로 현재 워크스페이스만(부분집합 계약). 여기 수는 «그 워크스페이스로 전환해 종을 열면 보일 미읽음» —
//   플랫폼 공지(business_id NULL)는 현재 범위에 이미 들어 있으므로 넣지 않는다(중복 계수 금지).
//   대상 집합은 워크스페이스 전환기(routes/auth.js getUserWithBusiness)와 **같은 술어**다 — 해제 안 된 멤버십 ∪ 활성 고객,
//   삭제된 워크스페이스 제외. 전환기에 없는 곳을 세면 [전환] 이 실패한다. 이름도 같은 `brand_name || name`.
//   사이드바가 포커스마다 치는 라우트라 GROUP BY 한 번으로 센다.
async function otherWorkspaceUnread(userId, currentBizId) {
  const { Op, fn, col } = require('sequelize');
  const { Notification, BusinessMember, Client, Business } = require('../models');
  const grouped = await Notification.findAll({
    where: { user_id: userId, read_at: null, business_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: currentBizId }] } },
    attributes: ['business_id', [fn('COUNT', col('id')), 'unread']],
    group: ['business_id'],
    raw: true,
  });
  if (!grouped.length) return [];
  const ids = grouped.map((g) => Number(g.business_id));
  const [mem, cli, bizRows] = await Promise.all([
    BusinessMember.findAll({ where: { user_id: userId, removed_at: null, business_id: ids }, attributes: ['business_id'], raw: true }),
    Client.findAll({ where: { user_id: userId, status: 'active', business_id: ids }, attributes: ['business_id'], raw: true }),
    Business.findAll({ where: { id: ids, deleted_at: null }, attributes: ['id', 'name', 'brand_name'], raw: true }),
  ]);
  const belongs = new Set([...mem, ...cli].map((r) => Number(r.business_id)));
  const nameOf = new Map(bizRows.map((b) => [Number(b.id), b.brand_name || b.name]));
  return grouped
    .map((g) => ({ business_id: Number(g.business_id), name: nameOf.get(Number(g.business_id)), unread: Number(g.unread) || 0 }))
    .filter((o) => o.unread > 0 && belongs.has(o.business_id) && o.name)
    .sort((a, b) => b.unread - a.unread || a.business_id - b.business_id);
}

module.exports = { otherWorkspaceUnread };
