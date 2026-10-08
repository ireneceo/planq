// services/invites.js — 초대 토큰 해석 + 수락 **한 벌** (0-F F-1, docs/FIX_0CDEF_ACCESS_DESIGN.md)
//
// 왜: 수락이 `routes/invites.js` 라우트 안에만 있어서 회원가입·OAuth 가입은 초대를 모르고 워크스페이스를 새로 만들었고,
//   어느 타입도 `users.active_business_id` 를 바꾸지 않아 **기존 계정이 멤버 초대를 수락해도 옛 워크스페이스에 착지**했다.
//   이제 수락의 정본은 acceptInvite 하나다. 라우트(POST /api/invites/:token/accept)·회원가입·OAuth 가입이 같은 함수를 부른다.
//   (회원가입·OAuth 는 커밋 뒤 best-effort 로 부르고 어쨌든 /invite/:token 으로 보낸다 — 쿼터 422 같은 실패가
//    InvitePage 의 문장으로 보이게. 가입 트랜잭션 안에 넣으면 쿼터 때문에 **가입 자체가** 실패한다.)
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { ProjectClient, Project, Business, Client, User, BusinessMember, Conversation } = require('../models');
const { isExpired } = require('./inviteExpiry');

class InviteError extends Error {
  constructor(code, status, body = null) { super(code); this.code = code; this.status = status; this.body = body; }
}

// 삭제된 워크스페이스의 초대는 무효다 — 토큰 해석이 조회·수락의 공통 착지점이라 여기서 한 번에 막는다.
async function isBizAlive(businessId) {
  if (!businessId) return true;
  const row = await Business.findOne({ where: { id: businessId, deleted_at: null }, attributes: ['id'] });
  return !!row;
}

/** routes/invites.js 에서 옮겼다(동작 무변경) + business_id 를 같이 돌려준다. */
async function resolveInviteToken(token) {
  if (!token) return null;
  // 1) 프로젝트 고객 초대
  const pc = await ProjectClient.findOne({ where: { invite_token: token } });
  if (pc) {
    const project = await Project.findByPk(pc.project_id, {
      include: [{ model: Business, attributes: ['id', 'brand_name', 'name', 'deleted_at'] }],
    });
    if (project?.Business?.deleted_at) return null;
    return {
      type: 'project_client',
      record: pc,
      business_id: project?.business_id || null,
      expired: isExpired(pc.invited_at) && !pc.contact_user_id,
      alreadyLinked: !!pc.contact_user_id,
      linkedUserId: pc.contact_user_id || null,
      info: project ? {
        project_name: project.name,
        client_company: project.client_company,
        workspace_name: project.Business?.brand_name || project.Business?.name,
        contact_name: pc.contact_name,
        contact_email: pc.contact_email,
      } : null,
    };
  }
  // 2) 워크스페이스 고객 초대
  const client = await Client.findOne({ where: { invite_token: token } });
  if (client) {
    if (!(await isBizAlive(client.business_id))) return null;
    const biz = await Business.findByPk(client.business_id, { attributes: ['id', 'brand_name', 'name'] });
    return {
      type: 'workspace_client',
      record: client,
      business_id: client.business_id,
      expired: isExpired(client.invited_at) && !client.accepted_at,
      alreadyLinked: !!client.accepted_at && !!client.user_id,
      linkedUserId: client.user_id || null,
      info: biz ? {
        workspace_name: biz.brand_name || biz.name,
        contact_name: client.display_name,
        contact_email: client.invite_email,
        company_name: client.company_name,
      } : null,
    };
  }
  // 3) 워크스페이스 멤버 초대
  const bm = await BusinessMember.findOne({ where: { invite_token: token } });
  if (bm) {
    if (!(await isBizAlive(bm.business_id))) return null;
    const biz = await Business.findByPk(bm.business_id, { attributes: ['id', 'brand_name', 'name'] });
    return {
      type: 'workspace_member',
      record: bm,
      business_id: bm.business_id,
      expired: isExpired(bm.invited_at) && !bm.joined_at,
      alreadyLinked: !!bm.joined_at,
      linkedUserId: bm.user_id || null,
      info: biz ? {
        workspace_name: biz.brand_name || biz.name,
        contact_email: bm.invite_email,
        role: bm.role,
      } : null,
    };
  }
  return null;
}

const REDIRECT = { project_client: '/talk', workspace_client: '/talk', workspace_member: '/dashboard' };

function broadcast(io, bizId, event, data) {
  try { if (io && bizId) io.to(`business:${bizId}`).emit(event, data); } catch { /* best-effort */ }
}

/** 감사 — req 가 있으면 그것(ip 포함), 없으면(회원가입·OAuth 내부 호출) 사용자 id 만 실은 최소 모양. */
function audit(opts, user, entry) {
  const req = opts.actorReq || { user: { id: user.id }, ip: null, headers: {}, body: {} };
  try { require('./auditService').logAudit(req, entry); } catch (e) { console.warn('[invite audit]', e.message); }
}

