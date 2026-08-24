// 외부 API 선불 크레딧 — 잔액 추정·소진 예상일·경보. **단일 원천**.
//
// Irene 2026-08-24: "0이 되기 전에 결제하게 해줘야지."
//   목적은 차단이 아니라 **충전 시점 통지**다. 차단(block_on_empty)은 마지막 안전망일 뿐이다.
//
// 왜 % 가 아니라 남은 일수인가:
//   "잔액 20%" 는 행동을 만들지 않는다. 같은 20% 라도 하루 만에 마를 수도, 반년 갈 수도 있다.
//   최근 소비 속도로 나눠 **"이 속도면 N일"** 로 말해야 충전할지 말지 판단할 수 있다.
//
// 잔액 계산: (관리자가 콘솔에서 본 잔액) − (그 시점 이후 우리 원장 소비).
//   제공사 잔액 API 에 의존하지 않는다(권한·엔드포인트가 불안정). 대신 기준선을 다시 넣으면
//   누적 오차가 리셋되므로, 충전할 때마다 새 잔액을 넣는 것이 정상 운용이다.
const { Op, fn, col, literal } = require('sequelize');

// Deepgram 스트리밍 단가(USD/분) — **초기 추정값**. nova-3 스트리밍 기준.
//   ※ 우리는 스테레오를 2배로 과금 집계하므로(CLAUDE.md Q Note STT), 원장의 seconds 는 이미 billed 초다.
//
// ★ 이 값을 사람이 찾아 넣게 만들지 않는다 (Irene: "단가 확인하는 곳이 없는데?").
//   관리자가 콘솔 잔액을 **두 번째로** 입력하는 순간 실제 단가가 산수로 나온다:
//     실단가 = (이전 잔액 − 지금 잔액) ÷ (그 사이 사용한 분)
//   우리 원장에 그 구간의 billed 초가 정확히 있으므로 나눗셈만 하면 된다 → calibrateRate().
//   보정된 값은 provider_credits.unit_price_usd 에 저장되고 이후 계산은 그것을 쓴다.
const DEEPGRAM_USD_PER_MIN = Number(process.env.DEEPGRAM_USD_PER_MIN || 0.0077);

// 단가 캐시 — 초당 수십 번 호출되는 경로(STT 세그먼트 기록)에서 매번 DB 를 치지 않게.
let _rateCache = { at: 0, val: null };
const RATE_CACHE_MS = 60_000;

/** 현재 유효 Deepgram 단가(USD/분). 보정값이 있으면 그것, 없으면 env 기본값. */
async function getDeepgramRate() {
  if (_rateCache.val != null && Date.now() - _rateCache.at < RATE_CACHE_MS) return _rateCache.val;
  let val = DEEPGRAM_USD_PER_MIN;
  try {
    const { ProviderCredit } = models();
    const row = await ProviderCredit.findOne({ where: { provider: 'deepgram' }, attributes: ['unit_price_usd'] });
    if (row && row.unit_price_usd != null && Number(row.unit_price_usd) > 0) val = Number(row.unit_price_usd);
  } catch { /* DB 미가용이면 기본값 — 감시 장치가 서비스를 막으면 안 된다 */ }
  _rateCache = { at: Date.now(), val };
  return val;
}
const invalidateRateCache = () => { _rateCache = { at: 0, val: null }; };

// 경보 단계 — 남은 일수. 큰 것부터 검사해 "처음 걸리는" 단계를 쓴다.
const ALERT_DAYS = [30, 14, 7, 3, 1, 0];

// 소진 속도 산출에 쓰는 최근 창(일). 짧으면 튀고 길면 둔하다.
const RATE_WINDOW_DAYS = 14;

const PROVIDER_META = {
  deepgram: { label: 'Deepgram (Q Note 음성인식)', defaultTopup: 'https://console.deepgram.com/' },
  openai: { label: 'OpenAI (AI 기능 전반)', defaultTopup: 'https://platform.openai.com/settings/organization/billing' },
};

let _m = null;
const models = () => (_m || (_m = require('../models')));

const num = (v) => Number(v || 0);

/** Deepgram: 원장(qnote_usage_events)의 billed 초 → USD. since 없으면 전체 누적. */
async function deepgramSeconds(since, until) {
  const { QnoteUsageEvent } = models();
  const where = {};
  if (since) { where.created_at = { [Op.gte]: since }; if (until) where.created_at[Op.lt] = until; }
  return num(await QnoteUsageEvent.sum('seconds', { where }));
}

