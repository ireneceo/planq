// routes/project_guest_link_mail.js — 프로젝트 외부 열람 링크를 고객에게 **메일로** 보낸다 (2026-11-19).
//
// Irene: "고객에게 링크보내기 누르면 이메일로 보내줘야지."
//   대화방 링크의 같은 문은 routes/guest_admin.js 에 있다. 본체(받는 사람·킬스위치·발송·감사)는 services/guestLinkMail 한 벌.
//   projects.js 가 god-file 한도에 닿아 이 문만 따로 둔다 — 경로는 /api/projects/:id/guest-links/:linkId/email 그대로
//   (projects.js 에는 이 꼬리를 받는 경로가 없어 마운트 순서와 무관하다).
const express = require('express');
const router = express.Router();
const { GuestLink, Conversation } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const { loadProjectOrForbidden } = require('../services/projectAccess');
const { urlForSharedLink } = require('../services/guest_link');
const { sendGuestLinkMail } = require('../services/guestLinkMail');

// 외부 발송이라 사람당 분 5회·하루 50회(대화방 문과 같은 이름 — 둘을 합쳐 센다).
// platformroom-exempt: 링크가 가리키는 대화방 하나를 id 로만 찾는다(세지 않는다) — 발송은 assertGuestLinkIssuable 이 고객 방만 통과시킨다
router.post('/:id/guest-links/:linkId/email', authenticateToken, // audit-exempt: 감사는 sendGuestLinkMail 이 남긴다(guest_link.email)
  ...perUserDaily('guest-link-mail', { perMin: 5, perDay: 50 }), async (req, res, next) => {
    try {
      const { project, role, error } = await loadProjectOrForbidden(Number(req.params.id), req.user.id);
      if (error) return errorResponse(res, error.message, error.code);
      if (role === 'client') return errorResponse(res, 'forbidden', 403);
      const link = await GuestLink.findOne({
        where: { id: Number(req.params.linkId), project_id: project.id, business_id: project.business_id, kind: 'shared' },
      });
      if (!link || !link.conversation_id) return errorResponse(res, 'not_found', 404);
      const conv = await Conversation.findOne({ where: { id: link.conversation_id, business_id: project.business_id } });
      if (!conv) return errorResponse(res, 'not_found', 404);
      const r = await sendGuestLinkMail({
        link, url: urlForSharedLink(link), conv, businessId: project.business_id, userId: req.user.id,
        locale: req.body?.locale === 'en' ? 'en' : 'ko',
      });
      if (!r.ok) return errorResponse(res, r.code, r.status);
      return successResponse(res, { to: r.to, suppressed: r.suppressed }, r.suppressed ? 'suppressed' : 'sent');
    } catch (err) { next(err); }
  });

module.exports = router;
