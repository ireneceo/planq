const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 프로젝트 직접비 — 리포트 §3.5
// 외주·프린트·소모품 등 프로젝트에 직접 귀속되는 비용. 수익성 계산에 차감.
class ProjectExpense extends Model {}

ProjectExpense.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'projects', key: 'id' } },
  category: { type: DataTypes.STRING(50), allowNull: true },
  description: { type: DataTypes.STRING(300), allowNull: true },
  amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  incurred_at: { type: DataTypes.DATEONLY, allowNull: false },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  tableName: 'project_expenses',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['project_id'] }],
});

module.exports = ProjectExpense;