async function deepgramSpent(since, until) {
  const [secs, rate] = await Promise.all([deepgramSeconds(since, until), getDeepgramRate()]);
  return { usd: (secs / 60) * rate, seconds: secs };
}

/** OpenAI: cue_usage 전체 누적 (월 rollup 이라 시간으로 자를 수 없다 — 누적만 신뢰한다). */
async function openaiCumulative() {
  const { CueUsage } = models();
  const rows = await CueUsage.findAll({ attributes: [[fn('SUM', col('cost_usd')), 'usd']], raw: true });
  return { usd: num(rows[0] && rows[0].usd), seconds: null };
}

/**
 * 제공사 원장의 **전체 누적** 소비액.
 *
 * ★ 기간으로 자르지 않는다. 기준선 차감(현재 누적 − 기준선 시점 누적)이 유일한 정의이고,
 *   이 정의를 status·admin 저장 두 곳이 **같이** 쓴다. 정의가 갈리면 잔액이 갈린다.
 */
async function cumulativeSpent(provider) {
  return provider === 'deepgram' ? deepgramSpent(null) : openaiCumulative();
}

async function spentSince(provider, since) {
  return provider === 'deepgram' ? deepgramSpent(since) : openaiCumulative();
}

/** 최근 RATE_WINDOW_DAYS 의 하루 평균 소비(USD/일). 데이터가 없으면 0. */
async function dailyRate(provider) {
  const since = new Date(Date.now() - RATE_WINDOW_DAYS * 86400000);
  if (provider === 'deepgram') {
    const { usd } = await deepgramSpent(since);
    return usd / RATE_WINDOW_DAYS;
  }
  // OpenAI 는 월 rollup 뿐이라 이번 달 합계를 경과일로 나눈다.
  const { CueUsage } = models();
  const now = new Date();
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rows = await CueUsage.findAll({
    where: { year_month: ym }, attributes: [[fn('SUM', col('cost_usd')), 'usd']], raw: true,
  });
  const elapsed = Math.max(1, now.getUTCDate());
  return num(rows[0] && rows[0].usd) / elapsed;
}

/** 오늘(UTC 자정 기준) 소비액 — 일일 상한 판정용. Deepgram 만 시간 해상도가 있다. */
async function todaySpent(provider) {
  if (provider !== 'deepgram') return 0;
  const d = new Date();
  const midnight = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const { usd } = await deepgramSpent(midnight);
  return usd;
}

/**
 * 한 제공사의 현재 상태.
 *   configured=false 면 기준선이 아직 입력되지 않은 것 — 이 경우 **절대 차단하지 않는다**
 *   (설정 안 했다는 이유로 서비스를 끄면 그게 더 큰 사고다).
 */
async function status(provider) {
  const { ProviderCredit } = models();
  const row = await ProviderCredit.findOne({ where: { provider } });
  const meta = PROVIDER_META[provider] || { label: provider, defaultTopup: null };
  if (!row) {
    return {
      provider, label: meta.label, configured: false, blocked: false,
      balance_start_usd: null, balance_start_at: null,
      spent_usd: null, remaining_usd: null, daily_rate_usd: null, days_left: null,
      topup_url: meta.defaultTopup, block_on_empty: false,
    };
  }
  const [{ usd: cumulative, seconds }, rate] = await Promise.all([cumulativeSpent(provider), dailyRate(provider)]);
  // 기준선 이후 소비 = 현재 누적 − 기준선 시점 누적. 음수는 원장 정리/재생성 상황이므로 0 으로 클램프.
  const spent = Math.max(0, cumulative - num(row.baseline_spent_usd));
  const start = num(row.balance_start_usd);
  const remaining = Math.max(0, start - spent);
  // 소비가 없으면 남은 일수는 무한 — null 로 두고 화면에서 '—' 로 표시한다(0 으로 쓰면 경보가 오발한다).
  const daysLeft = rate > 0 ? remaining / rate : null;
  // 화면이 "이 숫자를 얼마나 믿어도 되는가" 를 말할 수 있게 단가 출처를 같이 내려준다.
  const rateUsed = provider === 'deepgram' ? await getDeepgramRate() : null;
  const rateSource = provider !== 'deepgram' ? 'ledger'
    : (row.unit_price_usd != null && Number(row.unit_price_usd) > 0 ? 'calibrated' : 'estimated');
  return {
    provider, label: meta.label, configured: true,
    unit_price_usd: rateUsed, rate_source: rateSource,
    balance_start_usd: start, balance_start_at: row.balance_start_at,
    spent_usd: Number(spent.toFixed(4)), spent_seconds: seconds,
    remaining_usd: Number(remaining.toFixed(4)),
    daily_rate_usd: Number(rate.toFixed(6)),
    days_left: daysLeft == null ? null : Number(daysLeft.toFixed(1)),
    topup_url: row.topup_url || meta.defaultTopup,
    block_on_empty: !!row.block_on_empty,
    blocked: !!row.block_on_empty && remaining <= 0,
    last_alert_days: row.last_alert_days,
    last_alert_at: row.last_alert_at,
  };
}

