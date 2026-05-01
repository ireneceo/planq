// 보고서 공유 (공개) — 인증 불필요. share_token 기반.
//
// /api/reports/share/:token  → PDF 직접 응답
//
// 토큰은 24바이트 hex (48자) — 추측 불가능. 발급 시점부터 영구 (만료 정책은 추후).
//
// 별도 라우트 파일로 분리한 이유:
//  - /api/stats/* 는 모두 authenticateToken 전제. 공유 링크는 인증 없이 접근해야 하므로 다른 마운트.

const express = require('express');
const fs = require('fs');
const router = express.Router();
const { Report } = require('../models');
const { errorResponse } = require('../middleware/errorHandler');

router.get('/share/:token', async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 32) return errorResponse(res, 400, 'invalid_token');

    const report = await Report.findOne({ where: { share_token: token } });
    if (!report) return errorResponse(res, 404, 'report_not_found');
    if (report.status !== 'ready' || !report.pdf_url) {
      return errorResponse(res, 409, `report_not_ready (${report.status})`);
    }
    if (!fs.existsSync(report.pdf_url)) {
      return errorResponse(res, 410, 'pdf_file_missing');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(report.title || `report-${report.id}`)}.pdf"`);
    return fs.createReadStream(report.pdf_url).pipe(res);
  } catch (err) { next(err); }
});

module.exports = router;
