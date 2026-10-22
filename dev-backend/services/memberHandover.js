// 퇴사 인수인계 — 나가는(또는 이미 나간) 멤버에게 남은 «열린 일» 을 세고, 지정한 인수자에게 넘긴다.
//   설계 docs/ORG_STAGE0_DESIGN.md (9절이 정본 — Fable 2026-10-22 판정 반영).
//
//   이 파일이 하는 것: 집계(summarize) · 순회(apply) · 인수자에게 한 통 알림 · business_member.handover 감사.
//   업무의 칸을 바꾸는 일은 task_actions.handoverNamedRoles 한 곳이다(이력·컨펌 재계산·실시간·감사가 거기 있다).
//
//   ★ «나만 보기»(L1) 업무는 약관 시행일(HANDOVER_L1_EFFECTIVE_AT) 전에는 **세기만 하고 넘기지 않는다** —
//     회사가 개인 범위 업무를 가져가는 규칙은 그 사람이 겪기 전에 약관에 있어야 한다(이용약관 제13조 30일 전 공지).
//   ★ 문서·파일·Q note·Q info 는 넘기지 않는다(작성자 사실 · 공개 범위가 이미 정한다).
const { Op } = require('sequelize');
const {
  Task, TaskReviewer, Project, ProjectMember, Client, BusinessMember, User,
} = require('../models');

// 이용약관 제10조 «워크스페이스에서 제외되면 … 업무 기록이 인수자에게» 의 시행일 — legal.json 문구와 같은 날.
//   배포가 늦어지면 이 값과 legal.json(ko/en terms.s10) 두 곳을 같이 옮긴다(공지 + 30일).
const HANDOVER_L1_EFFECTIVE_AT = new Date('2026-11-25T00:00:00+09:00');
const OPEN = { [Op.notIn]: ['completed', 'canceled'] };

// 그리고 그 조항을 담은 이용약관 버전이 이 서버에 올라가 있어야 한다(재동의 모달) — 날짜만 보면 공지·동의 없이 시행된다
//   (Fable 2026-10-22 완료 검증 비차단 1). 운영은 관리자 화면에서 버전을 올려야 켜진다.
const HANDOVER_TERMS_VERSION = '1.2';
function versionGte(a, b) {
  const pa = String(a || '0').split('.').map(Number); const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return true;
}
async function l1Effective(now = new Date()) {
  if (now < HANDOVER_L1_EFFECTIVE_AT) return false;
  try {
    const { PlatformSetting } = require('../models');
    const ps = PlatformSetting ? await PlatformSetting.findOne({ attributes: ['terms_version'] }) : null;
    return versionGte(ps?.terms_version, HANDOVER_TERMS_VERSION);
  } catch { return false; }
}

/** 넘길 업무 id 들(열린 것) — 담당·요청·대기 컨펌·담당 없는 «나만 보기» 작성. */
async function openTaskSets(businessId, userId) {
  const base = { business_id: businessId, status: OPEN };
  const [assigned, requested, unassignedPrivate, createdPrivateOther, reviewRows] = await Promise.all([
    Task.findAll({ where: { ...base, assignee_id: userId }, attributes: ['id', 'vlevel'], raw: true }),
    Task.findAll({ where: { ...base, request_by_user_id: userId }, attributes: ['id', 'vlevel'], raw: true }),
    Task.findAll({ where: { ...base, created_by: userId, assignee_id: null, vlevel: 'L1' }, attributes: ['id', 'vlevel'], raw: true }),
    Task.count({ where: { ...base, created_by: userId, vlevel: 'L1', assignee_id: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: userId }] } } }),
    TaskReviewer.findAll({
      where: { user_id: userId, state: 'pending' },
      include: [{ model: Task, attributes: ['id', 'vlevel'], where: base, required: true }],
      attributes: ['id'],
    }),
  ]);
  const reviewing = reviewRows.map((r) => ({ id: r.Task.id, vlevel: r.Task.vlevel }));
  return { assigned, requested, unassignedPrivate, createdPrivateOther, reviewing };
}

async function projectsOf(businessId, userId) {
  const [owned, defaults, pms] = await Promise.all([
    Project.findAll({ where: { business_id: businessId, owner_user_id: userId }, attributes: ['id'], raw: true }),
    Project.findAll({ where: { business_id: businessId, default_assignee_user_id: userId }, attributes: ['id'], raw: true }),
    ProjectMember.findAll({
      where: { user_id: userId, is_pm: true },
      include: [{ model: Project, attributes: ['id'], where: { business_id: businessId }, required: true }],
      attributes: ['project_id'],
    }),
  ]);
  const ids = new Set([...owned.map((p) => p.id), ...defaults.map((p) => p.id), ...pms.map((p) => p.project_id)]);
  return { owned, defaults, pmProjectIds: pms.map((p) => p.project_id), projectIds: [...ids] };
}

