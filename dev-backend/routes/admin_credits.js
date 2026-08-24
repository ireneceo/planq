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
    // ★ 단가 자동 보정 — 잔액을 새로 입력하는 이 순간이 유일하게 "실제 청구액"을 아는 시점이다.
    //   (이전 잔액 − 지금 잔액) ÷ 그 사이 사용한 분 = 제공사가 실제로 청구한 분당 단가.
    //   덮어쓰기 **전에** 이전 값으로 계산해야 한다.
    const calib = await providerCredit.calibrateRate(provider, row, balance);
    if (calib.applied) {
      // ★ 순서가 중요하다. 단가를 **먼저 저장하고 캐시를 비운 뒤에** 기준선 누적을 계산해야 한다.
      //   옛 단가로 기준선을 잡고 새 단가로 현재 누적을 재면 두 식이 갈려 **즉시 유령 소비**가 생긴다
      //   (자체 반증: 200분 원장에서 단가가 0.0077→0.009 로 바뀌자 $0.26 이 허공에서 생겼다).
      row.unit_price_usd = calib.rate;
      await row.save();
      providerCredit.invalidateRateCache();
    }

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

    // 보정 결과를 같이 돌려준다 — 화면이 "실단가를 배웠다"를 사용자에게 말할 수 있게.
    const st = await providerCredit.status(provider);
    return successResponse(res, { ...st, calibration: calib });
  } catch (err) { next(err); }
});

module.exports = router;
