// ContractPayLine — 계약이 정한 금액 한 줄(계약 × 항목) (docs/PAYROLL_DESIGN.md §3.4).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ContractPayLine extends Model {}

ContractPayLine.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  contract_id: { type: DataTypes.INTEGER, allowNull: false },
  pay_item_id: { type: DataTypes.INTEGER, allowNull: false },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
}, { sequelize, tableName: 'contract_pay_lines', timestamps: true, underscored: true });

module.exports = ContractPayLine;
