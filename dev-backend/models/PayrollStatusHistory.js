// PayrollStatusHistory — 급여 회차 상태 이력 (docs/PAYROLL_DESIGN.md §3.8). invoice_status_history 와 같은 모양.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PayrollStatusHistory extends Model {}

PayrollStatusHistory.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  run_id: { type: DataTypes.INTEGER, allowNull: false },
  from_status: { type: DataTypes.STRING(20), allowNull: true },
  to_status: { type: DataTypes.STRING(20), allowNull: false },
  changed_by: { type: DataTypes.INTEGER, allowNull: true },
  note: { type: DataTypes.STRING(500), allowNull: true },
}, { sequelize, tableName: 'payroll_status_history', timestamps: true, updatedAt: false, underscored: true });

module.exports = PayrollStatusHistory;
