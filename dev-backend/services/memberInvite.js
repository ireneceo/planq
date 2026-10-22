// 멤버 초대 한 건 — 한 명 초대(종전 POST …/members/invite { email })와 여러 명 초대({ emails[] })가 같은 함수를 쓴다.
//   설계 docs/ORG_STAGE0_DESIGN.md 9절 7(Fable 2026-10-22).
//   ★ user_id 는 **수락할 때만** 채운다(services/invites.acceptInvite — 2026-10-15 Fable D1). 초대 행은 user_id NULL.
//   ★ 여러 명은 «보낼 수 있는 사람 수 ≤ 남은 자리» 일 때만 보낸다 — 확인창이 «N명에게 보냄» 을 말한 뒤 일부만 나가면 확인이 거짓이 된다.
const crypto = require('crypto');
const { Op } = require('sequelize');
const { Business, BusinessMember, User, Department, Team } = require('../models');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BULK = 20;

/** 한 줄 판정 — 'ok' | 'invalid' | 'already_member' | 'already_invited'. 쓰기 없음. */
async function checkOne(businessId, rawEmail) {
  const email = String(rawEmail || '').trim();
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) return { email, status: 'invalid' };
  const existingUser = await User.findOne({ where: { email }, attributes: ['id'] });
  if (existingUser) {
    const dup = await BusinessMember.findOne({ where: { business_id: businessId, user_id: existingUser.id }, attributes: ['id'] });
    if (dup) return { email, status: 'already_member' };
  }
  const dupByEmail = await BusinessMember.findOne({ where: { business_id: businessId, invite_email: email }, attributes: ['id'] });
  if (dupByEmail) return { email, status: 'already_invited' };
  return { email, status: 'ok', existingUserId: existingUser?.id || null };
}

/** 남은 자리 — 게이트(plan.can('add_member'))와 같은 집합으로 센다. 한도 없음 = Infinity. */
async function seatsRemaining(businessId) {
  const planEngine = require('./plan');
  const can = await planEngine.can(businessId, 'add_member');
  if (!can.ok) return { remaining: 0, quota: can };
  const limits = await planEngine.getEffectiveLimits(businessId);
  if (!Number.isFinite(limits.members_max)) return { remaining: Infinity, quota: null };
  const { activeMemberSeatWhere } = require('./inviteExpiry');
  const cur = await BusinessMember.count({ where: { business_id: businessId, removed_at: null, role: { [Op.ne]: 'ai' }, ...activeMemberSeatWhere() } });
  return { remaining: Math.max(0, limits.members_max - cur), quota: null };
}

/** 부서·팀 — 이 워크스페이스 것만. 팀을 고르면 부서는 팀의 부서(routes/org.js 와 같은 규칙). */
async function resolveOrg(businessId, { department_id, team_id }) {
  let deptId = department_id ? Number(department_id) : null;
  let teamId = team_id ? Number(team_id) : null;
  if (teamId) {
    const team = await Team.findOne({ where: { id: teamId, business_id: businessId }, attributes: ['id', 'department_id'] });
    if (!team) return { error: 'invalid_team' };
    deptId = team.department_id || deptId;
  }
  if (deptId) {
    const dept = await Department.findOne({ where: { id: deptId, business_id: businessId }, attributes: ['id'] });
    if (!dept) return { error: 'invalid_department' };
  }
  return { department_id: deptId, team_id: teamId };
}

/** 초대 행 만들기 + 메일 + 기존 계정 앱 알림 + 감사. checkOne 이 'ok' 인 줄에만 부른다. */
async function createInvite(req, businessId, { email, existingUserId, inviteRole, org }) {
  const token = crypto.randomBytes(24).toString('hex');
  const created = await BusinessMember.create({
    business_id: businessId,
    user_id: null,
    role: 'member',
    default_role: inviteRole,
    invited_by: req.user.id,
    invited_at: new Date(),
    invite_token: token,
    invite_email: email,
    department_id: org?.department_id || null,
    team_id: org?.team_id || null,
  });
  try {
    const { sendInviteEmail } = require('./emailService');
    const biz = await Business.findByPk(businessId, { attributes: ['brand_name', 'name'] });
    const inviter = await User.findByPk(req.user.id, { attributes: ['name'] });
    await sendInviteEmail({
      to: email,
      workspaceName: biz?.brand_name || biz?.name || 'PlanQ',
      inviterName: inviter?.name || '',
      kind: 'workspace_member',
      token,
    });
  } catch (e) { console.warn('member invite email failed:', e.message); }
  if (existingUserId) {
    await require('./inviteNotify').notifyExistingInvitee({
      userId: existingUserId, kind: 'workspace_member', businessId,
      entityType: 'business_member', entityId: created.id, token,
      actorUserId: req.user.id, io: req.app.get('io'),
    });
  }
  require('./auditService').logAudit(req, {
    action: 'business_member.invite',
    targetType: 'business_member',
    targetId: created.id,
    businessId,
    newValue: { email, default_role: created.default_role || null, department_id: created.department_id || null, team_id: created.team_id || null },
  });
  // 초대 토큰은 계정을 «그 멤버로» 붙이는 열쇠다 — 응답에 싣지 않는다
  const out = created.toJSON(); delete out.invite_token;
  return out;
}

/** 이메일 목록 정리 — 공백 제거 · 대소문자 무시 중복 제거 · 빈 값 버림. */
function normalizeEmails(list) {
  const seen = new Set(); const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const e = String(raw || '').trim();
    if (!e) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  return out;
}

module.exports = { checkOne, seatsRemaining, resolveOrg, createInvite, normalizeEmails, MAX_BULK };
