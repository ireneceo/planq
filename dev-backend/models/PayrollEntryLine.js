// PayrollEntryLine — 회차 × 사람 × 항목 = 대조의 단위 (docs/PAYROLL_DESIGN.md §3.7)
//   draft_amount = PlanQ 예상치(외부 항목은 NULL) · statement_amount = 세무사 대장 값 · final_amount = 확정에 쓰는 값.
//   ★ 빈칸(NULL)을 0 으로 보지 않는다 — 확정은 final 이 빈 합계 줄이 하나라도 있으면 409 line_unresolved.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PayrollEntryLine extends Model {}

PayrollEntryLine.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  entry_id: { type: DataTypes.INTEGER, allowNull: false },
  pay_item_id: { type: DataTypes.INTEGER, allowNull: false },
  draft_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  statement_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  final_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  final_source: { type: DataTypes.ENUM('draft', 'statement', 'manual'), allowNull: true },
  item_name_snapshot: { type: DataTypes.STRING(100), allowNull: true },
  note: { type: DataTypes.STRING(500), allowNull: true },
}, { sequelize, tableName: 'payroll_entry_lines', timestamps: true, underscored: true });

module.exports = PayrollEntryLine;
