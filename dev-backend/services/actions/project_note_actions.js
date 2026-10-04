// 행동 계층 — 프로젝트 메모(project_notes) 쓰기.
//
//   여태 생성이 `routes/projects.js` POST /:id/notes 안에 인라인으로만 있었다. AI 에이전트 도구(#439 add_project_note)가
//   같은 일을 해야 해서 여기로 뽑았다 — 베끼면 고객 personal 강제·대화방 소속 확인·감사·실시간이 한쪽에만 남는다.
//   사람(라우트)과 AI(services/agent/tools/notes.js)가 이 함수 하나를 쓴다.
const { ProjectNote, Conversation, User } = require('../../models');
const { loadProjectOrForbidden } = require('../projectAccess');
const { resolveSubject, fail } = require('./_subject');

function getIO() { return global.__planqIo || null; }

function audit(actor, entry) {
  // 외부 AI 에이전트를 거친 변경은 같은 행에 경유를 싣는다(task_actions.audit 와 같은 모양). channel 은 표시 전용.
  const via = actor?.channel?.kind === 'agent'
    ? { via: `agent:${actor.channel.provider || 'unknown'}`, agent_grant_id: actor.channel.grant_id || null }
    : null;
  const e = via && entry.newValue ? { ...entry, newValue: { ...entry.newValue, ...via } } : entry;
  require('../auditService').logAudit(actor?.req || null, { userId: actor?.userId || null, ...e });
}

/**
 * 프로젝트 메모 1건.
 * @param actor  { kind, userId, platformRole?, req?, channel? }
 * @param params { projectId, body, visibility?('internal'|'personal'), conversationId?, businessId? }
 *   businessId 를 주면 그 워크스페이스의 프로젝트만 받는다(AI 경로 — 토큰의 워크스페이스). 다르면 not_found.
 * @returns { ok:true, data:{ note, project } } | { ok:false, code, http }
 */
async function createProjectNote(actor, params = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const text = String(params.body || '').trim();
  if (!text) return fail('body_required');
  const { project, role, error } = await loadProjectOrForbidden(Number(params.projectId), subj.subjectId);
  if (error) return fail(error.message, error.code);
  // 워크스페이스 묶음 — 남의 워크스페이스 프로젝트는 "있다" 는 것조차 알리지 않는다
  if (params.businessId && Number(project.business_id) !== Number(params.businessId)) return fail('project_not_found', 404);
  // 고객은 personal 만 작성 가능
  let vis = params.visibility === 'internal' ? 'internal' : 'personal';
  if (role === 'client') vis = 'personal';
  // conversation_id 옵션 — 같은 프로젝트 소속 대화인지 검증
  let convIdToStore = null;
  if (params.conversationId) {
    const conv = await Conversation.findByPk(params.conversationId);
    if (conv && conv.project_id === project.id) convIdToStore = conv.id;
  }
  const note = await ProjectNote.create({
    project_id: project.id,
    conversation_id: convIdToStore,
    author_user_id: subj.subjectId,
    visibility: vis,
    body: text,
  });
  audit(actor, {
    action: 'project_note.create', targetType: 'project_note', targetId: note.id, businessId: project.business_id,
    newValue: { project_id: project.id, conversation_id: convIdToStore, visibility: vis }, // 본문은 싣지 않는다
  });
  const full = await ProjectNote.findByPk(note.id, {
    include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
  });
  // 내부 메모는 프로젝트 room 에만 (personal 은 본인만 볼 수 있으므로 방송 안 함)
  if (vis === 'internal') {
    const io = getIO();
    if (io) io.to(`project:${project.id}`).emit('note:new', full.toJSON());
  }
  return { ok: true, data: { note: full, project } };
}

module.exports = { createProjectNote };
