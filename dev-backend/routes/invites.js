// 통합 초대 (invite) API — token 하나로 프로젝트·워크스페이스 고객·워크스페이스 멤버 초대 분기
//   GET  /api/invites/:token           — 공개 조회 (type + 정보)
//   POST /api/invites/:token/accept    — 인증 필요, 타입별 accept
//
// 기존 /api/projects/invite/:token 은 하위 호환 유지.
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { ProjectClient, Project, Business, Client, User, BusinessMember } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

const INVITE_EXPIRY_DAYS = 30;
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

    const me = await User.findByPk(req.user.id, { attributes: ['id', 'email'] });
    const myEmail = me?.email?.toLowerCase().trim();

    if (resolved.type === 'project_client') {
      const pc = resolved.record;
      if (pc.contact_email && pc.contact_email.toLowerCase().trim() !== myEmail) {
        await t.rollback();
        return errorResponse(res, 'email_mismatch', 403);
      }
      await pc.update({ contact_user_id: req.user.id, accepted_at: new Date() }, { transaction: t });
      await t.commit();
      return successResponse(res, { type: 'project_client', project_id: pc.project_id, redirect: '/talk' });
    }

    if (resolved.type === 'workspace_client') {
      const cl = resolved.record;
      if (cl.invite_email && cl.invite_email.toLowerCase().trim() !== myEmail) {
        await t.rollback();
        return errorResponse(res, 'email_mismatch', 403);
      }
      // 이미 같은 business_id + user_id 조합 있는지 확인 (동시성·중복 초대 방어)
      const dup = await Client.findOne({
        where: { business_id: cl.business_id, user_id: req.user.id, id: { [Op.ne]: cl.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (dup) {
        await cl.destroy({ transaction: t });
        await t.commit();
        return successResponse(res, { type: 'workspace_client', business_id: dup.business_id, redirect: '/talk' });
      }
      await cl.update({ user_id: req.user.id, accepted_at: new Date(), status: 'active' }, { transaction: t });
      await t.commit();
      return successResponse(res, { type: 'workspace_client', business_id: cl.business_id, redirect: '/talk' });
    }

    if (resolved.type === 'workspace_member') {
      const bm = resolved.record;
      if (bm.invite_email && bm.invite_email.toLowerCase().trim() !== myEmail) {
        await t.rollback();
        return errorResponse(res, 'email_mismatch', 403);
      }
      const dup = await BusinessMember.findOne({
        where: { business_id: bm.business_id, user_id: req.user.id, id: { [Op.ne]: bm.id } },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (dup) {
        await bm.destroy({ transaction: t });
        await t.commit();
        return successResponse(res, { type: 'workspace_member', business_id: dup.business_id, redirect: '/dashboard' });
      }
      await bm.update({ user_id: req.user.id, joined_at: new Date() }, { transaction: t });
      await t.commit();
      return successResponse(res, { type: 'workspace_member', business_id: bm.business_id, redirect: '/dashboard' });
    }

    await t.rollback();
    return errorResponse(res, 'unsupported_invite_type', 400);
  } catch (err) { await t.rollback().catch(() => {}); next(err); }
});

module.exports = router;
