const AuditLog = require('../models/AuditLog');

const createAuditLog = async ({ userId, businessId, action, targetType, targetId, oldValue, newValue, ipAddress }) => {
  try {
    await AuditLog.create({
      user_id: userId,
      business_id: businessId,
      action,
      target_type: targetType,
      target_id: targetId,
      old_value: oldValue || null,
      new_value: newValue || null,
      ip_address: ipAddress || null
    });
  } catch (error) {
    console.error('Audit log creation failed:', error.message);
  }
};

module.exports = { createAuditLog };
