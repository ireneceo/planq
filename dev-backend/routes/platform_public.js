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

module.exports = router;
