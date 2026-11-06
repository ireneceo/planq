// 나에게 온 초대 — «시작하기»(/welcome) (a) 칸 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §4, Fable 설계)
//   GET  /api/me/invites                    — 내 인증된 주소로 온 초대 세 종류(멤버·고객·프로젝트 고객)
//   POST /api/me/invites/:type/:id/accept   — 서버가 토큰을 찾아 services/invites.acceptInvite 한 함수로 수락
//
// ★ 이메일 인증 뒤에만 보인다 — 남의 이메일로 가입해 «어느 회사가 나를 초대했나» 를 보는 것을 막는다(개수도 안 보임).
// ★ 응답에 초대 토큰·이메일을 싣지 않는다(화이트리스트) — 토큰은 계정을 «그 사람으로» 붙이는 열쇠다.
// ★ 워크스페이스 범위가 없는 «나» 의 자료 — X-Workspace-Id 를 보지 않는다(/api/auth/* 와 같은 성격).
const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { User, Business, BusinessMember, Client, ProjectClient, Project } = require('../models');
const { isExpired, INVITE_EXPIRY_MS } = require('../services/inviteExpiry');
const { resolveInviteToken, acceptInvite, InviteError } = require('../services/invites');

const EXPIRED_SHOW_MS = 7 * 24 * 60 * 60 * 1000;   // 만료된 초대는 7일만 «만료» 로 보여 준다(«왜 안 보이지» 방지)
const TYPES = ['workspace_member', 'workspace_client', 'project_client'];
const MAX_ROWS = 100;   // 종류마다 상한 — 한 사람에게 온 초대가 이보다 많을 일은 없다(무한 응답 방지)

/** 내 인증된 주소 집합 — 주 이메일(인증) + 인증된 보조 이메일. oauth/finish 2분기와 같은 집합. 소문자. */
async function verifiedAddressesOf(userId) {
  const u = await User.findByPk(userId, { attributes: ['id', 'email', 'email_verified_at', 'secondary_email', 'secondary_email_verified_at'] });
  if (!u || !u.email_verified_at) return { user: u, addrs: [] };
  const addrs = [String(u.email || '').trim().toLowerCase()];
  if (u.secondary_email && u.secondary_email_verified_at) addrs.push(String(u.secondary_email).trim().toLowerCase());
  return { user: u, addrs: [...new Set(addrs.filter(Boolean))] };
}

const lowerIn = (col, addrs) => require('sequelize').where(require('sequelize').fn('LOWER', require('sequelize').col(col)), { [Op.in]: addrs });

