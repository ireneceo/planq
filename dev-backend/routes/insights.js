// 능동 인사이트 — Cue 가 사용자 패턴을 감지해서 카드로 알림 (사이클 D4).
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { BusinessMember } = require('../models');
const { buildInsights } = require('../services/insights');
// 카드 문구는 서버가 **보는 사람의 언어·타임존으로** 해석한다.
// buildInsights 는 코드+원시값만 만든다 (services/statsInsights.js 헤더 참조).
const { localizeCueCards } = require('../services/statsInsights');

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    // ★ 2026-09-11 — **범위는 필수다.** 여태 business_id 를 안 주면 "처음 가입한 워크스페이스" 로
    //   조용히 떨어졌고, 유일한 호출부(확인필요의 InsightCards)가 안 주고 있었다. 그래서 아무것도 없는
    //   새 워크스페이스에서 **다른 워크스페이스의 "지연 업무 9건"** 이 떴다(Irene 신고).
    //   워크스페이스가 하나일 때는 기본값과 현재값이 같아 안 보인다
    //   (memory feedback_scoped_call_optional_means_leaky). 기본값을 두지 않는다 — 빠뜨리면 400 으로 드러난다.
    const businessId = parseInt(req.query.business_id, 10);
    if (!Number.isInteger(businessId) || businessId <= 0) return errorResponse(res, 'business_id_required', 400);
    const bm = await BusinessMember.findOne({
      where: { user_id: req.user.id, business_id: businessId, removed_at: null },
      attributes: ['role'],
    });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    const insights = await buildInsights({
      userId: req.user.id, businessId,
      userRole: bm.role, userEmail: req.user.email,
    });
    return successResponse(res, localizeCueCards(insights, req.user.language, req.user.timezone));
  } catch (e) { next(e); }
});

module.exports = router;
