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

const SENSITIVE_KEYS = /^(password|password_hash|token|secret|otp|otp_hash|jwt|refresh|api_key)$/i;

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

module.exports = { logAudit };