async function statusAll() {
  return Promise.all(Object.keys(PROVIDER_META).map((p) => status(p)));
}

/** 이 제공사를 지금 써도 되는가. 기준선 미설정·차단 해제면 항상 허용(fail-open). */
async function allow(provider) {
  try {
    const st = await status(provider);
    if (!st.configured || !st.block_on_empty) return { ok: true };
    if (st.remaining_usd > 0) return { ok: true };
    return { ok: false, reason: 'platform_credit_exhausted', provider, topup_url: st.topup_url };
  } catch (e) {
    // 판정 자체가 실패하면 서비스를 막지 않는다 — 감시 장치가 서비스를 죽이면 안 된다.
    console.warn('[providerCredit] allow 판정 실패 → fail-open:', e.message);
    return { ok: true };
  }
}


/** 남은 일수 → 경보 단계. 해당 없으면 null. */
function alertStageFor(daysLeft, remaining) {
  if (remaining <= 0) return 0;
  if (daysLeft == null) return null;              // 소비 0 — 마를 일이 없다
  // ★ **가장 급한**(가장 작은) 단계를 고른다. 큰 것부터 훑으면 3일 남았는데 "30일 단계"로
  //   보고돼, 이미 30일 경보를 보낸 뒤에는 3일 경보가 영영 안 나간다(자체 반증에서 잡힘).
  const ladder = ALERT_DAYS.filter((d) => d > 0).sort((a, b) => a - b);
  for (const d of ladder) {
    if (daysLeft <= d) return d;
  }
  return null;
}

const fmtUsd = (v) => `$${Number(v || 0).toFixed(2)}`;

/**
 * 크레딧 경보 — 하루 1회 cron 에서 호출. 상태가 **나빠졌을 때만** 보낸다.
 *
 * 중복 발송 방지: last_alert_days 보다 낮은 단계로 내려갔을 때만 발송.
 * 충전 감지: 남은 일수가 가장 높은 단계(30일)를 다시 넘어서면 상태를 비워 다음 하강에 또 울리게 한다.
 *   (충전했는데 다시는 안 울리면 그게 사고다.)
 */
