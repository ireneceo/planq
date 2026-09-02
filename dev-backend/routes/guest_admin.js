// routes/guest_admin.js — 게스트 링크 **관리** (멤버용, 인증 필수) — 운영 #259
//
// 공개 표면(routes/guest.js)과 **파일을 나눈다.** 한 파일에 인증·무인증이 섞이면
//   다음 사람이 어느 라우트가 공개인지 못 본다. 여기는 전부 authenticateToken 이다.
const express = require('express');
const router = express.Router();
const { GuestLink, Client, Conversation, User } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { attachWorkspaceScope, assertMemberOrAbove } = require('../middleware/access_scope');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { createAuditLog } = require('../services/auditService');
const { issueGuestLink } = require('../services/guest_link');

const APP_URL = process.env.APP_URL || 'https://dev.planq.kr';

/** 관리 화면용 직렬화 — **원문 토큰은 없다**(해시만 저장하므로 복원 불가). */
const serialize = (l) => ({
  id: l.id,
  client_id: l.client_id,
  guest_name: l.guest_name,
  token_hint: l.token_hint,
  can_write: !!l.can_write,
  expires_at: l.expires_at,
  last_used_at: l.last_used_at,
  message_count: l.message_count,
  revoked_at: l.revoked_at,
  created_at: l.created_at,
});

// GET — 이 대화방의 링크 목록
router.get('/:businessId/:id/guest-links', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const rows = await GuestLink.findAll({
      where: { business_id: businessId, conversation_id: Number(req.params.id) },
      order: [['id', 'DESC']],
      limit: 50,
    });
    return successResponse(res, rows.map(serialize));
  } catch (err) { next(err); }
});

// POST — 발급. **원문 토큰은 이 응답에만 1회** 나간다.
router.post('/:businessId/:id/guest-links', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    // ★ 게스트 링크 발급은 **고객(client)이 할 수 없다.** 멤버 이상만.
    //   client 가 스스로 링크를 만들면 그 링크가 또 퍼진다.
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const conversationId = Number(req.params.id);
    const conv = await Conversation.findOne({ where: { id: conversationId, business_id: businessId } });
    if (!conv) return errorResponse(res, 'conversation_not_found', 404);

    const clientId = Number(req.body?.client_id || 0);
    if (!clientId) return errorResponse(res, 'client_id_required', 400);
    // 테넌트 이중 검증 — 다른 워크스페이스 고객에게 우리 대화방을 열어 줄 수 없다.
    const client = await Client.findOne({ where: { id: clientId, business_id: businessId } });
    if (!client) return errorResponse(res, 'client_not_found', 404);

    const { link, token } = await issueGuestLink({
      businessId,
      conversationId,
      projectId: conv.project_id || null,
      client,
      createdBy: req.user.id,
      canWrite: req.body?.can_write !== false,
      guestName: req.body?.guest_name || null,
    });

    createAuditLog({
      userId: req.user.id, businessId,
      action: 'guest_link.create', targetType: 'GuestLink', targetId: link.id,
      newValue: { conversation_id: conversationId, client_id: clientId, can_write: link.can_write },
    });

    return successResponse(res, {
      ...serialize(link),
      // ★ 원문은 지금뿐이다. 화면이 이걸 놓치면 사용자는 링크를 다시 만들어야 한다.
      url: `${APP_URL}/g/${token}`,
    }, 'issued', 201);
  } catch (err) { next(err); }
});

// DELETE — 회수 (단건). 즉시 404 가 된다.
router.delete('/:businessId/:id/guest-links/:linkId', authenticateToken, attachWorkspaceScope(), async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (!(await assertMemberOrAbove(req.user.id, businessId, req.user.platform_role))) {
      return errorResponse(res, 'forbidden', 403);
    }
    const link = await GuestLink.findOne({
      where: { id: Number(req.params.linkId), business_id: businessId, conversation_id: Number(req.params.id) },
    });
    if (!link) return errorResponse(res, 'not_found', 404);
    if (link.revoked_at) return successResponse(res, serialize(link), 'already_revoked');
    await link.update({ revoked_at: new Date(), revoked_by: req.user.id });
    createAuditLog({
      userId: req.user.id, businessId,
      action: 'guest_link.revoke', targetType: 'GuestLink', targetId: link.id,
      oldValue: { revoked_at: null }, newValue: { revoked_at: link.revoked_at },
    });
    return successResponse(res, serialize(link), 'revoked');
  } catch (err) { next(err); }
});

module.exports = router;
