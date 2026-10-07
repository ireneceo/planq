// AI 에이전트 도구 — 프로젝트 만들기 (2026-10-07, Fable B 판정 2 · Irene "fable 판정대로 해").
//
//   create_project 는 **MEDIUM(확인 2단계)** 다 — 계정 있는 고객을 붙이면 그 고객에게 프로젝트와 고객 채팅방이 바로
//   보인다(가시성 확대). 그래서 미리보기에 **연결될 고객·멤버 이름**을 적고, 요금제 한도는 미리보기에서 먼저 본다
//   (거절될 요청에 확인 토큰을 내주지 않는다 — M2-b 규칙).
//   ★ 고객은 **이미 있는** 이 워크스페이스 고객만, 멤버는 **이미 멤버인** 사람만. 새 고객·초대 메일·멤버 초대는 없다(HIGH·외부 발송).
//   ★ 쓰기는 행동 계층 project_actions.createProject 하나(화면 POST /api/projects 와 같은 함수). 여기서 모델을 쓰지 않는다.
const cfg = require('../../agent_oauth/config');
const { err, fromActionFailure } = require('../errors');
const { assertMenu } = require('../menu');

async function validDates(a) {
  const { validDate } = require('./tasks');
  if (!validDate(a.start_date) || !validDate(a.end_date)) throw err('VALIDATION_ERROR', 'invalid_date', { fields: { start_date: a.start_date, end_date: a.end_date } });
  if (a.start_date && a.end_date && a.end_date < a.start_date) throw err('VALIDATION_ERROR', 'end_before_start');
}

/** 붙일 멤버 — 지금 이 워크스페이스의 사람 멤버(owner·admin·member, AI 제외)만. 하나라도 아니면 거절(누가 빠졌는지 알린다). */
async function resolveMembers(p, ids) {
  const want = [...new Set((ids || []).map(Number))];
  if (!want.length) return [];
  const { BusinessMember, User } = require('../../../models');
  const { getMemberNameMap } = require('../../displayName');
  const rows = await BusinessMember.findAll({
    where: { business_id: p.businessId, user_id: want, removed_at: null, role: ['owner', 'admin', 'member'] },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'is_ai'], required: true }],
  });
  const ok = rows.filter((r) => r.user && !r.user.is_ai);
  const okIds = new Set(ok.map((r) => r.user_id));
  const bad = want.filter((id) => !okIds.has(id));
  if (bad.length) throw err('PERMISSION_DENIED', 'not_workspace_members', { user_ids: bad, hint: 'Use search_members to find user_id. Only existing members of this workspace can be added; PlanQ does not invite new people here.' });
  const names = await getMemberNameMap(p.businessId, want).catch(() => new Map());
  return ok.map((r) => ({ user_id: r.user_id, name: names.get(r.user_id)?.name || r.user.name || null }));
}

/** 붙일 고객 — 이 워크스페이스에 **이미 있는** 고객만. 남의 워크스페이스 id 는 존재 여부를 흘리지 않고 NOT_FOUND. */
async function resolveClients(p, ids) {
  const want = [...new Set((ids || []).map(Number))];
  if (!want.length) return [];
  await assertMenu(p, 'qsale', 'read');
  const { resolveExistingClients } = require('../../actions/project_actions');
  const rows = await resolveExistingClients(p.businessId, want);
  if (rows === null) throw err('NOT_FOUND', 'client_not_found', { hint: 'Use search_clients to find client_id. Only existing clients of this workspace can be linked; PlanQ does not create or invite clients here.' });
  return rows.map((c) => ({
    client_id: c.id, name: c.display_name || c.company_name || null,
    // 계정이 있으면 프로젝트·고객 채팅방이 그 고객에게 바로 보인다 — 미리보기에서 사람이 알아야 하는 사실
    has_planq_account: !!c.user_id,
  }));
}

async function previewCreateProject(p, a) {
  await assertMenu(p, 'qtask', 'write');
  await validDates(a);
  // 실행과 같은 판정을 먼저 — 요금제 한도(진행 중 프로젝트 수)
  const plan = require('../../plan');
  const can = await plan.can(p.businessId, 'create_project');
  if (!can.ok) throw err('QUOTA_EXCEEDED', can.reason || 'project_limit', { limit: can.limit ?? null, current: can.current ?? null });
  const members = await resolveMembers(p, a.member_user_ids);
  const clients = await resolveClients(p, a.client_ids);
  const { memberName } = require('./tasks');
  const me = { user_id: p.userId, name: await memberName(p, p.userId) };
  const kind = a.kind === 'internal' ? 'internal' : 'client';
  const visibleTo = clients.filter((c) => c.has_planq_account).map((c) => c.name);
  return {
    project: {
      name: a.name, kind, project_type: a.project_type || 'fixed',
      start_date: a.start_date || null, end_date: a.end_date || null, stage_template: a.stage_template || null,
      description: a.description ? `${a.description.slice(0, 200)}${a.description.length > 200 ? '…' : ''}` : null,
    },
    members: [me, ...members.filter((m) => m.user_id !== p.userId)],
    clients,
    channels: kind === 'client' ? ['internal chat', 'client chat'] : ['internal chat'],
    note: visibleTo.length
      ? `These clients have a PlanQ account and will see this project and their client chat right away: ${visibleTo.join(', ')}. No email is sent.`
      : 'No email or invitation is sent.',
  };
}

async function createProject(p, a, actor) {
  await assertMenu(p, 'qtask', 'write');
  await validDates(a);
  const members = await resolveMembers(p, a.member_user_ids);
  const clients = await resolveClients(p, a.client_ids);
  const kind = a.kind === 'internal' ? 'internal' : 'client';
  const actions = require('../../actions/project_actions');
  const r = await actions.createProject(actor, {
    businessId: p.businessId,
    name: a.name,
    description: a.description || null,
    startDate: a.start_date || null,
    endDate: a.end_date || null,
    projectType: a.project_type || 'fixed',
    kind,
    stageTemplate: a.stage_template,
    members: members.map((m) => ({ user_id: m.user_id })),
    clientIds: clients.map((c) => c.client_id),
    // 채널 — 화면 기본값과 같다(내부 + 고객 프로젝트면 고객 채널). 참여자는 프로젝트 멤버 전원.
    channels: [{ channel_type: 'internal' }, ...(kind === 'client' ? [{ channel_type: 'customer' }] : [])],
  });
  if (!r.ok) {
    if (r.code === 'quota_exceeded') throw err('QUOTA_EXCEEDED', r.planCan?.reason || 'project_limit', { limit: r.planCan?.limit ?? null, current: r.planCan?.current ?? null });
    if (r.code === 'invalid_client') throw err('NOT_FOUND', 'client_not_found');
    throw fromActionFailure(r);
  }
  const pr = r.data.project;
  return {
    project: {
      project_id: pr.id, name: pr.name, kind: pr.kind, project_type: pr.project_type,
      start_date: pr.start_date || null, end_date: pr.end_date || null,
      member_count: r.data.memberCount,
      clients: r.data.clients.map((c) => ({ client_id: c.id, name: c.name, has_planq_account: !!c.user_id })),
      url: `${cfg.APP_URL}/projects/p/${pr.id}`,
    },
    created: true,
  };
}

module.exports = { previewCreateProject, createProject };
