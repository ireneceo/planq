// 플랜 변경 이력 — 누가 언제 어떤 플랜에서 어떤 플랜으로 바꿨나
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessPlanHistory extends Model {}

BusinessPlanHistory.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  from_plan: { type: DataTypes.STRING(32), allowNull: true },
  to_plan: { type: DataTypes.STRING(32), allowNull: false },
  reason: {
    type: DataTypes.ENUM('upgrade', 'downgrade', 'trial_start', 'trial_end', 'expire', 'admin_adjust', 'payment_failed', 'refund'),
    allowNull: false
  },
  changed_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },   // null = system
  note: { type: DataTypes.STRING(500), allowNull: true },
  effective_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  sequelize,
  tableName: 'business_plan_history',
  timestamps: true,
  updatedAt: false,
  createdAt: 'created_at',
  underscored: true,
  indexes: [{ fields: ['business_id', 'created_at'] }]
});

module.exports = BusinessPlanHistory;
