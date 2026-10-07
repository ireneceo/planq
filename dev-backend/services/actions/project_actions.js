// services/actions/project_actions.js — 프로젝트 **만들기**의 행동 계층 (2026-10-07, Fable B 판정 2 · Irene "fable 판정대로 해")
//
// 왜 생겼나: AI 에이전트(ChatGPT·Claude)도 프로젝트를 만들 수 있어야 한다(create_project). 생성 규칙은
//   `routes/projects.js POST /` 안에만 있었다. AI 도구가 모델을 직접 쓰거나 라우트를 베끼면 요금제 한도·멤버 검증·
//   거래 단계 시드·감사·실시간이 한쪽에서 빠진다 → 화면(라우트)과 AI(도구)가 **같은 함수**를 부른다.
//   (업무 task_actions · 일정 event_actions · 문서 post_actions 와 같은 이유.)
//
// 규칙은 옛 라우트 그대로다 — 화면 동작을 바꾸지 않는다. 더한 것은 둘:
//   ① `clientIds` — **이미 있는** 이 워크스페이스 고객을 붙인다(POST /:id/clients 의 client_id 분기와 같은 규칙:
//      contact_user_id = 고객의 계정). 계정 있는 고객은 커밋 뒤 joinProjectCustomerChannels 로 그 고객의 방에 들인다.
//      ★ 초대 메일은 보내지 않는다 — 외부 발송은 이 문의 일이 아니다(화면의 «이름·이메일로 초대» 는 contacts 로 남는다).
//   ② 생성 직후 `project:new` 신호 — 복사 라우트는 이미 쏘는데 생성만 안 쏴서 다른 창 목록이 안 늘었다.
const crypto = require('crypto');
const { sequelize } = require('../../config/database');
const {
  Project, ProjectMember, ProjectClient, ProjectStatusOption,
  Conversation, ConversationParticipant, BusinessMember, Business, Client,
} = require('../../models');
const { resolveSubject, fail, done } = require('./_subject');

function getIO() { return global.__planqIo || null; }

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_STATUS_OPTIONS = [
  { status_key: 'not_started', label: '미시작', color: '#94A3B8', order_index: 0 },
  { status_key: 'in_progress', label: '진행중', color: '#14B8A6', order_index: 1 },
  { status_key: 'done', label: '완료', color: '#22C55E', order_index: 2 },
  { status_key: 'hold', label: '보류', color: '#F59E0B', order_index: 3 },
];

