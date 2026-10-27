// services/actions/workstream_actions.js — 추진과제(워크스트림) **만들기**의 행동 계층 (2026-10-27, Fable 설계 PASS — docs/AGENT_WORKSTREAM_DESIGN.md)
//
// 왜 생겼나: ChatGPT 가 «PlanQ 연결에는 추진과제 생성·그룹 배정 기능이 없어» 라며 그룹 이름을 업무 설명에 적어 두고
//   «실제 구성은 브라우저 작업» 으로 넘겼다(Irene «이거 되어야 해»). 생성 규칙은 `routes/projects.js POST /:id/workstreams`
//   안에만 있었다 → 화면(라우트)과 AI(create_workstream)가 **같은 함수**를 부른다(task/project/post actions 와 같은 이유).
//
// 규칙은 옛 라우트 그대로 — 게이트 loadProjectOrForbidden + 고객 거절 · 순서는 맨 뒤 · 감사 project.workstream_create · 캔버스 신호.
//   더한 것 둘:
//   ① businessId 묶음 — loadProjectOrForbidden 은 findByPk 라 같은 사람이 멤버인 **다른 워크스페이스** 프로젝트도 통과시킨다.
//      AI 토큰은 워크스페이스 하나가 범위이므로 그 밖의 프로젝트는 404 로 끊는다(Fable 필수 수정 1).
//   ② dedupeByName(AI 경로만) — 같은 프로젝트에 같은 이름(normalizeWorkstreamTitle)이 있으면 새로 만들지 않고 그것을 돌려준다.
//      나눠 올리거나 다시 시켜도 그룹이 두 벌 생기지 않게. 화면은 종전처럼 항상 새로 만든다.
const { Project, ProjectWorkstream } = require('../../models');
const { resolveSubject, fail, done } = require('./_subject');

function getIO() { return global.__planqIo || null; }

/** 그룹 이름 비교 키 — 공백·대소문자만 무시한 정확 일치. AI 루틴 확정·AI 업무추가 이름 대조(routes/tasks.js)와 한 벌. */
function normalizeWorkstreamTitle(title) {
  return String(title || '').replace(/\s+/g, '').toLowerCase();
}

/** 캔버스 변경 신호 — 캔버스·업무 목록이 듣는 `project:updated`(+`inbox:refresh`). routes/projects.js broadcastCanvas 도 이것을 부른다. */
function signalCanvas(io, project, actorUserId, reason) {
  if (!io) return;
  const payload = { id: project.id, business_id: project.business_id, actor_user_id: actorUserId };
  require('../projectRoom').emitBusinessForProject(io, project.business_id, project.id, 'project:updated', payload).catch(() => {});
  require('../projectRoom').emitProject(io, project.id, 'project:updated', payload);
  io.to(`business:${project.business_id}`).emit('inbox:refresh', { reason, project_id: project.id });
}

function audit(actor, entry) {
  const via = actor?.channel?.kind === 'agent'
    ? { via: `agent:${actor.channel.provider || 'unknown'}`, agent_grant_id: actor.channel.grant_id || null }
    : null;
  const e = via && entry.newValue && typeof entry.newValue === 'object' ? { ...entry, newValue: { ...entry.newValue, ...via } } : entry;
  require('../auditService').logAudit(actor?.req || null, { userId: actor?.userId || null, ...e });
}

/**
 * 추진과제 만들기 — `POST /api/projects/:id/workstreams` 와 같은 규칙.
 * @param actor  { kind:'user'|'cue', userId, platformRole?, req?, channel? }
 * @param params { projectId, businessId?, title, description?, color?, dedupeByName? }
 *   businessId 를 주면 그 워크스페이스 프로젝트만(AI 경로는 반드시 준다).
 * @returns {ok:true, data:{ workstream, project, created, matched }} | {ok:false, code, http}
 */
async function createWorkstream(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const projectId = Number(params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) return fail('project_not_found', 404);
  if (params.businessId != null) {
    const inWs = await Project.findOne({ where: { id: projectId, business_id: params.businessId }, attributes: ['id'] });
    if (!inWs) return fail('project_not_found', 404);
  }
  const { loadProjectOrForbidden } = require('../projectAccess');
  const { project, role, error } = await loadProjectOrForbidden(projectId, subj.subjectId);
  if (error) return fail(error.message, error.code);
  if (role === 'client') return fail('member_only', 403);

  const title = String(params.title || '').trim().slice(0, 200);
  if (!title) return fail('title_required', 400);

  if (params.dedupeByName) {
    const key = normalizeWorkstreamTitle(title);
    const rows = await ProjectWorkstream.findAll({ where: { project_id: project.id, business_id: project.business_id }, order: [['order_index', 'ASC'], ['id', 'ASC']] });
    const same = rows.find((w) => normalizeWorkstreamTitle(w.title) === key);
    if (same) return done({ workstream: same, project, created: false, matched: true });
  }

  const max = await ProjectWorkstream.max('order_index', { where: { project_id: project.id } });
  const ws = await ProjectWorkstream.create({
    business_id: project.business_id, project_id: project.id,
    title,
    description: params.description ? String(params.description) : null,
    color: params.color || null,
    order_index: (Number.isFinite(max) ? max : -1) + 1,
    created_by: subj.subjectId,
  });
  audit(actor, { action: 'project.workstream_create', targetType: 'project_workstream', targetId: ws.id, businessId: project.business_id, newValue: { project_id: project.id, title: ws.title } });
  signalCanvas(getIO(), project, actor.userId, 'workstream_new');
  return done({ workstream: ws, project, created: true, matched: false });
}

module.exports = { createWorkstream, normalizeWorkstreamTitle, signalCanvas };
