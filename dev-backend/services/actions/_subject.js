// 행동 계층 공용 — 위임 주체(subject) 해석 + 메뉴 쓰기 권한.
//
//   사람도 Cue 도 외부 에이전트도 이 문을 지난다. task/event/document 생성 액션이 공유한다.
//   원본은 task_actions.js 안에 있었으나 event_actions·document_actions 가 같은 규칙을 써야 해서
//   여기로 뽑았다 — 규칙을 두 벌로 두면 한쪽만 고쳐지는 회귀가 난다.

const { User } = require('../../models');
const { getMemberMenuLevels } = require('../../middleware/menu_permission');

// ─────────────────────────────────────────────
// 위임 주체 (subject) — "트리거한 사람이 아니라 **위임자** 기준"
//
//   Cue 가 무언가를 만들 때, 권한은 Cue 가 아니라 그 일을 맡긴 사람의 것이다. 위임자가 없으면
//   아무것도 만들지 못한다(fail-closed). 위임자가 또 AI 면 거부 — AI→AI 로 권한을 세탁할 수 없다.
//   생성물의 created_by 도 subject(사람)다. "누가 실제로 손을 움직였나" 는 감사 로그에 남는다.
// ─────────────────────────────────────────────
async function resolveSubject(actor) {
  if (!actor || !actor.userId) return { ok: false, code: 'actor_required', http: 403 };
  if (actor.kind !== 'cue') {
    return { ok: true, subjectId: actor.userId, platformRole: actor.platformRole || null };
  }
  if (!actor.onBehalfOfUserId) return { ok: false, code: 'cue_delegator_required', http: 403 };
  const u = await User.findByPk(actor.onBehalfOfUserId, { attributes: ['id', 'is_ai', 'platform_role'] });
  if (!u) return { ok: false, code: 'delegator_not_found', http: 403 };
  if (u.is_ai) return { ok: false, code: 'delegator_is_ai', http: 403 };
  return { ok: true, subjectId: u.id, platformRole: u.platform_role || null };
}

// 메뉴 쓰기 권한 — 여태 생성 라우트가 이걸 전혀 안 봤다 (qtask/qcalendar/qdocs='none' 인 멤버도 만들 수 있었다).
//   row 없음 = write (열린 문화 기본값). owner/admin/platform_admin 통과. 고객(Client)은 멤버가 아니라 비적용.
async function assertMenuWrite(subjectId, businessId, menuKey, platformRole = null) {
  if (platformRole === 'platform_admin') return { ok: true };
  const levels = await getMemberMenuLevels(businessId, subjectId);
  if (!levels) return { ok: true };   // 멤버가 아님 → 고객 규칙이 따로 판단한다
  if (levels.role === 'owner' || levels.role === 'admin') return { ok: true };
  if (levels.menus[menuKey] === 'write') return { ok: true };
  return { ok: false, code: `menu_forbidden:${menuKey}`, http: 403 };
}

const fail = (code, http = 400) => ({ ok: false, code, http });
const done = (data) => ({ ok: true, data });

module.exports = { resolveSubject, assertMenuWrite, fail, done };
