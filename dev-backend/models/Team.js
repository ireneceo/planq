// Team (팀) — Q조직 D1. 부서(Department) 하위 선택적 팀.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Team extends Model {}

Team.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  department_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'departments', key: 'id' },
  },
  name: { type: DataTypes.STRING(100), allowNull: false },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'teams',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['business_id'] }, { fields: ['department_id'] }],
});

module.exports = Team;