/** 붙일 수 있는 기존 고객 — 이 워크스페이스 것만. 하나라도 아니면 null(부분 연결을 하지 않는다). */
async function resolveExistingClients(businessId, clientIds, { transaction } = {}) {
  const ids = [...new Set((clientIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const rows = await Client.findAll({
    where: { id: ids, business_id: businessId },
    attributes: ['id', 'user_id', 'display_name', 'company_name', 'invite_email', 'status'],
    transaction,
  });
  if (rows.length !== ids.length) return null;
  return rows;
}

/**
 * 프로젝트 만들기 — `POST /api/projects` 와 같은 규칙.
 * @param actor  { kind:'user'|'cue', userId, platformRole?, req?, channel? }
 * @param params {
 *   businessId, name, description?, clientCompany?, startDate?, endDate?, color?, projectType?('fixed'|'ongoing'),
 *   kind?('client'|'internal'), stageTemplate?, members?: [{user_id, role?, is_default?}],
 *   contacts?: [{name, email?}]     — 화면의 «새 고객 연락처»(초대 토큰만, 메일 X — 옛 라우트 동작 그대로)
 *   clientIds?: number[]            — 이미 있는 고객(이 워크스페이스)
 *   channels?: [{channel_type:'customer'|'internal', name?, participant_user_ids?}]
 * }
 * @returns {ok:true, data:{ project, memberCount, clients:[{id,user_id,name}] }} | {ok:false, code, http, planCan?}
 */
async function createProject(actor, params = {}, opts = {}) {
  const subj = await resolveSubject(actor);
  if (!subj.ok) return subj;
  const userId = subj.subjectId;
  const businessId = Number(params.businessId);
  const name = String(params.name || '').trim();
  if (!businessId || !name) return fail('business_id and name are required', 400);

  // 권한 — 이 워크스페이스 멤버(AI 멤버 제외). 옛 라우트 requireBusinessMember 와 같은 술어.
  const { requireBusinessMember } = require('../projectAccess');
  const bm = await requireBusinessMember(userId, businessId);
  if (!bm || bm.role === 'ai') return fail('You do not belong to this workspace', 403);

  // 요금제 — 진행 중 프로젝트 수
  const planEngine = require('../plan');
  const planCan = await planEngine.can(businessId, 'create_project');
  if (!planCan.ok) return { ok: false, code: 'quota_exceeded', http: 422, planCan };

  const existingClients = await resolveExistingClients(businessId, params.clientIds, opts);
  if (existingClients === null) return fail('invalid_client', 400);

  const members = Array.isArray(params.members) ? params.members.slice() : [];
  const contacts = Array.isArray(params.contacts) ? params.contacts : [];
  const projectType = params.projectType === 'ongoing' ? 'ongoing' : 'fixed';
  const kind = params.kind === 'internal' ? 'internal' : 'client';
  const defaultAssignee = members.find((m) => m.is_default)?.user_id || userId;

  const external = !!opts.transaction;
  const t = opts.transaction || await sequelize.transaction();
  let project; let pmRows = [];
  try {
    // 1) 프로젝트
    project = await Project.create({
      business_id: businessId,
      name,
      description: params.description ? String(params.description).trim() || null : null,
      client_company: params.clientCompany ? String(params.clientCompany).trim() || null : null,
      start_date: params.startDate || null,
      end_date: params.endDate || null,
      color: (params.color && HEX_RE.test(params.color)) ? params.color : null,
      project_type: projectType,
      kind,
      default_assignee_user_id: defaultAssignee,
      owner_user_id: userId,
    }, { transaction: t });

    // 2) 만든 사람은 항상 멤버(= PM)
    if (!members.some((m) => m.user_id === userId)) members.push({ user_id: userId, role: '기타', is_default: false });

    // 3) 멤버 — 이 워크스페이스 멤버만(아닌 id 는 조용히 건너뛴다 — 옛 라우트 동작)
    const validUserIds = new Set((await BusinessMember.findAll({
      where: { business_id: businessId, user_id: members.map((m) => m.user_id) }, transaction: t,
    })).map((x) => x.user_id));
    pmRows = members.filter((m) => validUserIds.has(m.user_id)).map((m) => ({
      project_id: project.id,
      user_id: m.user_id,
      role: (m.role && String(m.role).trim()) || '기타',
      role_order: 0,
      is_pm: m.user_id === userId,   // 생성자 = 프로젝트 owner = 자동 PM (PERMISSION_MATRIX §3)
    }));
    await ProjectMember.bulkCreate(pmRows, { transaction: t });

    // 4) 고객 — 화면의 새 연락처(초대 토큰) + 이미 있는 고객(client_id·contact_user_id)
    const pcRows = [];
    for (const c of contacts) {
      if (!c || !c.name || !String(c.name).trim()) continue;
      pcRows.push({
        project_id: project.id,
        contact_name: String(c.name).trim(),
        contact_email: c.email ? String(c.email).trim() || null : null,
        invite_token: crypto.randomBytes(24).toString('hex'),
        invited_by: userId,
      });
    }
    for (const cl of existingClients) {
      pcRows.push({
        project_id: project.id,
        client_id: cl.id,
        contact_user_id: cl.user_id || null,   // POST /:id/clients 의 client_id 분기와 같은 규칙
        contact_name: String(cl.display_name || cl.company_name || cl.invite_email || '').trim().slice(0, 100) || null,
        contact_email: cl.invite_email || null,
        invite_token: crypto.randomBytes(24).toString('hex'),
        invited_by: userId,
      });
    }
    await ProjectClient.bulkCreate(pcRows, { transaction: t });

    // 5) 프로세스 상태 옵션 기본값
    await ProjectStatusOption.bulkCreate(DEFAULT_STATUS_OPTIONS.map((o) => ({ ...o, project_id: project.id })), { transaction: t });

    // 6) 채팅 채널 — 명시적으로 넘긴 것만 만든다(프로젝트는 데이터 컨테이너)
    const channels = Array.isArray(params.channels) ? params.channels : [];
    if (channels.length) {
      const biz = await Business.findByPk(businessId, { transaction: t });
      const validMemberIds = new Set(pmRows.map((r) => r.user_id));
      for (const cv of channels) {
        const type = cv.channel_type === 'customer' ? 'customer' : 'internal';
        const title = String(cv.name || '').trim() || `${name} ${type === 'customer' ? '고객' : '내부'}`;
        const conv = await Conversation.create({
          business_id: businessId,
          project_id: project.id,
          title,
          channel_type: type,
          cue_enabled: type === 'customer',
          auto_extract_enabled: type === 'customer',
        }, { transaction: t });
        let participantIds = Array.isArray(cv.participant_user_ids)
          ? cv.participant_user_ids.filter((uid) => validMemberIds.has(uid))
          : pmRows.map((r) => r.user_id);
        if (!participantIds.includes(userId)) participantIds = [userId, ...participantIds];
        for (const uid of participantIds) {
          await ConversationParticipant.create({
            conversation_id: conv.id, user_id: uid, role: uid === userId ? 'owner' : 'member',
          }, { transaction: t });
        }
        if (type === 'customer' && biz?.cue_user_id) {
          await ConversationParticipant.create({ conversation_id: conv.id, user_id: biz.cue_user_id, role: 'member' }, { transaction: t });
        }
      }
    }

    // 7) 거래 시퀀스 단계 시드 (트랜잭션 안 — 멱등)
    const { seedStages, STAGE_TEMPLATE_KEYS } = require('../projectStageEngine');
    const tplKey = STAGE_TEMPLATE_KEYS.includes(params.stageTemplate)
      ? params.stageTemplate
      : (projectType === 'ongoing' ? 'subscription' : 'fixed');
    await seedStages(project.id, tplKey, t);

    if (!external) await t.commit();
  } catch (e) {
    if (!external) await t.rollback();
    throw e;
  }

  // ── 커밋 뒤 부수효과 ──
  const after = async () => {
    require('../projectStageEngine').progressProject(project.id).catch(() => null);
    // 계정 있는 고객 — 그 고객의 방에 들인다(프로젝트 × 고객 채널, 한 함수)
    for (const cl of existingClients) {
      if (!cl.user_id) continue;
      try {
        await require('../clientOnboarding').joinProjectCustomerChannels({
          businessId, projectIds: [project.id], userId: cl.user_id, clientId: cl.id, actorUserId: userId,
        });
      } catch (e) { console.warn('[createProject] join customer channel', e.message); }
    }
    require('../auditService').logAudit(actor.req || null, {
      userId,
      action: 'project.create',
      targetType: 'project',
      targetId: project.id,
      businessId,
      newValue: {
        name: project.name, kind: project.kind, project_type: project.project_type,
        member_count: members.length, client_count: contacts.length + existingClients.length,
        client_ids: existingClients.map((c) => c.id),
        via: actor.channel?.kind === 'agent' ? `agent:${actor.channel.provider}` : (actor.kind === 'cue' ? 'cue' : 'user'),
      },
    });
    const io = getIO();
    if (io) io.to(`business:${businessId}`).emit('project:new', { id: project.id, actor_user_id: userId });
  };
  if (external) opts.transaction.afterCommit(() => { after().catch((e) => console.warn('[createProject after]', e.message)); });
  else await after();

  return done({
    project,
    memberCount: pmRows.length,
    clients: existingClients.map((c) => ({ id: c.id, user_id: c.user_id || null, name: c.display_name || c.company_name || null })),
  });
}

module.exports = { createProject, resolveExistingClients };