/** 남은 것 수 — 화면 패널과 «나간 멤버 — 남은 것 N건» 줄이 같은 함수를 읽는다. 제목은 싣지 않는다(L1 이 섞여 있다). */
async function summarize(businessId, userId) {
  const s = await openTaskSets(businessId, userId);
  const isL1 = (r) => r.vlevel === 'L1';
  const p = await projectsOf(businessId, userId);
  const clients = await Client.count({ where: { business_id: businessId, assigned_member_id: userId } });
  // 그 밖에 남는 것(0단계는 수만 — 넘기기는 다음 단계): 담당 메일 · 상담 예약 신청
  let mail = 0; let booking = 0;
  try {
    const { EmailThread, EmailThreadParticipant, CalendarEvent } = require('../models');
    // 담당 메일 = EmailThreadParticipant.is_assigned (routes/email_threads.js POST …/assign 과 같은 칸)
    const rows = await EmailThreadParticipant.findAll({ where: { user_id: userId, is_assigned: true }, attributes: ['thread_id'], raw: true });
    if (rows.length) {
      mail = await EmailThread.count({ where: { id: rows.map((r) => r.thread_id), business_id: businessId, status: { [Op.notIn]: ['archived', 'spam'] } } });
    }
    if (CalendarEvent?.rawAttributes?.booking_status) {
      booking = await CalendarEvent.count({ where: { business_id: businessId, created_by: userId, booking_status: { [Op.in]: ['requested', 'proposed', 'confirmed'] }, end_at: { [Op.gte]: new Date() } } });
    }
  } catch (e) { console.warn('[handover summarize extras]', e.message); }
  const counts = {
    assigned: s.assigned.length,
    assigned_private: s.assigned.filter(isL1).length,
    reviewing: s.reviewing.length,
    reviewing_private: s.reviewing.filter(isL1).length,
    requested: s.requested.length,
    requested_private: s.requested.filter(isL1).length,
    unassigned_private: s.unassignedPrivate.length,
    created_private_with_assignee: s.createdPrivateOther,
    projects: p.projectIds.length,
    clients,
    mail_assigned: mail,
    booking_open: booking,
  };
  const movable = counts.assigned + counts.reviewing + counts.requested + counts.unassigned_private + counts.projects + counts.clients;
  const privateTotal = counts.assigned_private + counts.reviewing_private + counts.requested_private + counts.unassigned_private;
  return {
    counts,
    total: movable,
    private_total: privateTotal,
    l1_effective: await l1Effective(),
    l1_effective_at: HANDOVER_L1_EFFECTIVE_AT.toISOString(),
  };
}

/** 인수자 자격 — 이 워크스페이스 활성 멤버(owner/admin/member), 대기 초대·AI·고객 아님, 나가는 사람 아님. */
async function assertRecipient(businessId, fromUserId, toUserId) {
  if (!Number.isInteger(toUserId) || toUserId === fromUserId) return false;
  const m = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: toUserId, removed_at: null, role: { [Op.in]: ['owner', 'admin', 'member'] } },
    attributes: ['id', 'joined_at'],
  });
  if (!m) return false;
  const u = await User.findByPk(toUserId, { attributes: ['id', 'is_ai', 'is_guest'] });
  return !!u && !u.is_ai && !u.is_guest;
}

/**
 * 넘기기 — 같은 요청을 두 번 보내도 두 번째는 0건(이미 바뀐 칸은 다시 안 맞는다).
 * @returns {{ moved: { tasks, assigned, reviewing, requested, projects, clients }, skipped_private }}
 */
