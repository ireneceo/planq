// EmploymentContract — 사람 × 기간 계약 (docs/PAYROLL_DESIGN.md §3.2).
//   «한 사람에게 같은 날 유효(active)한 계약은 하나» 는 DB 제약이 아니라 services/payrollContracts.activate 가 지킨다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmploymentContract extends Model {}

EmploymentContract.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  person_id: { type: DataTypes.INTEGER, allowNull: false },
  kind: { type: DataTypes.ENUM('regular', 'fixed_term', 'freelance'), allowNull: false, defaultValue: 'regular' },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: true },
  weekly_work_days: { type: DataTypes.INTEGER, allowNull: true },
  daily_work_hours: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },
  pay_day: { type: DataTypes.INTEGER, allowNull: true },
  post_id: { type: DataTypes.BIGINT, allowNull: true },
  signed_at: { type: DataTypes.DATE, allowNull: true },
  status: { type: DataTypes.ENUM('draft', 'active', 'ended', 'superseded'), allowNull: false, defaultValue: 'draft' },
  note: { type: DataTypes.STRING(500), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, tableName: 'employment_contracts', timestamps: true, underscored: true });

module.exports = EmploymentContract;
