// 통합 초대 (invite) API — token 하나로 프로젝트·워크스페이스 고객·워크스페이스 멤버 초대 분기
//   GET  /api/invites/:token           — 공개 조회 (type + 정보)
//   POST /api/invites/:token/accept    — 인증 필요, 타입별 accept
//
// 기존 /api/projects/invite/:token 은 하위 호환 유지.
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
// 토큰 해석·수락은 services/invites 한 벌 — 회원가입·OAuth 가입도 같은 함수를 부른다(0-F F-1).
const { resolveInviteToken, acceptInvite, InviteError } = require('../services/invites');

// GET /api/invites/:token — 공개
router.get('/:token', async (req, res, next) => {
  try {
    const resolved = await resolveInviteToken(req.params.token);
    if (!resolved) return errorResponse(res, 'invalid_or_expired_invite', 404);
    if (resolved.expired) return errorResponse(res, 'invalid_or_expired_invite', 410);
    return successResponse(res, {
      type: resolved.type,
      already_linked: resolved.alreadyLinked,
      ...resolved.info,
    });
  } catch (err) { next(err); }
});

// POST /api/invites/:token/accept — 인증. 본문은 acceptInvite 하나, 여기는 에러→HTTP 매핑만.
//   ★ 토큰=인증: 초대 링크의 토큰을 소유 = 그 메일함을 받음 = 본인. 이메일 주소 대조는 하지 않는다
//     (토큰은 추측불가·단일사용·30일 만료라 그 자체가 충분한 자격증명).
router.post('/:token/accept', authenticateToken, async (req, res, next) => { // audit-exempt: 감사는 services/invites.acceptInvite 가 쓴다(invite.accept)
  try {
    const resolved = await resolveInviteToken(req.params.token);
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
