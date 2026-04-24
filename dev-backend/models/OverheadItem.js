const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 고정비 항목 — 리포트 §3.5
// 월 임대료·SaaS 구독·법무·복리후생 등. 손익계산 및 Break-even 산출에 사용.
class OverheadItem extends Model {}

OverheadItem.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  category: {
    type: DataTypes.ENUM('payroll', 'rent', 'saas', 'legal', 'benefits', 'marketing', 'other'),
    allowNull: false,
  },
  name: { type: DataTypes.STRING(200), allowNull: false },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  cycle: {
    type: DataTypes.ENUM('monthly', 'quarterly', 'yearly'),
    defaultValue: 'monthly',
  },
  starts_at: { type: DataTypes.DATEONLY, allowNull: true },
  ends_at: { type: DataTypes.DATEONLY, allowNull: true },
}, {
  sequelize,
  tableName: 'overhead_items',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['business_id'] }],
});

module.exports = OverheadItem;
