// Department (부서) — Q조직 D1. 워크스페이스 평면 부서 (다단계 트리 아님).
//   표시·집계 단위 (권한 부여 축 아님). lead_user_id = 부서장 (단일원천).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Department extends Model {}

Department.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  name: { type: DataTypes.STRING(100), allowNull: false },
  name_en: { type: DataTypes.STRING(100), allowNull: true },
  color: { type: DataTypes.STRING(20), allowNull: true },
  // 부서장 — business_members.user_id 중 1명. 파생: dept.lead_user_id === member.user_id
  lead_user_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'departments',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['business_id'] }],
});

module.exports = Department;
