// PayrollEntry — 회차 × 사람 (docs/PAYROLL_DESIGN.md §3.6)
//   표시 정보(이름·사번·직위·부서·은행 끝 4자리)는 확정 때 동결한다 — 이후 사람 정보가 바뀌어도 그 달 대장은 그대로.
//   ★ 계좌번호는 여기 없다(bank_last4 만 — 명세서 «지급 계좌 ****1234»).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PayrollEntry extends Model {}

PayrollEntry.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  run_id: { type: DataTypes.INTEGER, allowNull: false },
  person_id: { type: DataTypes.INTEGER, allowNull: false },
  contract_id: { type: DataTypes.INTEGER, allowNull: true },
  display_name: { type: DataTypes.STRING(100), allowNull: false },
  employee_no: { type: DataTypes.STRING(30), allowNull: true },
  job_title: { type: DataTypes.STRING(100), allowNull: true },
  department_name: { type: DataTypes.STRING(100), allowNull: true },
  unpaid_leave_days: { type: DataTypes.DECIMAL(4, 1), allowNull: true },
  unpaid_leave_source: { type: DataTypes.ENUM('leave', 'manual'), allowNull: true },
  gross_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  taxable_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  nontaxable_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  deduction_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  net_total: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'KRW' },
  bank_name_snapshot: { type: DataTypes.STRING(60), allowNull: true },
  bank_last4: { type: DataTypes.STRING(4), allowNull: true },
  statement_matched: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  statement_warnings: { type: DataTypes.JSON, allowNull: true },
  transfer_task_id: { type: DataTypes.INTEGER, allowNull: true },
  payslip_viewed_at: { type: DataTypes.DATE, allowNull: true },
  note: { type: DataTypes.STRING(500), allowNull: true },
}, { sequelize, tableName: 'payroll_entries', timestamps: true, underscored: true });

module.exports = PayrollEntry;
