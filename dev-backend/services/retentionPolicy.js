// services/retentionPolicy.js — 보관기간의 **단일 원천** (Fable 설계 게이트 2026-09-04).
//
// 왜 이 파일이 생겼나: 개인정보처리방침이 "플랜별 보관기간" 을 약속했는데 코드가 그 값을
//   **한 곳에서도 읽지 않았다.** `config/plans.js` 의 audit_log_retention_days·trash_retention_days
//   를 읽는 코드가 0곳이고, 대신 30 이라는 숫자가 세 파일에 각자 박혀 있었다.
//   방침에 적힌 문장을 코드가 지키게 하는 것이 이 모듈의 일이다.
//
// ── 핵심 규칙: 래칫 업 (다운그레이드 절벽 방지) ──────────────────────────────
//   각 행의 수명 = **기록(삭제) 시점에 약속한 기간** 과 **현재 플랜 기간** 중 **긴 쪽**.
//   Pro(7년)에서 Free(30일)로 내려간다고 3년치가 즉시 사라지면 그건 기능이 아니라 사고다.
//   그래서 소급 삭제가 설계상 발생하지 않는다 — 유예도, 다운그레이드 경고도 필요 없다.
//   업그레이드는 즉시 반영된다(현재 플랜이 더 길면 그쪽을 쓴다).
//
// ── fail-closed: 못 읽으면 **보존** ─────────────────────────────────────────
//   ★ `config/plans.js` 의 getPlan(code) 은 미지 코드에 **starter** 를 준다(감사 90일).
//     `services/plan.js` 의 getBusinessPlan 은 비즈니스가 없으면 **free** 를 준다(30일).
//     둘 다 retention 경로에서 쓰면 **모르는 상태가 곧 삭제**가 된다. 그래서 여기서는
//     PLANS[code] 를 직접 찾고, 못 찾으면 ok:false 로 건너뛴다.
//   ★ fail-closed 는 값을 잘못 읽어도 똑같이 조용하다 — 그래서 건너뛴 사유를 세어
//     리포트에 남긴다(memory feedback_fail_closed_is_silent_when_misread).
const { PLANS } = require('../config/plans');

const KIND_KEY = {
  audit_log: 'audit_log_retention_days',
  trash: 'trash_retention_days',
};

// business_id 가 NULL 인 플랫폼 행(운영자 액션). 최상위 티어 값에 묶어 plans.js 와 갈라지지 않게 한다.
const PLATFORM_AUDIT_RETENTION_DAYS = PLANS.enterprise.limits.audit_log_retention_days;

// 이 기능 도입 **이전에** 삭제된 휴지통 행의 백필 전용 — 그때 화면이 사용자에게 보여준 숫자.
const LEGACY_TRASH_PROMISE_DAYS = 30;

// 스탬프를 심기 시작한 시점. **이 앞의 행에는 스탬프가 없는 것이 정상**이다 — 그때는 기록하지
//   않았고, 백필이 붙일 수 있는 것만 붙였다(나머지 NULL 은 보존을 뜻한다).
//   헬스체크가 "스탬프 누락" 을 셀 때 이 기준을 쓴다. 안 그러면 옛 행 때문에 영원히 빨간불이고,
//   빨간불이 상수면 아무도 안 본다.
const RETENTION_ROLLOUT_AT = '2026-09-04T12:00:00Z';

/**
 * 이 워크스페이스의 보관기간을 구한다.
 * @returns {{ok:true, days:number, planCode:string}
 *         | {ok:false, reason:'no_business'|'workspace_deleted'|'unknown_plan'|'bad_value'|'lookup_failed'}}
 */
async function resolveRetention(businessId, kind) {
  const key = KIND_KEY[kind];
  if (!key) return { ok: false, reason: 'bad_value' };
  if (!businessId) return { ok: false, reason: 'no_business' };
  try {
    const { Business } = require('../models');
    // ★ Business 를 **직접** 본다. getBusinessPlan 은 비즈니스가 없어도 free 를 돌려주고,
    //   deleted_at 도 보지 않는다 — 둘 다 삭제 쪽으로 기우는 폴백이다.
    const biz = await Business.findByPk(businessId, { attributes: ['id', 'deleted_at'] });
    if (!biz) return { ok: false, reason: 'no_business' };
    if (biz.deleted_at) return { ok: false, reason: 'workspace_deleted' };  // 워크스페이스 삭제 흐름이 소유한다

    // 면제(내부·테스터) 판정은 getBusinessPlan 이 단일 착지점이라 재구현하지 않는다.
    //   다만 코드만 받아 PLANS 에서 **직접** 다시 찾는다(getPlan 의 starter 폴백을 피한다).
    const { getBusinessPlan } = require('./plan');
    const resolved = await getBusinessPlan(businessId);
    const code = resolved?.plan?.code;
    const entry = code ? PLANS[code] : null;
    if (!entry) return { ok: false, reason: 'unknown_plan' };

    const days = entry.limits?.[key];
    if (!Number.isInteger(days) || days <= 0) return { ok: false, reason: 'bad_value' };
    return { ok: true, days, planCode: code };
  } catch {
    return { ok: false, reason: 'lookup_failed' };
  }
}

/**
 * 지금 이 워크스페이스에서 기록/삭제하면 약속하는 만료 시각.
 * 못 읽으면 null — 호출자는 컬럼에 NULL 을 넣고, NULL 은 **보존**을 뜻한다.
 */
async function stampFor(businessId, kind, baseAt = new Date()) {
  const r = await resolveRetention(businessId, kind);
  if (!r.ok) return null;
  return new Date(new Date(baseAt).getTime() + r.days * 86400000);
}

/** 플랫폼 행(업무 없는 운영자 액션)의 만료 시각. */
function platformAuditExpiry(baseAt = new Date()) {
  return new Date(new Date(baseAt).getTime() + PLATFORM_AUDIT_RETENTION_DAYS * 86400000);
}

/**
 * 실제 만료 시각 — 래칫 업.
 * @param stampedAt 기록 시점에 약속한 만료 (컬럼 값, null 가능)
 * @param baseAt    기록/삭제 시각
 * @param currentDays 현재 플랜 기간 (null = 판단 불가)
 * @returns Date | null (null = 판단 불가 → 지우지 않는다)
 */
function effectiveExpiry(stampedAt, baseAt, currentDays) {
  const stamped = stampedAt ? new Date(stampedAt).getTime() : null;
  const current = (Number.isInteger(currentDays) && currentDays > 0 && baseAt)
    ? new Date(baseAt).getTime() + currentDays * 86400000
    : null;
  if (stamped == null && current == null) return null;
  if (stamped == null) return new Date(current);
  if (current == null) return new Date(stamped);
  return new Date(Math.max(stamped, current));   // 긴 쪽 = 래칫 업
}

/** 지울 수 있는가. 판단 불가(null)면 false — 모르면 보존한다. */
function isExpired(stampedAt, baseAt, currentDays, now = new Date()) {
  const exp = effectiveExpiry(stampedAt, baseAt, currentDays);
  if (!exp) return false;
  return exp.getTime() <= new Date(now).getTime();
}

module.exports = {
  resolveRetention,
  stampFor,
  platformAuditExpiry,
  effectiveExpiry,
  isExpired,
  PLATFORM_AUDIT_RETENTION_DAYS,
  LEGACY_TRASH_PROMISE_DAYS,
  RETENTION_ROLLOUT_AT,
};
