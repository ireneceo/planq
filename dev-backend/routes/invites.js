// 통합 초대 (invite) API — token 하나로 프로젝트·워크스페이스 고객·워크스페이스 멤버 초대 분기
//   GET  /api/invites/:token           — 공개 조회 (type + 정보)
//   POST /api/invites/:token/accept    — 인증 필요, 타입별 accept
//
// 기존 /api/projects/invite/:token 은 하위 호환 유지.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { ProjectClient, Project, Business, Client, User, BusinessMember, Conversation, ConversationParticipant } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const INVITE_EXPIRY_DAYS = 30;

// 초대 수락 시 실시간 broadcast — 초대한 쪽 화면(참여 고객/고객/멤버 리스트) 즉시 갱신.
function broadcastAccept(req, bizId, event, data) {
  try { const io = req.app.get('io'); if (io && bizId) io.to(`business:${bizId}`).emit(event, data); }
  catch (e) { /* best-effort */ }
}

function isExpired(invitedAt) {
  if (!invitedAt) return false;
  return Date.now() - new Date(invitedAt).getTime() > INVITE_EXPIRY_DAYS * 86400000;
}

async function resolveToken(token) {
  // 1) 프로젝트 고객 초대
  const pc = await ProjectClient.findOne({ where: { invite_token: token } });
  if (pc) {
    const project = await Project.findByPk(pc.project_id, {
      include: [{ model: Business, attributes: ['id', 'brand_name', 'name'] }],
    });
    return {
      type: 'project_client',
      record: pc,
      expired: isExpired(pc.invited_at) && !pc.contact_user_id,
      alreadyLinked: !!pc.contact_user_id,
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
    const biz = await Business.findByPk(client.business_id, { attributes: ['id', 'brand_name', 'name'] });
    return {
      type: 'workspace_client',
      record: client,
      expired: isExpired(client.invited_at) && !client.accepted_at,
      alreadyLinked: !!client.accepted_at && !!client.user_id,
      info: biz ? {
        workspace_name: biz.brand_name || biz.name,
        contact_name: client.display_name,
        contact_email: client.invite_email,
        company_name: client.company_name,
      } : null,
    };
  }
  // 3) 워크스페이스 멤버 초대 (청크3에서 구현)
  const bm = await BusinessMember.findOne({ where: { invite_token: token } });
  if (bm) {
    const biz = await Business.findByPk(bm.business_id, { attributes: ['id', 'brand_name', 'name'] });
    return {
      type: 'workspace_member',
      record: bm,
      expired: isExpired(bm.invited_at) && !bm.joined_at,
      alreadyLinked: !!bm.joined_at,
      info: biz ? {
        workspace_name: biz.brand_name || biz.name,
        contact_email: bm.invite_email,
        role: bm.role,
      } : null,
    };
  }
  return null;
}

// GET /api/invites/:token — 공개
router.get('/:token', async (req, res, next) => {
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) return errorResponse(res, 'invalid_or_expired_invite', 404);
    if (resolved.expired) return errorResponse(res, 'invalid_or_expired_invite', 410);
    return successResponse(res, {
      type: resolved.type,
      already_linked: resolved.alreadyLinked,
      ...resolved.info,
    });
  } catch (err) { next(err); }
});

