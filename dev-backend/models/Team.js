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
  // 팀장 — business_members.user_id 중 1명(부서의 lead_user_id 와 같은 계약). 2026-09-21 신설.
  //   지정하면 그 멤버는 이 팀(과 팀의 부서) 소속이 된다 — routes/org.js placeLead.
  lead_user_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
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
