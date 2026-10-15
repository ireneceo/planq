// PayrollRun — 워크스페이스 × 귀속월 × 차수(정정) (docs/PAYROLL_DESIGN.md §3.5)
//   상태 전이는 services/payrollTransition.js 한 문에서만(초안 → 대조 → 확정(잠금) → 지급완료).
//   합계 칸은 전이 함수가 다시 센 캐시다 — 화면은 이것만 읽는다(공식은 services/payrollCalc 한 벌).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PayrollRun extends Model {}

PayrollRun.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  period_ym: { type: DataTypes.STRING(7), allowNull: false },
  seq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  kind: { type: DataTypes.ENUM('regular', 'adjustment'), allowNull: false, defaultValue: 'regular' },
  pay_date: { type: DataTypes.DATEONLY, allowNull: true },
  status: { type: DataTypes.ENUM('draft', 'reconciling', 'confirmed', 'paid'), allowNull: false, defaultValue: 'draft' },
  statement_file_id: { type: DataTypes.INTEGER, allowNull: true },
  statement_imported_at: { type: DataTypes.DATE, allowNull: true },
  statement_extract_json: { type: DataTypes.JSON, allowNull: true },
  headcount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  gross_total: { type: DataTypes.DECIMAL(16, 2), allowNull: true },
  deduction_total: { type: DataTypes.DECIMAL(16, 2), allowNull: true },
  net_total: { type: DataTypes.DECIMAL(16, 2), allowNull: true },
  totals_by_currency: { type: DataTypes.JSON, allowNull: true },
  confirmed_by: { type: DataTypes.INTEGER, allowNull: true },
  confirmed_at: { type: DataTypes.DATE, allowNull: true },
  paid_by: { type: DataTypes.INTEGER, allowNull: true },
  paid_at: { type: DataTypes.DATE, allowNull: true },
  transfer_task_mode: { type: DataTypes.ENUM('per_person', 'single'), allowNull: false, defaultValue: 'per_person' },
  transfer_assignee_id: { type: DataTypes.INTEGER, allowNull: true },
  adjusts_run_id: { type: DataTypes.INTEGER, allowNull: true },
  note: { type: DataTypes.STRING(500), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, tableName: 'payroll_runs', timestamps: true, underscored: true });

module.exports = PayrollRun;
