// 모바일 앱 다운로드 정보 — 공개(비인증). /app 다운로드 페이지가 환경별 링크 노출에 사용.
//   platform_settings 의 app_ios_url / app_android_url 을 그대로 반환(관리자가 채움).
//   출시 전이면 null → 프론트가 "출시 준비 중" 상태 표시.
const express = require('express');
const router = express.Router();
const { PlatformSetting } = require('../models');
const { successResponse } = require('../middleware/errorHandler');

// GET /api/app-download
router.get('/', async (req, res, next) => {
  try {
    const row = await PlatformSetting.findOne({
      order: [['id', 'ASC']],
      attributes: ['app_ios_url', 'app_android_url'],
    });
    const ios = (row && row.app_ios_url) || null;
    const android = (row && row.app_android_url) || null;
    return successResponse(res, {
      ios_url: ios,
      android_url: android,
      has_ios: !!ios,
      has_android: !!android,
    });
  } catch (err) { next(err); }
});

module.exports = router;
