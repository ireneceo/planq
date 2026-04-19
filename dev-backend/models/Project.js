const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Project extends Model {}

Project.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  client_company: { type: DataTypes.STRING(200), allowNull: true },
  status: {
    type: DataTypes.ENUM('active', 'paused', 'closed'),
    defaultValue: 'active',
  },
  start_date: { type: DataTypes.DATEONLY, allowNull: true },
  end_date: { type: DataTypes.DATEONLY, allowNull: true },
  default_assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  owner_user_id: { type: DataTypes.INTEGER, allowNull: false },
  // 타임라인/일정 보기 구분용 프로젝트 색상 (hex) — 프리셋 10색 중 하나 기본
  color: { type: DataTypes.STRING(20), allowNull: true },
}, {
  sequelize,
  tableName: 'projects',
  timestamps: true,
  underscored: true,
});

module.exports = Project;
