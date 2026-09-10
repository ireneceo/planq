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
    let businessId = parseInt(req.query.business_id, 10);
    if (!businessId) {
      const bm = await BusinessMember.findOne({
        where: { user_id: req.user.id, removed_at: null },
        order: [['id', 'ASC']], attributes: ['business_id', 'role'],
      });
      if (!bm) return successResponse(res, []);
      businessId = bm.business_id;
    }
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
