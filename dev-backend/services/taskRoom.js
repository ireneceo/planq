// 업무 실시간 방송 — **한 문** (2026-10-12, 업무 공개 범위 · docs/TASK_SECURITY_LEVEL_DESIGN.md).
//
// 왜: 업무 행 전체(제목·설명·결과물)가 `business:<id>`(워크스페이스 멤버 전원)·`project:<id>` 방으로 나갔다.
//   업무에 «나만 보기»·«특정 멤버»·«프로젝트» 범위가 생기면 REST 는 막아도 방송이 먼저 제목을 흘린다
//   (CLAUDE.md «실시간 방송은 신호만» · projectRoom 머리말과 같은 사고).
//
// 계약:
//   - L3·L4(워크스페이스·외부) 업무 · 값이 없는 부분 방송 · 삭제 → 종전대로(프로젝트 방 + 워크스페이스 방).
//   - L1·L2 업무 → 볼 수 있는 사람(access_scope.canAccessTask 와 같은 집합)의 `user:<id>` 방에만 행을 보낸다.
//     그 밖의 워크스페이스·프로젝트 방에는 `task:deleted` 신호만(except) — 범위를 좁힌 순간 다른 화면에서 사라진다.
//     볼 수 있는 고객(이름이 박힌 관계자)에게는 고객용 직렬화(taskClientView)로.
//   - 업무 행 방송은 이 함수로 보낸다. `io.to(\`business:…\`).emit('task:…')` 를 새로 쓰지 않는다.
'use strict';

const { Op } = require('sequelize');

const OPEN = new Set(['L3', 'L4']);

function signalOf(p) {
  return { id: p.id ?? null, business_id: p.business_id ?? null, project_id: p.project_id ?? null };
}

function targetsOf(p) {
  let a = p.target_member_ids;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = []; } }
  return Array.isArray(a) ? a.map(Number).filter(Boolean) : [];
}

/** 이 업무를 볼 수 있는 사람 — canAccessTask 와 같은 집합(L1·L2, 그리고 숨은 프로젝트의 L3·L4 — 아래 emitTask). */
async function viewerIds(p, hidden = null) {
  const { BusinessMember, ProjectMember } = require('../models');
  // 이름 박힌 사람(담당·작성·요청·컨펌·참조) — canAccessTask ① 과 같은 한 벌
  const ids = await require('../middleware/access_scope').namedTaskUserIds(p);
  // 숨은 프로젝트(참여 멤버만)의 L3·L4 는 «프로젝트 L2» 와 같은 청중이다(관리자 + 프로젝트 멤버 + 관계 고객). 2026-10-16
  if (p.vlevel === 'L2' || (hidden && (OPEN.has(p.vlevel) || !p.vlevel))) {
    const admins = await BusinessMember.findAll({
      where: { business_id: p.business_id, role: { [Op.in]: ['owner', 'admin'] }, removed_at: null }, attributes: ['user_id'],
    });
    for (const a of admins) ids.add(Number(a.user_id));
    const targets = p.vlevel === 'L2' ? targetsOf(p) : [];
    if (targets.length) targets.forEach((id) => ids.add(id));
    else {
      if (p.project_id) {
        const pms = await ProjectMember.findAll({ where: { project_id: p.project_id }, attributes: ['user_id'] });
        // 내보낸 멤버의 프로젝트 멤버 행은 남는다 — 현직(removed_at NULL)만(2026-10-16 Fable 재검증)
        const pmIds = pms.map((m) => Number(m.user_id));
        if (pmIds.length) {
          for (const b of await BusinessMember.findAll({ where: { business_id: p.business_id, user_id: pmIds, removed_at: null }, attributes: ['user_id'] })) ids.add(Number(b.user_id));
        }
        // 프로젝트 L2 는 «관계로 닿는» 범위다 — 그 프로젝트 고객도 본다(canAccessTask ③). 고객용 직렬화로 간다(아래).
        const { ProjectClient } = require('../models');
        const pcs = await ProjectClient.findAll({ where: { project_id: p.project_id, contact_user_id: { [Op.ne]: null } }, attributes: ['contact_user_id'] });
        for (const c of pcs) ids.add(Number(c.contact_user_id));
      }
      if (p.conversation_id) {
        const { ConversationParticipant } = require('../models');
        // 대화 참여로 닿는 것은 **고객만**이다(멤버는 프로젝트 멤버십으로 판정 — canAccessTask ②)
        const parts = (await ConversationParticipant.findAll({ where: { conversation_id: p.conversation_id }, attributes: ['user_id'] }))
          .map((c) => Number(c.user_id)).filter(Boolean);
        if (parts.length) {
          const mem = new Set((await BusinessMember.findAll({ where: { business_id: p.business_id, user_id: parts, removed_at: null }, attributes: ['user_id'] })).map((m) => Number(m.user_id)));
          for (const u of parts) if (!mem.has(u)) ids.add(u);
        }
      }
    }
  }
  return ids;
}

