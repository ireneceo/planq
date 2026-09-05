// 게스트 링크의 **Smart Routing** — 이 링크를 연 사람이 PlanQ 안에서 직접 볼 수 있나.
//
//   무인증 화면(`/g/<token>`)은 로그인한 사람에게도 그대로 열린다. 그래서 우리 팀원이나
//   이미 초대된 고객이 링크를 눌러도 **앱 밖에 갇힌다** — 댓글도, 파일 업로드도, 다른 탭도 없다.
//   이 라우트가 "당신은 앱 안에서 볼 수 있습니다" 를 알려 화면이 안내를 띄운다.
//
// ★ 이 파일만 **인증이 필요한 게스트 라우트**다. guest.js·guest_project.js 는 전부 무인증이라,
//   섞어 두면 "어느 라우트가 공개인가" 가 파일에서 안 보인다(guest_project.js 머리말과 같은 이유).
// ★ 다른 공유 자원 6곳(posts·calendar·invoices·tasks·files·kb)이 이미 같은 계약을 쓴다:
//   응답 `{ canAccess, appUrl }`. 여기서만 모양이 다르면 프론트가 갈라진다.
// ★ `appUrl` 은 **실존하는 SPA 라우트**여야 한다 — 없는 경로를 주면 대시보드로 튕기고
//   사용자에게는 "눌러도 아무 일 없음" 이 된다(memory feedback_notify_link_must_match_route).
//   프로젝트 상세는 `/projects/p/:id` (App.tsx).
const express = require('express');
const router = express.Router();
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');
const { getUserScope, canAccessProject } = require('../middleware/access_scope');
const { resolveGuestToken } = require('../services/guest_link');
const { guestLimiter } = require('./guest_common');

// GET /api/guest/:token/auth-check — 로그인 사용자 전용
router.get('/:token/auth-check',
  guestLimiter('guest-auth-check', { windowMs: 60 * 1000, max: 30 }),
  authenticateToken,
  async (req, res, next) => {
    try {
      // 토큰이 죽었으면 링크 자체가 없는 것으로 친다 — 로그인했다고 회수된 링크가 살아나지 않는다.
      const ctx = await resolveGuestToken(req.params.token, { touch: false });
      if (!ctx) return errorResponse(res, 'not_found', 404);
      const link = ctx.parent || ctx.link;

      // 프로젝트 링크만 앱 안에 대응하는 화면이 있다. 대화 링크는 별도(#259 1차 범위 밖).
      if (link.scope !== 'project' || !link.project_id) {
        return successResponse(res, { canAccess: false, appUrl: null });
      }

      const { Project } = require('../models');
      const project = await Project.findByPk(link.project_id, { attributes: ['id', 'business_id'] });
      // 테넌트 이중 검증 — 링크의 워크스페이스와 프로젝트가 어긋나면 없는 것으로 친다.
      if (!project || project.business_id !== link.business_id) return errorResponse(res, 'not_found', 404);

      // 판정은 앱 목록이 쓰는 그 함수다. 여기서 따로 세면 반드시 갈라진다.
      const scope = await getUserScope(req.user.id, project.business_id, req.user.platform_role);
      const canAccess = await canAccessProject(req.user.id, project, scope);

      return successResponse(res, {
        canAccess: !!canAccess,
        appUrl: canAccess ? `/projects/p/${project.id}` : null,
      });
    } catch (err) { next(err); }
  });

module.exports = router;