async function apply({ businessId, fromUserId, toUserId, actor, io }) {
  const effective = await l1Effective();
  const s = await openTaskSets(businessId, fromUserId);
  const all = new Map();
  for (const r of [...s.assigned, ...s.requested, ...s.reviewing, ...s.unassignedPrivate]) all.set(r.id, r);
  const { handoverNamedRoles } = require('./actions/task_actions');
  const moved = { tasks: 0, assigned: 0, reviewing: 0, requested: 0, projects: 0, clients: 0 };
  let skippedPrivate = 0;
  for (const [id, meta] of all) {
    if (meta.vlevel === 'L1' && !effective) { skippedPrivate += 1; continue; }
    const task = await Task.findOne({ where: { id, business_id: businessId } });
    if (!task) continue;
    const r = await handoverNamedRoles(task, actor, { from: fromUserId, to: toUserId, assignUnassignedL1: effective });
    if (r.ok && r.data.changed) {
      moved.tasks += 1;
      if (r.data.roles.includes('assignee')) moved.assigned += 1;
      if (r.data.roles.includes('reviewer')) moved.reviewing += 1;
      if (r.data.roles.includes('requester')) moved.requested += 1;
    }
  }

  // 프로젝트 — 주인·기본 담당자·PM. 인수자가 프로젝트 멤버가 아니면 멤버로(PM 이었으면 PM 으로).
  const p = await projectsOf(businessId, fromUserId);
  const { emitProject } = require('./projectRoom');
  for (const pid of p.projectIds) {
    const project = await Project.findOne({ where: { id: pid, business_id: businessId } });
    if (!project) continue;
    const patch = {};
    if (project.owner_user_id === fromUserId) patch.owner_user_id = toUserId;
    if (project.default_assignee_user_id === fromUserId) patch.default_assignee_user_id = toUserId;
    if (Object.keys(patch).length) await project.update(patch);
    const wasPm = p.pmProjectIds.includes(pid) || patch.owner_user_id === toUserId;
    const [pm] = await ProjectMember.findOrCreate({
      where: { project_id: pid, user_id: toUserId },
      defaults: { project_id: pid, user_id: toUserId, is_pm: wasPm },
    });
    if (wasPm && !pm.is_pm) await pm.update({ is_pm: true });
    if (p.pmProjectIds.includes(pid)) await ProjectMember.update({ is_pm: false }, { where: { project_id: pid, user_id: fromUserId } });
    moved.projects += 1;
    require('./auditService').logAudit(actor.req || null, {
      userId: actor.userId, businessId, action: 'project.handover', targetType: 'project', targetId: pid,
      oldValue: { user_id: fromUserId }, newValue: { user_id: toUserId, fields: Object.keys(patch), pm: wasPm },
    });
    if (io) emitProject(io, pid, 'project:updated', { id: pid, business_id: businessId, project_id: pid });
  }

  // 고객 담당 — Q sale 담당 변경(routes/sale.js PUT)과 같은 감사·신호
  const clients = await Client.findAll({ where: { business_id: businessId, assigned_member_id: fromUserId } });
  for (const c of clients) {
    await c.update({ assigned_member_id: toUserId });
    require('../middleware/audit').createAuditLog({
      userId: actor.userId, businessId, action: 'client.updated', targetType: 'client', targetId: c.id,
      oldValue: { assigned_member_id: fromUserId }, newValue: { assigned_member_id: toUserId, via: 'handover' },
    });
    if (io) io.to(`business:${businessId}`).emit('client:updated', { id: c.id, business_id: businessId });
    moved.clients += 1;
  }

  const any = moved.tasks + moved.projects + moved.clients;
  if (any) {
    // 인수자에게 한 통(업무마다 보내면 20건이면 20통). 메일은 안 보낸다.
    try {
      const fromUser = await User.findByPk(fromUserId, { attributes: ['name'] });
      const { notify } = require('../routes/notifications');
      await notify({
        userId: toUserId, businessId, eventKind: 'task',
        title: (lang) => (lang === 'en'
          ? `You took over ${fromUser?.name || 'a member'}'s work`
          : `${fromUser?.name || '멤버'} 님의 일을 넘겨받았습니다`),
        body: (lang) => (lang === 'en'
          ? `Tasks ${moved.tasks} · projects ${moved.projects} · clients ${moved.clients}`
          : `업무 ${moved.tasks}건 · 프로젝트 ${moved.projects}건 · 고객 ${moved.clients}건`),
        link: `${process.env.APP_URL || 'https://dev.planq.kr'}/tasks`,
        ctaLabel: (lang) => (lang === 'en' ? 'Open tasks' : '업무 보기'),
        actorUserId: actor.userId, ioApp: io, skipChannels: ['email'],
      });
    } catch (e) { console.warn('[handover notify]', e.message); }
  }
  require('./auditService').logAudit(actor.req || null, {
    userId: actor.userId, businessId, action: 'business_member.handover', targetType: 'user', targetId: fromUserId,
    oldValue: { user_id: fromUserId }, newValue: { to_user_id: toUserId, moved, skipped_private: skippedPrivate },
  });
  return { moved, skipped_private: skippedPrivate };
}

/** 멤버를 내보내거나 그 사람 일을 넘길 수 있는가 — 오너·플랫폼 관리자. DELETE 멤버(본인 탈퇴는 그쪽이 따로 허용)와 인수인계가 같이 쓴다.
 *   admin 은 0단계에서 열지 않는다(Fable 2026-10-22 — 부서장 범위 1-3 과 함께 정한다). */
async function canManageMembership(req, businessId, transaction) {
  if (req.user?.platform_role === 'platform_admin') return true;
  const me = await BusinessMember.findOne({
    where: { business_id: businessId, user_id: req.user.id, removed_at: null }, attributes: ['role'], transaction,
  });
  return !!me && me.role === 'owner';
}

module.exports = { summarize, apply, assertRecipient, canManageMembership, l1Effective, HANDOVER_L1_EFFECTIVE_AT, HANDOVER_TERMS_VERSION };
