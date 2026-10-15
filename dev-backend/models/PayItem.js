// PayItem — 워크스페이스가 정의하는 급여 항목(지급/공제) (docs/PAYROLL_DESIGN.md §3.3).
//   나라별 요율은 코드에 두지 않는다 — 법정 공제는 calc 'external'(세무사 대장 값이 정답).
//   기본 항목 «기본급»(code 'base')은 services/payrollContracts.ensureBaseItem 이 만든다. 편집·프리셋은 services/payrollItems.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PayItem extends Model {}

PayItem.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  code: { type: DataTypes.STRING(40), allowNull: false },
  name: { type: DataTypes.STRING(100), allowNull: false },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  side: { type: DataTypes.ENUM('earning', 'deduction'), allowNull: false },
  // 누구에게 붙나 — 근로소득(직원)·사업소득(프리랜서)·기타·전체. 대상자의 income_kind 와 맞는 항목만 그 사람 초안에 줄이 생긴다.
  applies_to: { type: DataTypes.ENUM('all', 'employment', 'business', 'other'), allowNull: false, defaultValue: 'all' },
  taxable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  calc: { type: DataTypes.ENUM('fixed', 'rate', 'manual', 'external', 'unpaid_leave'), allowNull: false, defaultValue: 'fixed' },
  rate: { type: DataTypes.DECIMAL(8, 5), allowNull: true },
  rate_base: { type: DataTypes.ENUM('taxable_total', 'gross_total', 'item'), allowNull: true },
  base_item_id: { type: DataTypes.INTEGER, allowNull: true },
  sign: { type: DataTypes.ENUM('plus', 'minus'), allowNull: false, defaultValue: 'plus' },
  in_total: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  is_settlement: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_statutory: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  rounding: { type: DataTypes.ENUM('round', 'floor', 'ceil'), allowNull: false, defaultValue: 'round' },
  rounding_unit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  aliases: { type: DataTypes.JSON, allowNull: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  preset_source: { type: DataTypes.STRING(20), allowNull: true },
}, { sequelize, tableName: 'pay_items', timestamps: true, underscored: true });

module.exports = PayItem;
