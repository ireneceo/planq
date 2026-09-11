// services/clientAccess.js — 고객의 **접근 종류** 술어 단일 원천 (docs/Q_SALE_DESIGN.md §4.1·§4.2)
//
//   guest   — 정보만 저장됨 · 로그인 없음 (Q sale 문의 고객, status='prospect')
//   invited — 초대 메일을 보냈고 아직 수락 전
//   member  — 로그인하는 고객 (middleware/access_scope.js 의 isClient 와 같은 조건: user_id + status 'active')
//
// ★ 컬럼이 아니다 — 기존 컬럼(user_id · status · invited_at)에서 파생한다. 새 컬럼을 두면
//   user_id 와 어긋나는 순간이 반드시 온다.
// ★ 프론트는 이 값만 표시한다. 화면이 user_id 를 보고 스스로 판정하면 술어가 두 벌이 된다
//   (memory feedback_predicate_must_match_both_sides).
const { Op } = require('sequelize');

function accessKindOf(client) {
  if (!client) return 'guest';
  if (client.user_id && client.status === 'active') return 'member';
  if (client.status === 'prospect') return 'guest';
  if (client.invited_at || client.status === 'invited') return 'invited';
  // archived 이면서 계정·초대 흔적이 없는 행 — 정보만 있는 고객이다
  return 'guest';
}

/**
 * 목록 필터용 SQL 술어 — **accessKindOf 와 같은 판정**을 WHERE 로 옮긴 것. 둘을 따로 고치지 말 것.
 *   status 는 NULL 허용이다: `status <> 'x'` 는 NULL 행을 빼므로 NULL 을 명시한다.
 */
function accessWhere(kind) {
  const isMember = { user_id: { [Op.ne]: null }, status: 'active' };
  const notMember = { [Op.or]: [{ user_id: null }, { status: null }, { status: { [Op.ne]: 'active' } }] };
  if (kind === 'member') return isMember;
  if (kind === 'invited') {
    return {
      [Op.and]: [
        notMember,
        { [Op.or]: [{ status: null }, { status: { [Op.ne]: 'prospect' } }] },
        { [Op.or]: [{ invited_at: { [Op.ne]: null } }, { status: 'invited' }] },
      ],
    };
  }
  if (kind === 'guest') {
    return {
      [Op.and]: [
        notMember,
        { [Op.or]: [
          { status: 'prospect' },
          { [Op.and]: [{ invited_at: null }, { [Op.or]: [{ status: null }, { status: { [Op.ne]: 'invited' } }] }] },
        ] },
      ],
    };
  }
  return null;
}

/**
 * 고객 목록에 access_kind · has_guest_link 를 붙인다. 입력은 Client 인스턴스나 plain 객체.
 * 살아 있는 게스트 링크 = 회수 안 됨 + 만료 전.
 */
async function withAccess(businessId, clients) {
  const list = (clients || []).map((c) => (c && c.toJSON ? c.toJSON() : { ...c }));
  const ids = list.map((c) => c.id).filter(Boolean);
  const linked = new Set();
  if (ids.length) {
    const { GuestLink } = require('../models');
    const rows = await GuestLink.findAll({
      where: {
        business_id: businessId,
        client_id: { [Op.in]: ids },
        revoked_at: null,
        expires_at: { [Op.gt]: new Date() },
      },
      attributes: ['client_id'],
      raw: true,
    });
    for (const r of rows) linked.add(r.client_id);
  }
  return list.map((c) => ({ ...c, access_kind: accessKindOf(c), has_guest_link: linked.has(c.id) }));
}

module.exports = { accessKindOf, accessWhere, withAccess };
