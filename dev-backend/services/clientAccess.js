// services/clientAccess.js — 고객의 **접근 종류** 술어 단일 원천 (docs/Q_SALE_DESIGN.md §4.1·§4.2)
//
//   guest   — 정보만 저장됨 · 로그인 없음 (Q sale 문의 고객 status='prospect' · 직접 관리 고객 status='managed')
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
  // prospect(문의) · managed(직접 관리 — 계정 없이 정보만 관리하는 정식 고객) 는 둘 다 «정보만·로그인 없음»
  if (client.status === 'prospect' || client.status === 'managed') return 'guest';
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
        { [Op.or]: [{ status: null }, { status: { [Op.notIn]: ['prospect', 'managed'] } }] },
        { [Op.or]: [{ invited_at: { [Op.ne]: null } }, { status: 'invited' }] },
      ],
    };
  }
  if (kind === 'guest') {
    return {
      [Op.and]: [
        notMember,
        { [Op.or]: [
          { status: { [Op.in]: ['prospect', 'managed'] } },
          { [Op.and]: [{ invited_at: null }, { [Op.or]: [{ status: null }, { status: { [Op.ne]: 'invited' } }] }] },
        ] },
      ],
    };
  }
  return null;
}

// ─── 관계 축 판정 — 직접 관리 고객(docs/CLIENT_MANAGED_DESIGN.md, Fable 2026-10-15) ───
//   화면은 응답의 can_invite · email_editable 만 본다(status 를 보고 스스로 판정하지 않는다).

/** 초대 메일을 보내 **같은 행을** invited 로 올릴 수 있는가 — 계정·초대 흔적이 없는 문의/직접 관리 고객. */
function canInviteClient(client) {
  if (!client) return false;
  return !client.user_id && (client.status === 'prospect' || client.status === 'managed');
}

/** 받는 주소(invite_email)를 고칠 수 있는가 — 초대 토큰이 나가면 토큰과 받는 주소가 갈라지므로 잠근다. */
function emailEditable(client) {
  if (!client) return false;
  return !client.user_id && !client.invite_token && (client.status === 'prospect' || client.status === 'managed');
}

/** 보관 해제 때 되살릴 상태 — 증거로 파생한다. 계정 → active · 초대 흔적 → invited · 그 외 → managed. */
function reactivatedStatusOf(client) {
  if (client.user_id) return 'active';
  if (client.invited_at || client.invite_token) return 'invited';
  return 'managed';
}

/**
 * 고객 목록에 access_kind · has_guest_link 를 붙인다. 입력은 Client 인스턴스나 plain 객체.
 * 살아 있는 게스트 링크 = 회수 안 됨 + 만료 전.
 */
async function withAccess(businessId, clients) {
  // ★ 판정은 **원본 행**에서 한다 — toJSON 은 invite_token 을 내린다(models/index.js 전역 toJSON).
  const src = clients || [];
  const list = src.map((c) => (c && c.toJSON ? c.toJSON() : { ...c }));
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
  return list.map((c, i) => ({
    ...c,
    access_kind: accessKindOf(c),
    has_guest_link: linked.has(c.id),
    can_invite: canInviteClient(src[i]),
    email_editable: emailEditable(src[i]),
  }));
}

/**
 * 고객에 연결된 프로젝트 — project_clients 행의 술어 **한 벌**(2026-10-16 고객 화면 통합).
 *   client_id 로 붙은 행(계정 없는 고객도) + 계정이 있으면 contact_user_id 로 붙은 옛 행.
 *   옛 설정 화면은 contact_user_id 만 봐서 계정 없는 고객의 프로젝트가 0 으로 보였다.
 */
function projectLinkWhere(client) {
  const or = [{ client_id: client.id }];
  if (client.user_id) or.push({ contact_user_id: client.user_id });
  return { [Op.or]: or };
}

/**
 * 여러 고객의 연결 프로젝트를 한 번에 — Map<clientId, [{id,name,status,link_id}]>(프로젝트 중복 제거).
 * 같은 술어(projectLinkWhere)를 묶어서 쓴다.
 */
async function projectsByClient(businessId, clients) {
  const out = new Map();
  const list = (clients || []).filter(Boolean);
  for (const c of list) out.set(c.id, []);
  if (!list.length) return out;
  const { ProjectClient, Project } = require('../models');
  const ids = list.map((c) => c.id);
  const userIds = list.map((c) => c.user_id).filter(Boolean);
  const or = [{ client_id: { [Op.in]: ids } }];
  if (userIds.length) or.push({ contact_user_id: { [Op.in]: userIds } });
  const rows = await ProjectClient.findAll({
    where: { [Op.or]: or },
    include: [{ model: Project, attributes: ['id', 'name', 'status'], where: { business_id: businessId }, required: true }],
    attributes: ['id', 'project_id', 'client_id', 'contact_user_id'],
  });
  const byUser = new Map(list.filter((c) => c.user_id).map((c) => [c.user_id, c.id]));
  const seen = new Map();
  for (const r of rows) {
    const owners = new Set();
    if (r.client_id && out.has(r.client_id)) owners.add(r.client_id);
    if (r.contact_user_id && byUser.has(r.contact_user_id)) owners.add(byUser.get(r.contact_user_id));
    for (const cid of owners) {
      const key = `${cid}:${r.Project.id}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      out.get(cid).push({ id: r.Project.id, name: r.Project.name, status: r.Project.status, link_id: r.id });
    }
  }
  return out;
}

module.exports = {
  accessKindOf, accessWhere, withAccess, canInviteClient, emailEditable, reactivatedStatusOf,
  projectLinkWhere, projectsByClient,
};
