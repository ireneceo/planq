// 플랫폼 공개 정보 — 공개(비인증). 랜딩 푸터 사업자 정보 표시용.
//   전자상거래법 §10 표시의무: 상호·대표자·사업자등록번호·주소·연락처·이메일.
//   platform_settings 단일 row 에서 비민감 필드만 노출 (결제 시크릿·포트원 키 등은 제외).
const express = require('express');
const router = express.Router();
const { PlatformSetting } = require('../models');
const { successResponse } = require('../middleware/errorHandler');

// GET /api/platform/info
router.get('/info', async (req, res, next) => {
  try {
    const row = await PlatformSetting.findOne({
      order: [['id', 'ASC']],
      attributes: [
        'brand', 'legal_entity', 'website',
        'biz_registration_no', 'mail_order_no', 'representative_name',
        'company_phone', 'company_email', 'company_address', 'support_email',
      ],
    });
    // 전자상거래법 표시의무 항목만 노출 (계좌 등 비표시 필드는 제외 — 최소 노출)
    return successResponse(res, {
      brand: row?.brand || 'PlanQ',
      legal_entity: row?.legal_entity || null,
      website: row?.website || null,
      biz_registration_no: row?.biz_registration_no || null,
      mail_order_no: row?.mail_order_no || null,
      representative_name: row?.representative_name || null,
      company_phone: row?.company_phone || null,
      company_email: row?.company_email || row?.support_email || null,
      company_address: row?.company_address || null,
    });
  } catch (err) { next(err); }
});

// GET /api/platform/beta — 앱 베타 참여 링크 (공개, 비인증)
//   ★ 값은 **이미 있던** platform_settings.app_ios_url / app_android_url 을 그대로 읽는다
//     (관리자 화면 "앱 다운로드 — iOS (App Store / TestFlight URL)"). 베타용 컬럼을 따로 만들면
//     같은 값이 두 벌이 되어 반드시 갈라진다. 여태 이 값을 **읽는 곳이 0곳**이었다.
//   고객이 우리 사이트에서 바로 받는다. 링크가 없으면 그 플랫폼은 "준비 중" 이다 —
//   빈 문자열이나 '#' 같은 죽은 값을 내보내지 않는다(눌러도 아무 일 없는 버튼 금지).
router.get('/beta', async (req, res, next) => {
  try {
    const row = await PlatformSetting.findOne({
      order: [['id', 'ASC']],
      attributes: ['app_ios_url', 'app_android_url'],
    });
    const clean = (u) => {
      const v = (u || '').trim();
      if (!v) return null;
      // https 만 — 관리자 오타로 http/javascript: 가 들어가도 화면에 내보내지 않는다
      try { return new URL(v).protocol === 'https:' ? v : null; } catch { return null; }
    };
    return successResponse(res, {
      ios_url: clean(row?.app_ios_url),
      android_url: clean(row?.app_android_url),
    });
  } catch (err) { next(err); }
});

module.exports = router;