async function inviterNames(rows) {
  // 초대한 사람 — 그 워크스페이스 표시명 우선(services/displayName 규칙). 계정 이메일은 싣지 않는다.
  const ids = [...new Set(rows.map((r) => r.invited_by).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await User.findAll({ where: { id: ids }, attributes: ['id', 'name'] });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function displayInviter(name, inviterId, businessId) {
  if (!inviterId || !businessId) return name || null;
  const item = { inviter: { id: inviterId, name } };
  try { await require('../services/displayName').applyMemberDisplayNameOne(item, businessId, ['inviter']); } catch { /* 이름만 */ }
  return item.inviter?.name || name || null;
}

function expiryOf(invitedAt, nowMs) {
  const at = invitedAt ? new Date(invitedAt).getTime() : nowMs;
  return { expires_at: new Date(at + INVITE_EXPIRY_MS).toISOString(), expired: isExpired(invitedAt, nowMs), age: nowMs - at };
}

/** 내 초대 행 모으기 — 목록·수락이 같은 술어를 쓴다. */
async function collectInvites(addrs, userId) {
  if (!addrs.length) return [];
  const nowMs = Date.now();
  const out = [];
  const keep = (e) => !e.expired || (e.age - INVITE_EXPIRY_MS) <= EXPIRED_SHOW_MS;

  const members = await BusinessMember.findAll({
    where: { user_id: null, joined_at: null, removed_at: null, invite_token: { [Op.ne]: null }, [Op.and]: [lowerIn('BusinessMember.invite_email', addrs)] },
    include: [{ model: Business, required: true, where: { deleted_at: null }, attributes: ['id', 'brand_name', 'name', 'brand_logo_url'] }],
    attributes: ['id', 'business_id', 'invited_by', 'invited_at', 'invited_role', 'role'],
    order: [['invited_at', 'DESC']], limit: MAX_ROWS,
  });
  const clients = await Client.findAll({
    // 고객 초대는 받는 이메일에 계정이 있으면 초대 때 user_id 를 미리 채운다(status 'invited' — 수락 전엔 워크스페이스 목록에 없다)
    where: { accepted_at: null, status: { [Op.ne]: 'archived' }, invite_token: { [Op.ne]: null },
      [Op.and]: [lowerIn('Client.invite_email', addrs), { [Op.or]: [{ user_id: null }, { user_id: userId }] }] },
    include: [{ model: Business, required: true, where: { deleted_at: null }, attributes: ['id', 'brand_name', 'name', 'brand_logo_url'] }],
    attributes: ['id', 'business_id', 'invited_by', 'invited_at', 'company_name'],
    order: [['invited_at', 'DESC']], limit: MAX_ROWS,
  });
  // 프로젝트 고객 초대는 계정이 있으면 초대 때 contact_user_id 를 채워 곧바로 보인다 — 남은 대기는 계정 없던 것뿐
  const pcs = await ProjectClient.findAll({
    where: { contact_user_id: null, invite_token: { [Op.ne]: null }, [Op.and]: [lowerIn('ProjectClient.contact_email', addrs)] },
    attributes: ['id', 'project_id', 'invited_by', 'invited_at'],
    order: [['invited_at', 'DESC']], limit: MAX_ROWS,
  });
  const projects = pcs.length ? await Project.findAll({
    where: { id: [...new Set(pcs.map((p) => p.project_id))] },
    include: [{ model: Business, required: true, where: { deleted_at: null }, attributes: ['id', 'brand_name', 'name', 'brand_logo_url'] }],
    attributes: ['id', 'name', 'business_id'],
  }) : [];
  const projById = new Map(projects.map((p) => [p.id, p]));
  const names = await inviterNames([...members, ...clients, ...pcs]);

  for (const m of members) {
    const e = expiryOf(m.invited_at, nowMs); if (!keep(e)) continue;
    out.push({ type: 'workspace_member', id: m.id, business_id: m.business_id, biz: m.Business, invited_by: m.invited_by, invited_at: m.invited_at, ...e,
      role: m.invited_role === 'admin' ? 'admin' : 'member' });
  }
  for (const c of clients) {
    const e = expiryOf(c.invited_at, nowMs); if (!keep(e)) continue;
    out.push({ type: 'workspace_client', id: c.id, business_id: c.business_id, biz: c.Business, invited_by: c.invited_by, invited_at: c.invited_at, ...e,
      role: 'client', company_name: c.company_name || null });
  }
  for (const p of pcs) {
    const proj = projById.get(p.project_id); if (!proj) continue;   // 지운 워크스페이스·프로젝트
    const e = expiryOf(p.invited_at, nowMs); if (!keep(e)) continue;
    out.push({ type: 'project_client', id: p.id, business_id: proj.business_id, biz: proj.Business, invited_by: p.invited_by, invited_at: p.invited_at, ...e,
      role: 'client', project_name: proj.name });
  }
  for (const r of out) r.inviter_name = await displayInviter(names.get(r.invited_by), r.invited_by, r.business_id);
  out.sort((a, b) => new Date(b.invited_at || 0) - new Date(a.invited_at || 0));
  return out;
}

/** 화이트리스트 모양 — 토큰·이메일 없음. */
function shape(r) {
  const o = {
    type: r.type, id: r.id, business_id: r.business_id,
    workspace_name: r.biz?.brand_name || r.biz?.name || null,
    workspace_logo_url: r.biz?.brand_logo_url || null,
    inviter_name: r.inviter_name || null,
    invited_at: r.invited_at, expires_at: r.expires_at, expired: !!r.expired,
    role: r.role,
  };
  if (r.project_name) o.project_name = r.project_name;
  if (r.company_name) o.company_name = r.company_name;
  return o;
}

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { user, addrs } = await verifiedAddressesOf(req.user.id);
    if (!user || !user.email_verified_at) return successResponse(res, { email_verified: false, invites: [] });
    const rows = await collectInvites(addrs, req.user.id);
    return successResponse(res, { email_verified: true, invites: rows.map(shape) });
  } catch (err) { next(err); }
});

// 수락 — 행을 (type,id) 로 찾고 내 주소로 온 것이 아니면 404(존재 노출 없이). 본문은 acceptInvite 하나,
//   오류 매핑은 routes/invites.js POST /:token/accept 와 같은 모양.
router.post('/:type/:id/accept', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/invites.acceptInvite 가 쓴다(invite.accept)
  try {
    const type = String(req.params.type);
    const id = Number(req.params.id);
    if (!TYPES.includes(type) || !Number.isInteger(id) || id <= 0) return errorResponse(res, 'invite_not_found', 404);
    const { user, addrs } = await verifiedAddressesOf(req.user.id);
    if (!user || !user.email_verified_at) return errorResponse(res, 'email_not_verified', 403);
    let row = null; let email = null;
    if (type === 'workspace_member') { row = await BusinessMember.findByPk(id, { attributes: ['id', 'invite_token', 'invite_email', 'user_id'] }); email = row?.invite_email; }
    else if (type === 'workspace_client') { row = await Client.findByPk(id, { attributes: ['id', 'invite_token', 'invite_email', 'user_id'] }); email = row?.invite_email; }
    else { row = await ProjectClient.findByPk(id, { attributes: ['id', 'invite_token', 'contact_email', 'contact_user_id'] }); email = row?.contact_email; }
    if (!row || !row.invite_token || !addrs.includes(String(email || '').trim().toLowerCase())) return errorResponse(res, 'invite_not_found', 404);
    const resolved = await resolveInviteToken(row.invite_token);
    if (!resolved) return errorResponse(res, 'invite_not_found', 404);
    const r = await acceptInvite(req.user, resolved, { io: req.app.get('io'), actorReq: req });
    const data = { type: r.type, business_id: r.business_id, redirect: r.redirect };
    if (r.project_id) data.project_id = r.project_id;
    if (r.already) data.already = true;
    return successResponse(res, data);
  } catch (err) {
    if (err instanceof InviteError) {
      if (err.body) return res.status(err.status).json(err.body);
      return errorResponse(res, err.code, err.status);
    }
    next(err);
  }
});

module.exports = router;
module.exports.collectInvites = collectInvites;
