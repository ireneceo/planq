// PUT /api/businesses/:businessId/me/nav-prefs
// 사이드바 «메뉴 편집» — 이 워크스페이스에서 내가 고른 메뉴 순서·숨김(2026-10-16, Irene «권고대로»).
// body: { nav_prefs: {...} | null } — null = 기본으로 되돌리기. 멤버만(고객은 편집 없음).
// 숨김은 권한이 아니다 — 이 값으로 아무것도 막지 않는다(services/navPrefs). 읽기는 /api/auth/me 의 nav_prefs.
//
// ★ /api/businesses 에 businesses.js 보다 **앞에** 붙는다 — 이 파일에는 «/:businessId/me/nav-prefs» 한 경로만 둔다
//   (고유한 꼬리라 businesses.js 의 어떤 경로도 가리지 않는다).
const express = require('express');
const router = express.Router();
const { BusinessMember } = require('../models');
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { normalizeNavPrefs } = require('../services/navPrefs');

// audit-exempt: 개인 화면 설정(메뉴 순서·숨김) — 권한·데이터 변경 아님
router.put('/:businessId/me/nav-prefs', authenticateToken, checkBusinessAccess, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    if (req.businessRole === 'client') return errorResponse(res, 'forbidden', 403);
    let prefs;
    try { prefs = normalizeNavPrefs(req.body?.nav_prefs); } catch { return errorResponse(res, 'invalid_nav_prefs', 400); }
    const bm = await BusinessMember.findOne({ where: { user_id: req.user.id, business_id: businessId, removed_at: null } });
    if (!bm) return errorResponse(res, 'forbidden', 403);
    await bm.update({ nav_prefs: prefs });
    return successResponse(res, { nav_prefs: prefs });
  } catch (err) { next(err); }
});

module.exports = router;
