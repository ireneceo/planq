// 외부 API 선불 크레딧 관리 — platform_admin 전용. routes/admin.js 에서 분리(god-file 래칫).
//
// Irene 2026-08-24: "0이 되기 전에 결제하게 해줘야지."
//   제공사 잔액 조회 API 에 의존하지 않는다(권한·엔드포인트 불안정).
//   콘솔에서 본 잔액을 기준선으로 넣으면 우리 원장 소비를 빼서 예상 잔액·소진 예상일을 만든다.
//   충전할 때마다 새 잔액을 다시 넣는 것이 정상 운용 — 그래야 추정 오차가 리셋된다.
const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');

router.use(authenticateToken, requireRole('platform_admin'));


//
// Irene 2026-08-24: "0이 되기 전에 결제하게 해줘야지."
//   제공사 잔액 조회 API 에 의존하지 않는다(권한·엔드포인트 불안정).
//   콘솔에서 본 잔액을 기준선으로 넣으면 우리 원장 소비를 빼서 예상 잔액·소진 예상일을 만든다.
//   충전할 때마다 새 잔액을 다시 넣는 것이 정상 운용 — 그래야 추정 오차가 리셋된다.

// GET /api/admin/provider-credits — 제공사별 현황 (미설정 항목도 configured=false 로 내려준다)
router.get('/provider-credits', async (req, res, next) => {
  try {
    const providerCredit = require('../services/providerCredit');
    return successResponse(res, {
      providers: await providerCredit.statusAll(),
      deepgram_usd_per_min: providerCredit.DEEPGRAM_USD_PER_MIN,
    });
  } catch (err) { next(err); }
});

// PUT /api/admin/provider-credits/:provider — 잔액 기준선 갱신(충전 후 호출)
router.put('/provider-credits/:provider', async (req, res, next) => {
  try {
    const { ProviderCredit, AuditLog } = require('../models');
    const providerCredit = require('../services/providerCredit');
    const provider = String(req.params.provider || '');
    if (!Object.keys(providerCredit.PROVIDER_META).includes(provider)) {
      return errorResponse(res, 'invalid_provider', 400);
    }
    const b = req.body || {};
    const balance = Number(b.balance_start_usd);
    if (!Number.isFinite(balance) || balance < 0) return errorResponse(res, 'invalid_balance', 400);

    const [row] = await ProviderCredit.findOrCreate({
      where: { provider },
      defaults: { provider, balance_start_usd: 0, balance_start_at: new Date() },
    });
    row.balance_start_usd = balance;
    // 기준 시점은 서버가 정한다 — 클라가 과거 시각을 보내면 그만큼 소비가 이중 차감된다.
    row.balance_start_at = new Date();
    // ★ 이 순간의 원장 누적을 같이 박는다. 이후 소비 = (현재 누적) − (이 값).
    //   status() 와 **같은 함수**를 쓴다 — 두 곳이 다른 식으로 세면 잔액이 갈린다.
    row.baseline_spent_usd = (await providerCredit.cumulativeSpent(provider)).usd;
    if (b.topup_url !== undefined) row.topup_url = b.topup_url ? String(b.topup_url).slice(0, 300) : null;
    if (b.block_on_empty !== undefined) row.block_on_empty = !!b.block_on_empty;
    // 새 잔액을 넣었다는 것은 충전했다는 뜻 — 경보 상태를 비워 다음 하강에 다시 울리게 한다.
    row.last_alert_days = null;
    row.last_alert_at = null;
    row.updated_by_user_id = req.user ? req.user.id : null;
    await row.save();

    await AuditLog.create({
      user_id: req.user ? req.user.id : null,
      action: 'update',
      entity_type: 'provider_credit',
      entity_id: row.id,
      new_value: JSON.stringify({ provider, balance_start_usd: balance }),
    }).catch(() => null);

    return successResponse(res, await providerCredit.status(provider));
  } catch (err) { next(err); }
});

module.exports = router;
