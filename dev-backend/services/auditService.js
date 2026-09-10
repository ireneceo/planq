// AuditLog 헬퍼 — CUD 변경 추적 통일.
//
// 사용:
//   const { logAudit } = require('../services/auditService');
//   logAudit(req, { action: 'invoice.update', targetType: 'invoice', targetId: invoice.id, oldValue: prev, newValue: next });
//
// 정책:
//   - fire-and-forget. AuditLog 저장 실패가 메인 응답을 막으면 안 됨 → setImmediate + try/catch 격리
//   - req 가 있으면 user_id / business_id / ip 자동 추출. 없으면 explicit 으로 전달 가능
//   - oldValue / newValue 는 직렬화 전에 sensitive 필드 제거 (password / token / secret 키워드 자동 마스킹)
//   - target_id null 허용 (예: 일괄 작업 / 시스템 액션)
//
// 호출처: invoices, signatures, posts, payments, tasks 의 CUD 라우트.
// CLAUDE.md "모든 CUD 작업은 AuditLog 에 기록" 정책 enforce.

// substring 매칭 — stripe_secret_enc / portone_webhook_secret / *_api_secret 등 접미·접두 붙은 키도 마스킹.
// (앵커드 정규식이 stripe_secret_enc 를 놓쳐 audit_logs 에 암호문 저장되던 회귀 — Fable F2)
const SENSITIVE_KEYS = /(password|token|secret|otp|jwt|refresh|api_key|billing_key|_enc)/i;

function maskSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitive);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = '***';
    } else if (v && typeof v === 'object') {
      out[k] = maskSensitive(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}


// 감사 기록의 만료 시각 — 워크스페이스 행은 플랜 기준, 플랫폼 행(business_id NULL)은 최상위 티어.
//   보관기간 정의는 services/retentionPolicy.js 한 곳에만 있다.
async function stampRetainUntil(businessId) {
  try {
    const { stampFor, platformAuditExpiry } = require('./retentionPolicy');
    if (!businessId) return platformAuditExpiry();
    return await stampFor(businessId, 'audit_log');
  } catch { return null; }   // 스탬프 실패가 감사 기록 자체를 막으면 안 된다. NULL = 보존.
}

/**
 * 감사 행을 **실제로 쓰는 단일 지점** — 스탬프(retain_until)와 마스킹이 여기 한 곳에 있다.
 * 호출부는 아래 셋 중 하나를 쓴다. `AuditLog.create` 를 직접 부르면 둘 다 건너뛴다
 * (가드 `--category=auditentry` 가 막는다).
 *
 *   writeAudit(opts)      — **await 하고 실패를 던진다.** 반드시 남아야 하는 기록
 *                            (대리 로그인·데이터 내보내기처럼 안 남으면 안 되는 것).
 *   createAuditLog(opts)  — fire-and-forget. 본 작업을 막지 않는다.
 *   logAudit(req, opts)   — createAuditLog + req 에서 ip/user/business 를 알아서 채운다.
 */
async function writeAudit(opts = {}, options = undefined) {
  // ★ 두 번째 인자는 Sequelize options 를 **그대로** 넘긴다 — 특히 `{ transaction }`.
  //   삼키면 감사 행이 트랜잭션 **밖**에 써져, 본 작업이 롤백돼도 기록만 남는다
  //   (없던 일이 원장에 있는 상태). addonBilling 이 실제로 트랜잭션 안에서 부른다.
  const { AuditLog } = require('../models');
  const bizId = opts.businessId ?? opts.business_id ?? null;
  const old_value = opts.oldValue ?? opts.old_value ?? null;
  const new_value = opts.newValue ?? opts.new_value ?? null;
  return AuditLog.create({
    user_id: opts.userId ?? opts.user_id ?? null,
    acting_for_user_id: opts.actingForUserId ?? opts.acting_for_user_id ?? null,
    business_id: bizId,
    action: opts.action,
    target_type: opts.targetType ?? opts.target_type ?? opts.entity_type,
    target_id: opts.targetId ?? opts.target_id ?? opts.entity_id ?? null,
    old_value: old_value ? maskSensitive(old_value) : null,
    new_value: new_value ? maskSensitive(new_value) : null,
    ip_address: opts.ipAddress ?? opts.ip_address ?? null,
    retain_until: await stampRetainUntil(bizId),
  }, options);
}

function logAudit(req, { action, targetType, targetId = null, oldValue = null, newValue = null, businessId = null, userId = null, actingForUserId = null }) {
  setImmediate(async () => {
    try {
      const { AuditLog } = require('../models');
      const bizId = businessId ?? req?.businessId ?? req?.body?.business_id ?? req?.params?.businessId ?? null;
      await AuditLog.create({
        user_id: userId ?? req?.user?.id ?? null,
        // on-behalf-of — Cue 처럼 위임받아 행동할 때 그 권한의 원소유자.
        //   ★ 이 필드를 흘리면 "누구 권한으로 한 일인가" 가 원장에서 사라진다
        //     (project_agent_permission_model 의 핵심). 헬퍼가 반드시 실어 나른다.
        acting_for_user_id: actingForUserId ?? null,
        business_id: bizId,
        action,
        target_type: targetType,
        target_id: targetId,
        old_value: oldValue ? maskSensitive(oldValue) : null,
        new_value: newValue ? maskSensitive(newValue) : null,
        ip_address: req?.ip || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null,
        // 이 기록을 언제까지 보관하기로 약속했는가 — 기록 시점 플랜 기준(래칫 업의 한쪽 축).
        //   못 읽으면 NULL 이고, NULL 은 보존을 뜻한다. 여기서 예외를 던지지 않는다.
        retain_until: await stampRetainUntil(bizId),
      });
    } catch (e) {
      console.warn('[auditService]', action, e.message);
    }
  });
}

// 기존 호출처 시그니처 호환 — middleware/audit.js 의 createAuditLog 와 동일 입력.
// 차이: setImmediate fire-and-forget + sensitive 마스킹 추가. 호출처 await 영향 없음 (Promise.resolve).
// camelCase / snake_case / entity_* 모두 수용 (기존 createAuditLog 와 동일).
function createAuditLog(opts = {}) {
  const action = opts.action;
  const targetType = opts.targetType ?? opts.target_type ?? opts.entity_type;
  if (!action || !targetType) {
    console.error('[auditService] createAuditLog missing action/target_type', { action, targetType });
    return;
  }
  setImmediate(async () => {
    try {
      const { AuditLog } = require('../models');
      const old_value = opts.oldValue ?? opts.old_value ?? null;
      const new_value = opts.newValue ?? opts.new_value ?? null;
      // signatures 등 일부 호출은 metadata 키로 추가 정보 전달 — new_value 에 합침
      const metadata = opts.metadata ?? null;
      const bizId = opts.businessId ?? opts.business_id ?? null;
      await AuditLog.create({
        user_id: opts.userId ?? opts.user_id ?? null,
        acting_for_user_id: opts.actingForUserId ?? opts.acting_for_user_id ?? null,
        business_id: bizId,
        action,
        target_type: targetType,
        target_id: opts.targetId ?? opts.target_id ?? opts.entity_id ?? null,
        old_value: old_value ? maskSensitive(old_value) : null,
        new_value: maskSensitive(metadata ? { ...(new_value || {}), ...metadata } : new_value) ?? null,
        ip_address: opts.ipAddress ?? opts.ip_address ?? null,
        retain_until: await stampRetainUntil(bizId),   // 두 입구가 같은 규칙을 쓴다
      });
    } catch (e) {
      console.warn('[auditService] createAuditLog failed', e.message);
    }
  });
}

module.exports = {
  writeAudit, logAudit, createAuditLog };