/** 수락한 워크스페이스로 착지 — 세 타입 공통(0-F F-1). 정본은 users 표의 active_business_id 칸 하나다. */
async function landOn(user, businessId) {
  if (!businessId) return;
  try { await User.update({ active_business_id: businessId }, { where: { id: user.id } }); }
  catch (e) { console.warn('[invite land]', e.message); }
}

/**
 * 세 타입 공통 수락.
 * @param {User|{id:number}} user  로그인(또는 방금 만든) 사용자
 * @param {ReturnType<resolveInviteToken>} resolved
 * @param {{ io?, actorReq? }} opts
 * @returns {{ type, business_id, redirect, already: boolean, project_id? }}
 * @throws InviteError(code: 'invalid_or_expired_invite'|'already_accepted'|'quota', status)
 */
async function acceptInvite(user, resolved, opts = {}) {
  const io = opts.io || null;
  if (!resolved) throw new InviteError('invalid_or_expired_invite', 404);
  if (resolved.expired) throw new InviteError('invalid_or_expired_invite', 410);
  if (resolved.alreadyLinked) {
    // 같은 사람이 다시 부르면(가입 직후 InvitePage 자동 수락) 멱등으로 받는다. 남이면 거절.
    if (Number(resolved.linkedUserId) === Number(user.id)) {
      await landOn(user, resolved.business_id);
      return { type: resolved.type, business_id: resolved.business_id, redirect: REDIRECT[resolved.type], already: true };
    }
    throw new InviteError('already_accepted', 400);
  }

  const t = await sequelize.transaction();
  try {
    if (resolved.type === 'project_client') {
      const pc = resolved.record;
      await pc.update({ contact_user_id: user.id, accepted_at: new Date() }, { transaction: t });
      // 프로젝트 고객은 그 프로젝트의 고객 채널에 참여 — Client 활성화(user_id 연결). 참여할 방이 없으면 환영 대화방(커밋 후).
      let needWelcomeClientId = null;
      let bizId = resolved.business_id;
      try {
        const prj = await Project.findByPk(pc.project_id, { attributes: ['id', 'business_id'], transaction: t });
        if (prj) {
          bizId = prj.business_id;
          let clientId = pc.client_id;
          if (clientId) {
            await Client.update(
              { user_id: user.id, status: 'active' },
              { where: { id: clientId, business_id: prj.business_id }, transaction: t },
            ).catch(() => {});
          } else {
            const [cl] = await Client.findOrCreate({
              where: { business_id: prj.business_id, user_id: user.id },
              defaults: {
                business_id: prj.business_id, user_id: user.id,
                display_name: pc.contact_name || null, invite_email: pc.contact_email || null,
                invited_by: pc.invited_by || null, status: 'active', accepted_at: new Date(),
              },
              transaction: t,
            });
            clientId = cl.id;
            if (cl.status !== 'active' || !cl.user_id) {
              await cl.update({ user_id: user.id, status: 'active' }, { transaction: t }).catch(() => {});
            }
            await pc.update({ client_id: clientId }, { transaction: t });
          }
          // 이 고객의 방에만 들인다(프로젝트 × 고객, 2026-10-07 Fable B 판정 7).
          const custConvs = await Conversation.findAll({
            where: { project_id: pc.project_id, business_id: prj.business_id, channel_type: 'customer' },
            attributes: ['id'], transaction: t,
          });
          if (custConvs.length) {
            await require('./clientOnboarding').joinProjectCustomerChannels({
              businessId: prj.business_id, projectIds: [pc.project_id], userId: user.id, clientId, transaction: t,
            });
          } else {
            needWelcomeClientId = clientId;
          }
        }
      } catch (e) { console.warn('[invite accept auto-join]', e.message); }
      await t.commit();
      if (needWelcomeClientId) {
        try {
          const cl = await Client.findByPk(needWelcomeClientId);
          if (cl && cl.user_id) await require('./clientOnboarding').ensureWelcomeConversation(cl, { io });
        } catch (e) { console.warn('[invite project welcome]', e.message); }
      }
      await landOn(user, bizId);
      broadcast(io, bizId, 'project_client:updated', { project_id: pc.project_id, id: pc.id });
      notifyInviterOnAccept(pc.invited_by, pc.project_id, 'project_client', user.id, null).catch((e) => console.warn('[notify invite project_client]', e.message));
      audit(opts, user, { action: 'project_invite.accept', targetType: 'project_client', targetId: pc.id, businessId: bizId ?? null, newValue: { type: 'project_client' } });
      return { type: 'project_client', business_id: bizId, project_id: pc.project_id, redirect: REDIRECT.project_client, already: false };
    }

    if (resolved.type === 'workspace_client') {
      const cl = resolved.record;
      // 같은 business_id + user_id 가 이미 있으면(동시성·중복 초대) 새 행을 흡수한다
      const dup = await Client.findOne({
        where: { business_id: cl.business_id, user_id: user.id, id: { [Op.ne]: cl.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (dup) {
        await cl.destroy({ transaction: t });
        await t.commit();
        await landOn(user, dup.business_id);
        broadcast(io, dup.business_id, 'client:updated', { id: dup.id, business_id: dup.business_id });
        return { type: 'workspace_client', business_id: dup.business_id, redirect: REDIRECT.workspace_client, already: false };
      }
      await cl.update({ user_id: user.id, accepted_at: new Date(), status: 'active' }, { transaction: t });
      // 이미 연결돼 있던 프로젝트에 이 계정을 들인다(안 하면 고객 화면에서 프로젝트·채팅방이 통째로 안 보인다)
      await require('./clientOnboarding').linkClientToProjects(cl, { transaction: t });
      await t.commit();
      await landOn(user, cl.business_id);
      broadcast(io, cl.business_id, 'client:updated', { id: cl.id, business_id: cl.business_id });
      notifyInviterOnAccept(cl.invited_by, null, 'workspace_client', user.id, cl.business_id).catch((e) => console.warn('[notify invite workspace_client]', e.message));
      try { await require('./clientOnboarding').ensureWelcomeConversation(cl, { io }); }
      catch (e) { console.warn('[onboarding welcome]', e.message); }
      audit(opts, user, { action: 'invite.accept', targetType: 'workspace_client', targetId: cl.id, businessId: cl.business_id, newValue: { type: 'workspace_client' } });
      return { type: 'workspace_client', business_id: cl.business_id, redirect: REDIRECT.workspace_client, already: false };
    }

    if (resolved.type === 'workspace_member') {
      const bm = resolved.record;
      const dup = await BusinessMember.findOne({
        where: { business_id: bm.business_id, user_id: user.id, id: { [Op.ne]: bm.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (dup) {
        await bm.destroy({ transaction: t });
        await t.commit();
        await landOn(user, dup.business_id);
        broadcast(io, dup.business_id, 'member:updated', { id: dup.id });
        return { type: 'workspace_member', business_id: dup.business_id, redirect: REDIRECT.workspace_member, already: false };
      }
      // 플랜 쿼터 재확인 — 지금 수락하는 이 행(bm)은 이미 만들어진 자리라 세지 않는다(excludeMemberId)
      const planEngine = require('./plan');
      const planCan = await planEngine.can(bm.business_id, 'add_member', { excludeMemberId: bm.id });
      if (!planCan.ok) {
        await t.rollback();
        throw new InviteError('quota', 422, planEngine.buildQuotaError(planCan, bm.business_id));
      }
      await bm.update({ user_id: user.id, joined_at: new Date() }, { transaction: t });
      await t.commit();
      await landOn(user, bm.business_id);
      broadcast(io, bm.business_id, 'member:updated', { id: bm.id });
      notifyInviterOnAccept(bm.invited_by, null, 'workspace_member', user.id, bm.business_id).catch((e) => console.warn('[notify invite workspace_member]', e.message));
      audit(opts, user, { action: 'invite.accept', targetType: 'workspace_member', targetId: bm.id, businessId: bm.business_id, newValue: { type: 'workspace_member' } });
      return { type: 'workspace_member', business_id: bm.business_id, redirect: REDIRECT.workspace_member, already: false };
    }

    await t.rollback();
    throw new InviteError('unsupported_invite_type', 400);
  } catch (err) {
    if (!t.finished) await t.rollback().catch(() => {});
    throw err;
  }
}

// 초대한 사람에게 알림 (routes/invites.js 에서 옮겼다 — 동작 무변경)
async function notifyInviterOnAccept(inviterUserId, projectId, kind, accepterUserId, businessIdHint) {
  if (!inviterUserId) return;
  if (inviterUserId === accepterUserId) return;
  const { notify } = require('../routes/notifications');
  const accepter = await User.findByPk(accepterUserId, { attributes: ['name', 'email'] });
  let businessId = businessIdHint;
  let projectName = null;
  if (projectId && !businessId) {
    const proj = await Project.findByPk(projectId, { attributes: ['business_id', 'name'] });
    businessId = proj?.business_id;
    projectName = proj?.name;
  }
  let wsName = null;
  if (businessId) {
    const biz = await Business.findByPk(businessId, { attributes: ['name', 'brand_name'] });
    wsName = biz?.brand_name || biz?.name || null;
  }
  const accepterLabel = accepter?.name || accepter?.email || '초대받은 사용자';
  const titleMap = {
    workspace_member: '초대한 멤버가 가입했습니다',
    workspace_client: '초대한 고객이 가입했습니다',
    project_client: '프로젝트 고객이 초대를 수락했습니다',
  };
  const link = projectId ? `/projects/p/${projectId}` : '/business/clients';
  await notify({
    userId: inviterUserId, businessId, eventKind: 'invite',
    title: titleMap[kind] || '초대 수락',
    body: `${accepterLabel}${projectName ? ` · ${projectName}` : ''}`,
    link, ctaLabel: '확인하기', workspaceName: wsName,
  });
}

module.exports = { resolveInviteToken, acceptInvite, InviteError, notifyInviterOnAccept };
