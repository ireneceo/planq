const AuditLog = require('../models/AuditLog');

// camelCase / snake_case / entity_* 호환 — 기존 코드 모두 수용
const createAuditLog = async (opts = {}) => {
  try {
    const user_id = opts.userId ?? opts.user_id ?? null;
    const business_id = opts.businessId ?? opts.business_id ?? null;
    const target_type = opts.targetType ?? opts.target_type ?? opts.entity_type ?? null;
    const target_id = opts.targetId ?? opts.target_id ?? opts.entity_id ?? null;
    const action = opts.action;
    const old_value = opts.oldValue ?? opts.old_value ?? null;
    const new_value = opts.newValue ?? opts.new_value ?? null;
    const ip_address = opts.ipAddress ?? opts.ip_address ?? null;
    if (!action || !target_type) {
      console.error('Audit log missing action/target_type', { action, target_type });
      return;
    }
    await AuditLog.create({ user_id, business_id, action, target_type, target_id, old_value, new_value, ip_address });
  } catch (error) {
    console.error('Audit log creation failed:', error.message);
  }
};

module.exports = { createAuditLog };