/**
 * 업무 사건을 보낸다. payload 는 업무 행(직렬화본) — business_id·project_id·vlevel 을 싣는다.
 * opts.businessId / opts.projectId 는 payload 에 없을 때의 보충.
 */
async function emitTask(io, event, payload, opts = {}) {
  if (!io || !payload) return;
  const bizId = payload.business_id ?? opts.businessId;
  const projectId = payload.project_id ?? opts.projectId;
  const { emitProject } = require('./projectRoom');
  // 숨은 프로젝트(참여 멤버만)면 L3·L4 업무도 워크스페이스 방에 행을 싣지 않는다(2026-10-16 · Fable 검증 FAIL ②).
  //   vlevel 을 안 실었어도 제목·설명이 실린 행이면 같은 판정을 탄다(앞으로 축약 payload 가 생겨도 새지 않게 — Fable 재검증 비차단).
  //   제목 없는 부분 방송({id, workstream_id} 등)은 종전대로 — 막으면 참여 멤버 화면이 그 행을 지운다.
  const carriesContent = !!payload.vlevel || payload.title !== undefined || payload.description !== undefined;
  const hidden = (event !== 'task:deleted' && carriesContent && projectId)
    ? await require('../middleware/access_scope').hiddenProjectAudience(projectId) : null;
  const restricted = event !== 'task:deleted' && ((payload.vlevel && !OPEN.has(payload.vlevel)) || !!hidden);
  if (!restricted) {
    if (projectId) emitProject(io, projectId, event, payload);
    if (bizId) io.to(`business:${bizId}`).emit(event, payload);
    return;
  }
  let ids = [...(await viewerIds({ ...payload, business_id: bizId, project_id: projectId }, hidden))];
  if (hidden) {
    // 숨은 프로젝트 — 직원은 «프로젝트를 볼 수 있는 사람 ∪ 이름이 박힌 사람» 만(canAccessTask 와 같은 선). 고객(비멤버)은 위 관계 판정 그대로.
    const named = await require('../middleware/access_scope').namedTaskUserIds(payload);
    const { BusinessMember: BM } = require('../models');
    const staff = new Set((await BM.findAll({ where: { business_id: bizId, user_id: ids, removed_at: null }, attributes: ['user_id'] })).map((m) => Number(m.user_id)));
    ids = ids.filter((id) => !staff.has(id) || hidden.has(id) || named.has(id));
  }
  const rooms = ids.map((id) => `user:${id}`);
  const sig = signalOf({ ...payload, business_id: bizId, project_id: projectId });
  // 볼 수 없는 사람 — 신호만(이미 들고 있던 행을 지운다)
  if (bizId) io.to(`business:${bizId}`).except(rooms).emit('task:deleted', sig);
  if (projectId) require('./projectRoom').emitProjectTaskHidden(io, projectId, sig, rooms);
  if (!ids.length) return;
  // 볼 수 있는 사람 — 멤버는 행 그대로, 고객은 고객용 직렬화
  const { BusinessMember } = require('../models');
  const members = new Set((await BusinessMember.findAll({
    where: { business_id: bizId, user_id: ids, removed_at: null, role: { [Op.notIn]: ['client'] } }, attributes: ['user_id'],
  })).map((m) => Number(m.user_id)));
  const memberRooms = ids.filter((id) => members.has(id)).map((id) => `user:${id}`);
  const clientRooms = ids.filter((id) => !members.has(id)).map((id) => `user:${id}`);
  if (memberRooms.length) io.to(memberRooms).emit(event, payload);
  if (clientRooms.length) {
    const { serializeTaskForClient } = require('../utils/taskClientView');
    io.to(clientRooms).emit(event, serializeTaskForClient(payload));
  }
}

module.exports = { emitTask, viewerIds };