// POST /api/invites/:token/accept — 인증
// 트랜잭션: 여러 테이블 동시 변경(record.update/destroy + 중복 흡수)을 원자화.
router.post('/:token/accept', authenticateToken, async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const resolved = await resolveToken(req.params.token);
    if (!resolved) { await t.rollback(); return errorResponse(res, 'invalid_or_expired_invite', 404); }
    if (resolved.expired) { await t.rollback(); return errorResponse(res, 'invalid_or_expired_invite', 410); }
    if (resolved.alreadyLinked) { await t.rollback(); return errorResponse(res, 'already_accepted', 400); }

    // ★ 토큰=인증: 초대 링크의 토큰을 소유 = 그 메일함을 받음 = 본인. (다중 이메일 한 곳 수신 대응)
    //   이메일 주소 대조는 불필요한 이중장벽이라 제거 — 토큰 유효(resolveToken) + 로그인이면 수락.
    //   토큰은 추측불가·단일사용(accepted_at)·30일 만료라 그 자체가 충분한 자격증명.

    if (resolved.type === 'project_client') {
      const pc = resolved.record;
      await pc.update({ contact_user_id: req.user.id, accepted_at: new Date() }, { transaction: t });
      // 프로젝트 고객은 그 프로젝트의 고객 채널에 당연히 참여 — 수락 시 자동 join + Client 활성화(user_id 연결).
      try {
        const prj = await Project.findByPk(pc.project_id, { attributes: ['id', 'business_id'], transaction: t });
        if (prj) {
          // Client 레코드 user_id 연결 + 활성화 (청구·대화 client_id 정합). unique(biz,user) 충돌 시 무시.
          if (pc.client_id) {
            await Client.update(
              { user_id: req.user.id, status: 'active' },
              { where: { id: pc.client_id, business_id: prj.business_id }, transaction: t }
            ).catch(() => {});
          }
          // 프로젝트 고객 채널에 참여자 추가 (중복 방지)
          const custConvs = await Conversation.findAll({
            where: { project_id: pc.project_id, business_id: prj.business_id, channel_type: 'customer' },
            attributes: ['id'], transaction: t,
          });
          for (const cv of custConvs) {
            const exists = await ConversationParticipant.findOne({
              where: { conversation_id: cv.id, user_id: req.user.id }, transaction: t,
            });
            if (!exists) {
              await ConversationParticipant.create(
                { conversation_id: cv.id, user_id: req.user.id, role: 'member' }, { transaction: t });
            }
          }
        }
      } catch (e) { console.warn('[invite accept auto-join]', e.message); }
      await t.commit();
      try { const prj = await Project.findByPk(pc.project_id, { attributes: ['business_id'] }); broadcastAccept(req, prj?.business_id, 'project_client:updated', { project_id: pc.project_id, id: pc.id }); } catch { /* noop */ }
      notifyInviterOnAccept(pc.invited_by, pc.project_id, 'project_client', req.user.id, null).catch((e) => console.warn('[notify invite project_client]', e.message));
      return successResponse(res, { type: 'project_client', project_id: pc.project_id, redirect: '/talk' });
    }

    if (resolved.type === 'workspace_client') {
      const cl = resolved.record;
      // 이미 같은 business_id + user_id 조합 있는지 확인 (동시성·중복 초대 방어)
      const dup = await Client.findOne({
        where: { business_id: cl.business_id, user_id: req.user.id, id: { [Op.ne]: cl.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (dup) {
        await cl.destroy({ transaction: t });
        await t.commit();
        broadcastAccept(req, dup.business_id, 'client:updated', { id: dup.id });
        return successResponse(res, { type: 'workspace_client', business_id: dup.business_id, redirect: '/talk' });
      }
      await cl.update({ user_id: req.user.id, accepted_at: new Date(), status: 'active' }, { transaction: t });
      await t.commit();
      broadcastAccept(req, cl.business_id, 'client:updated', { id: cl.id });
      notifyInviterOnAccept(cl.invited_by, null, 'workspace_client', req.user.id, cl.business_id).catch((e) => console.warn('[notify invite workspace_client]', e.message));
      // N+83 — 첫 응대 준비: 담당자 명의 customer 대화방 + 환영 메시지 자동 생성 (best-effort, 멱등).
      //   실패해도 수락은 이미 커밋됨 → 고객 접속 자체는 정상.
      try {
        const { ensureWelcomeConversation } = require('../services/clientOnboarding');
        await ensureWelcomeConversation(cl, { io: req.app.get('io') });
      } catch (e) { console.warn('[onboarding welcome]', e.message); }
      return successResponse(res, { type: 'workspace_client', business_id: cl.business_id, redirect: '/talk' });
    }

    if (resolved.type === 'workspace_member') {
      const bm = resolved.record;
      const dup = await BusinessMember.findOne({
        where: { business_id: bm.business_id, user_id: req.user.id, id: { [Op.ne]: bm.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (dup) {
        await bm.destroy({ transaction: t });
        await t.commit();
        broadcastAccept(req, dup.business_id, 'member:updated', { id: dup.id });
        return successResponse(res, { type: 'workspace_member', business_id: dup.business_id, redirect: '/dashboard' });
      }
      // 플랜 쿼터 재확인 (race: 초대 발행 후 다른 멤버 추가로 한도 도달했을 수 있음)
      const planEngine = require('../services/plan');
      const planCan = await planEngine.can(bm.business_id, 'add_member');
      if (!planCan.ok) {
        await t.rollback();
        return res.status(422).json(planEngine.buildQuotaError(planCan, bm.business_id));
      }
      await bm.update({ user_id: req.user.id, joined_at: new Date() }, { transaction: t });
      await t.commit();
      broadcastAccept(req, bm.business_id, 'member:updated', { id: bm.id });
      notifyInviterOnAccept(bm.invited_by, null, 'workspace_member', req.user.id, bm.business_id).catch((e) => console.warn('[notify invite workspace_member]', e.message));
      return successResponse(res, { type: 'workspace_member', business_id: bm.business_id, redirect: '/dashboard' });
    }

    await t.rollback();
    return errorResponse(res, 'unsupported_invite_type', 400);
  } catch (err) { await t.rollback().catch(() => {}); next(err); }
});

// 초대한 사람에게 알림
async function notifyInviterOnAccept(inviterUserId, projectId, kind, accepterUserId, businessIdHint) {
  if (!inviterUserId) return;
  if (inviterUserId === accepterUserId) return; // 본인 → 본인 케이스 방어
  const { User, Project, Business } = require('../models');
  const { notify } = require('./notifications');
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
  // 상대경로 사용 — notify() normalizeLink + 클릭 시 resolveNotificationLink 정합 (N+74-D 박제).
  //   프로젝트 상세 실 라우트는 /projects/p/:id (옛 /q-project/:id 는 존재하지 않아 404 회귀였음).
  const link = projectId
    ? `/projects/p/${projectId}`
    : `/business/clients`;
  await notify({
    userId: inviterUserId, businessId, eventKind: 'invite',
    title: titleMap[kind] || '초대 수락',
    body: `${accepterLabel}${projectName ? ` · ${projectName}` : ''}`,
    link, ctaLabel: '확인하기', workspaceName: wsName,
  });
}

module.exports = router;
