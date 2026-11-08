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
      attributes: ['app_ios_url', 'app_android_url', 'app_windows_url', 'app_mac_url'],
    });
    // ★ 2026-09-07 — https 만 내보낸다. 여태 이 라우트만 검증이 없어서, 관리자가 http/오타를
    //   넣으면 다운로드 페이지가 그 주소를 그대로 버튼에 걸었다(같은 값을 읽는
    //   `/api/platform/beta` 는 이미 걸러내고 있었다 — 한 값에 판정이 두 벌이면 반드시 갈린다).
    const clean = (u) => {
      const v = (u || '').trim();
      if (!v) return null;
      try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; }
    };
    const ios = clean(row && row.app_ios_url);
    const android = clean(row && row.app_android_url);
    // 데스크탑 앱(2026-11-07 docs/DESKTOP_APP_DESIGN.md §3-9) — 같은 규칙(https 만)
    const windows = clean(row && row.app_windows_url);
    const mac = clean(row && row.app_mac_url);
    return successResponse(res, {
      ios_url: ios,
      android_url: android,
      windows_url: windows,
      mac_url: mac,
      has_ios: !!ios,
      has_android: !!android,
      has_windows: !!windows,
      has_mac: !!mac,
    });
  } catch (err) { next(err); }
});

module.exports = router;
