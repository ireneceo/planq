// routes/guest_admin.js — 게스트 링크 **관리** (멤버용, 인증 필수) — 운영 #259
//
// 공개 표면(routes/guest.js)과 **파일을 나눈다.** 한 파일에 인증·무인증이 섞이면
//   다음 사람이 어느 라우트가 공개인지 못 본다. 여기는 전부 authenticateToken 이다.
const express = require('express');
const router = express.Router();
const { GuestLink, Client, Conversation, User, PlatformSetting, Business } = require('../models');
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

    // ── fail-closed 3종 (S0) ─────────────────────────────────────────────
    //   여태 이 라우트는 **화면이 숨기는 것에만 의존**했다. 서버는 아무것도 안 봤다.
    //   화면 조건과 서버 술어가 갈리면, 갈린 쪽이 곧 우회로다.

    // ① 내부 대화방에 링크를 내주면 **내부 대화가 통째로 밖으로 열린다.**
    //    게스트 필터는 `is_internal`(메모 플래그)만 보므로 internal 방의 일반 대화는 다 보인다.
    if (conv.channel_type !== 'customer') {
      return errorResponse(res, 'not_customer_channel', 403);
    }
    // ② 보관된 방 — 끝난 대화를 다시 여는 링크는 만들 수 없다.
    if (conv.status === 'archived') {
      return errorResponse(res, 'conversation_archived', 409);
    }
    // ③ 킬스위치가 꺼져 있으면 **발급도 막는다.** 여태 발급은 201 이 났고 그 링크는
    //    열리지 않았다 — 담당자가 죽은 주소를 고객에게 보내고 고객은 없는 페이지를 본다.
    //    `resolveGuestToken` 과 같은 술어를 쓴다 (fail-closed: 못 읽으면 닫는다).
    const platform = await PlatformSetting.findOne({ attributes: ['guest_links_enabled'] });
    const bizRow = await Business.findByPk(businessId, { attributes: ['guest_links_enabled'] });
    if (!platform || platform.guest_links_enabled !== true
        || !bizRow || bizRow.guest_links_enabled === false) {
      return errorResponse(res, 'guest_links_disabled', 403);
    }

    // 고객은 **선택**이다 (2026-09-02). 멤버가 링크를 만들 때 아무것도 입력하지 않는다 —
    //   Irene: "왜 고객정보를 넣어야 해? 고객이 그냥 가볍게 들어와서 확인 및 소통".
    //   대화방에 고객이 붙어 있으면 그것을 그대로 쓰고(타임라인 연속성), 없으면 NULL.
    //   요청 body 의 client_id 는 **신뢰하지 않는다** — 대화방의 것을 쓴다(테넌트 우회 차단).
    let client = null;
    if (conv.client_id) {
      client = await Client.findOne({ where: { id: conv.client_id, business_id: businessId } });
      // 대화방이 가리키는 고객이 다른 워크스페이스면 데이터가 어긋난 것이다 — 붙이지 않고 넘어간다.
    }

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
      newValue: { conversation_id: conversationId, client_id: client ? client.id : null, can_write: link.can_write },
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
