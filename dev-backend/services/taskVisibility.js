// 업무 공개 범위·보안등급 — 바꾸는 값 정규화 **한 곳** (2026-10-12, docs/TASK_SECURITY_LEVEL_DESIGN.md).
//   규칙은 문서(routes/posts.js PUT /:id/visibility · /:id/security-level)와 같다:
//     · L2 는 대상이 있어야 한다 — «특정 멤버»(target_member_ids) 또는 이 업무의 프로젝트.
//     · L4(외부)는 보안등급이 일반일 때만.
//     · 좁히면(L1·L2) 이미 나간 공유 링크를 끊는다(share_helper.shareOffPatch).
//     · 등급을 일반 밖으로 올리면 링크를 끊고, 외부(L4)였으면 워크스페이스(L3)로 내린다.
//   PUT /api/tasks/by-business 가 부르고, 시리즈 전파는 patchRevokesShare 로 같은 판정을 쓴다.
const { BusinessMember } = require('../models');
const { isValidLevel } = require('./securityLevel');
const sh = require('./share_helper');

const VLEVELS = ['L1', 'L2', 'L3', 'L4'];

async function normalizeVisibilityPatch(task, { vlevel, target_member_ids, security_level, project_id }) {
  const patch = {};
  const nextSec = security_level !== undefined ? String(security_level) : task.security_level;
  if (security_level !== undefined && !isValidLevel(nextSec)) return { ok: false, code: 'invalid_security_level' };

  let nextV = vlevel !== undefined ? String(vlevel) : task.vlevel;
  if (!VLEVELS.includes(nextV)) return { ok: false, code: 'invalid_vlevel' };

  let targets = null;
  if (nextV === 'L2') {
    const raw = target_member_ids !== undefined ? target_member_ids
      : (vlevel !== undefined ? [] : task.target_member_ids);
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length) {
      // 지정 멤버는 이 워크스페이스 멤버만(고객·AI 제외) — 다른 워크스페이스 사람을 넣으면 거절한다.
      const rows = await BusinessMember.findAll({
        where: { business_id: task.business_id, user_id: ids, removed_at: null },
        attributes: ['user_id', 'role'],
      });
      const ok = new Set(rows.filter((r) => !['ai', 'client'].includes(r.role)).map((r) => r.user_id));
      if (ids.some((id) => !ok.has(id))) return { ok: false, code: 'invalid_target_members' };
      targets = ids;
    } else if (!project_id) {
      return { ok: false, code: 'l2_requires_project_or_members' };
    }
  }

  if (nextV === 'L4' && nextSec !== 'general') {
    if (vlevel !== undefined && vlevel === 'L4') return { ok: false, code: 'security_level_blocks_share', http: 403 };
    nextV = 'L3';   // 등급을 올리면서 외부였던 것 — 워크스페이스로 내린다(문서와 같다)
  }

  if (nextV !== task.vlevel) patch.vlevel = nextV;
  const curTargets = JSON.stringify(task.target_member_ids || null);
  if (JSON.stringify(targets) !== curTargets) patch.target_member_ids = targets;
  if (nextSec !== task.security_level) patch.security_level = nextSec;

  if (patchRevokesShare({ vlevel: nextV, security_level: nextSec })) Object.assign(patch, sh.shareOffPatch(task));
  return { ok: true, patch };
}

/** 이 값으로 바꾸면 나가 있던 공유 링크를 끊어야 하는가 — 좁힘(L1·L2) 또는 일반 밖 등급. */
function patchRevokesShare(p) {
  return (p.vlevel !== undefined && sh.narrowsShare(p.vlevel))
    || (p.security_level !== undefined && p.security_level !== 'general');
}

module.exports = { normalizeVisibilityPatch, patchRevokesShare, VLEVELS };
