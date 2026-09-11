// routes/sale_summary.js — Q sale 히스토리 요약 (docs/Q_SALE_DESIGN.md §10)
//   /api/sale 아래 같은 접두어. 이 파일이 Q sale 에서 **유일하게 LLM 을 부르는 곳**이다.
//   비용 3종 세트: rate-limit(perUserDaily) + plan 한도(checkUsageLimit, 생성기 안) + 입력 캡(capText, 생성기 안).
const express = require('express');
const router = express.Router();
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { perUserDaily } = require('../middleware/costGuard');
const { readChain, writeChain, broadcast, findClient } = require('../services/saleCommon');
const { generateSaleSummary, summaryStatus, setManualSummary } = require('../services/saleSummary');

// 사람이 누르는 갱신 — 분 3회 / 일 60회. 요약은 한 번에 LLM 1회지만 목록을 훑으며 연타할 수 있다.
const summaryLimit = perUserDaily('sale-summary', {
  perMin: 3, perDay: 60,
  message: '요약 갱신이 너무 잦습니다. 잠시 후 다시 시도하세요.',
});

// 조회 — **LLM 을 부르지 않는다.** 낡았는지(새 접점 N건)만 같이 준다.
router.get('/:businessId/clients/:clientId/summary', ...readChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const status = await summaryStatus(businessId, Number(req.params.clientId), { userId: req.user.id });
    if (!status) return errorResponse(res, 'Client not found', 404);
    return successResponse(res, status);
  } catch (err) { next(err); }
});

// 갱신 — 낡지 않았으면 LLM 0 (skipped:'up_to_date'). [AI 로 다시] 는 force=true 로 온다.
router.post('/:businessId/clients/:clientId/summary/refresh', ...writeChain, ...summaryLimit, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const clientId = Number(req.params.clientId);
    const client = await findClient(businessId, clientId);
    if (!client) return errorResponse(res, 'Client not found', 404);

    const force = req.body?.force === true;
    const out = await generateSaleSummary(businessId, clientId, { userId: req.user.id, force, origin: 'manual' });
    if (!out.ok) {
      // 실패도 **상태로** 돌려준다 — 화면이 "왜 안 됐는지" 를 말할 수 있어야 한다(조용한 무반응 금지)
      const status = out.status || await summaryStatus(businessId, clientId, { userId: req.user.id });
      if (out.skipped === 'usage_limit') return res.status(429).json({ success: false, message: 'cue_usage_limit_exceeded', data: status });
      if (out.skipped === 'ai_unavailable') return res.status(503).json({ success: false, message: 'ai_unavailable', data: status });
      return successResponse(res, { ...status, skipped: out.skipped });
    }
    broadcast(req, businessId, 'client:updated', { id: clientId, business_id: businessId });
    return successResponse(res, out.status);
  } catch (err) { next(err); }
});

// 직접 수정 — 사람이 고친 요약은 AI 가 덮지 않는다
router.patch('/:businessId/clients/:clientId/summary', ...writeChain, async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const clientId = Number(req.params.clientId);
    const text = String(req.body?.summary ?? '').trim();
    if (!text) return errorResponse(res, 'summary_required', 400);
    const status = await setManualSummary(businessId, clientId, { userId: req.user.id, text });
    if (!status) return errorResponse(res, 'Client not found', 404);
    broadcast(req, businessId, 'client:updated', { id: clientId, business_id: businessId });
    return successResponse(res, status);
  } catch (err) { next(err); }
});

module.exports = router;
