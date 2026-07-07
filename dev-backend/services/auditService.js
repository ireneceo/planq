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

function logAudit(req, { action, targetType, targetId = null, oldValue = null, newValue = null, businessId = null, userId = null }) {
  setImmediate(async () => {
    try {
      const { AuditLog } = require('../models');
      await AuditLog.create({
        user_id: userId ?? req?.user?.id ?? null,
        business_id: businessId ?? req?.businessId ?? req?.body?.business_id ?? req?.params?.businessId ?? null,
        action,
        target_type: targetType,
        target_id: targetId,
        old_value: oldValue ? maskSensitive(oldValue) : null,
        new_value: newValue ? maskSensitive(newValue) : null,
        ip_address: req?.ip || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || null,
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
      await AuditLog.create({
        user_id: opts.userId ?? opts.user_id ?? null,
        business_id: opts.businessId ?? opts.business_id ?? null,
        action,
        target_type: targetType,
        target_id: opts.targetId ?? opts.target_id ?? opts.entity_id ?? null,
        old_value: old_value ? maskSensitive(old_value) : null,
        new_value: maskSensitive(metadata ? { ...(new_value || {}), ...metadata } : new_value) ?? null,
        ip_address: opts.ipAddress ?? opts.ip_address ?? null,
      });
    } catch (e) {
      console.warn('[auditService] createAuditLog failed', e.message);
    }
  });
}

module.exports = { logAudit, createAuditLog };