async function runCreditAlerts() {
  const { ProviderCredit } = models();
  const out = [];
  for (const provider of Object.keys(PROVIDER_META)) {
    try {
      const st = await status(provider);
      if (!st.configured) { out.push({ provider, skipped: 'not_configured' }); continue; }
      const row = await ProviderCredit.findOne({ where: { provider } });
      const stage = alertStageFor(st.days_left, st.remaining_usd);
      const prev = row.last_alert_days;

      // 회복 — 여유가 최상위 단계보다 커졌으면 경보 상태를 리셋한다.
      if (stage == null && prev != null) {
        row.last_alert_days = null; row.last_alert_at = null;
        await row.save();
        out.push({ provider, reset: true });
        continue;
      }
      if (stage == null) { out.push({ provider, ok: true }); continue; }
      // 같은 단계이거나 이미 더 낮은 단계를 알렸으면 재발송하지 않는다.
      if (prev != null && stage >= prev) { out.push({ provider, provider_stage: stage, suppressed: true }); continue; }

      const empty = st.remaining_usd <= 0;
      const daysTxt = st.days_left == null ? '—' : `${st.days_left}일`;
      const title = empty
        ? `[PlanQ] ${st.label} 크레딧 소진 — 지금 충전이 필요합니다`
        : `[PlanQ] ${st.label} 크레딧 잔여 ${daysTxt} — 충전을 권장합니다`;
      const body = [
        empty
          ? '예상 잔액이 0 에 도달했습니다. 충전 전까지 해당 기능은 이용할 수 없습니다.'
          : `현재 소비 속도라면 약 ${daysTxt} 후 소진됩니다. 미리 충전해 주세요.`,
        '',
        `· 예상 잔액: ${fmtUsd(st.remaining_usd)} (기준 ${fmtUsd(st.balance_start_usd)} − 사용 ${fmtUsd(st.spent_usd)})`,
        `· 하루 평균 사용: ${fmtUsd(st.daily_rate_usd)}`,
        `· 기준 시점: ${new Date(st.balance_start_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        '',
        '충전 후에는 관리자 화면에서 새 잔액을 다시 입력해 주세요 — 그래야 추정 오차가 리셋됩니다.',
      ].join('\n');

      const platformNotify = require('./platformNotify');
      await platformNotify.notifyPlatformAdmins({
        eventKind: 'payment',            // 기존 event_kind 재사용 (결제·비용 계열)
        title,
        body,
        link: st.topup_url,
        ctaLabel: '충전하러 가기',
      }).catch((e) => console.warn('[providerCredit] 경보 발송 실패:', e.message));

      row.last_alert_days = stage;
      row.last_alert_at = new Date();
      await row.save();
      out.push({ provider, alerted: stage, remaining: st.remaining_usd, days_left: st.days_left });
    } catch (e) {
      console.warn(`[providerCredit] ${provider} 경보 처리 실패:`, e.message);
      out.push({ provider, error: e.message });
    }
  }
  return out;
}


/**
 * 실단가 자동 보정 — 관리자가 콘솔 잔액을 새로 입력할 때 호출.
 *
 * 원리: 이전 기준선 이후 실제로 빠져나간 돈 = (이전 잔액 − 지금 잔액).
 *       그 구간에 우리가 쓴 분 = 원장의 billed 초 / 60.
 *       두 값을 나누면 **제공사가 실제로 청구한 분당 단가**가 나온다.
 *       → 사람이 가격표를 찾아 넣을 필요가 없다.
 *
 * 보정을 건너뛰는 경우(모두 "나눗셈이 의미 없는" 상황):
 *   · 이전 기준선이 없다 (첫 입력)
 *   · 잔액이 늘었다 = 그 사이 충전했다 → 소비만으로 설명되지 않는다
 *   · 구간 사용량이 너무 적다 (5분 미만) → 반올림·최소과금 노이즈가 단가를 왜곡한다
 *   · 계산 결과가 상식 범위(0.0005~0.10 USD/분) 밖 → 잘못된 입력으로 보고 버린다
 *
 * @returns {{applied:boolean, rate?:number, reason?:string, minutes?:number, spentUsd?:number}}
 */
async function calibrateRate(provider, prevRow, newBalanceUsd) {
  if (provider !== 'deepgram') return { applied: false, reason: 'not_supported' };
  try {
    if (!prevRow || prevRow.balance_start_usd == null) return { applied: false, reason: 'no_previous_baseline' };
    const prevBalance = num(prevRow.balance_start_usd);
    if (prevBalance <= 0) return { applied: false, reason: 'no_previous_baseline' };
    const spentUsd = prevBalance - Number(newBalanceUsd);
    if (spentUsd <= 0) return { applied: false, reason: 'topped_up' };

    const secs = await deepgramSeconds(new Date(prevRow.balance_start_at));
    const minutes = secs / 60;
    if (minutes < 5) return { applied: false, reason: 'not_enough_usage', minutes };

    const rate = spentUsd / minutes;
    if (!Number.isFinite(rate) || rate < 0.0005 || rate > 0.10) {
      return { applied: false, reason: 'out_of_range', rate, minutes };
    }
    return { applied: true, rate: Number(rate.toFixed(6)), minutes: Number(minutes.toFixed(1)), spentUsd: Number(spentUsd.toFixed(4)) };
  } catch (e) {
    return { applied: false, reason: 'error:' + e.message };
  }
}

module.exports = {
  DEEPGRAM_USD_PER_MIN, ALERT_DAYS, PROVIDER_META,
  status, statusAll, allow, dailyRate, todaySpent, spentSince, cumulativeSpent,
  getDeepgramRate, invalidateRateCache, deepgramSeconds, calibrateRate,
  alertStageFor, runCreditAlerts,
};
