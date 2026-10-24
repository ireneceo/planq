// routes/invoice_ai.js — 청구서 발행 창 [AI 작성] (docs/INVOICE_AI_DRAFT_DESIGN.md §7, Fable 2026-10-24)
//   invoices.js 가 god-file 이라 따로 둔다. server.js 에서 `/api/invoices` 의 **기존 라우터보다 앞**에 마운트한다.
//   ★ `router.use()` 전역 미들웨어를 두지 않는다 — 앞에 붙은 라우터의 전역 인증은 뒤 라우터의
//     무인증 공개 결제 주소(`/public/:token`)까지 401 로 막는다. 미들웨어는 라우트마다 붙인다.
const express = require('express');
const router = express.Router();
const { authenticateToken, checkBusinessAccess } = require('../middleware/auth');
const { requireMenu } = require('../middleware/menu_permission');
const { perUserDaily } = require('../middleware/costGuard');
const { errorResponse } = require('../middleware/errorHandler');
const { buildInvoiceDraft } = require('../services/invoiceExtract');

const blockClient = (req, res, next) => (req.businessRole === 'client' ? errorResponse(res, 'forbidden', 403) : next());

// POST /api/invoices/:businessId/ai-draft
//   body: { text?, client_hint?, client_id?, post_ids?: number[≤3], file_ids?: number[≤3], currency? }
//   응답: 폼에 채울 값(저장 안 함) — 고객 맞춤·품목·세금 기준·청구 조건 문서 상태·skipped·warnings
// audit-exempt: 미리보기 — 폼 값만 돌려주고 저장하지 않는다(사용량은 cue_usage)
router.post('/:businessId/ai-draft', authenticateToken, checkBusinessAccess, requireMenu('qbill', 'write'), blockClient,
  ...perUserDaily('invoice-ai', { perMin: 3, perDay: 30, message: 'AI 작성을 너무 자주 호출했습니다. 잠시 후 다시 시도하세요.' }),
  async (req, res, next) => {
    try {
      const businessId = Number(req.params.businessId);
      const planEngine = require('../services/plan');
      const planCan = await planEngine.can(businessId, 'use_cue', { actions: 1 });
      if (!planCan.ok) return res.status(422).json(planEngine.buildQuotaError(planCan, businessId));
      const out = await buildInvoiceDraft({ businessId, user: req.user, body: req.body || {} });
      return res.status(out.status).json(out.body);
    } catch (err) { next(err); }
  });

module.exports = router;
