const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectProcessPart extends Model {}

ProjectProcessPart.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'projects', key: 'id' } },
  depth1: { type: DataTypes.STRING(200), allowNull: true },
  depth2: { type: DataTypes.STRING(200), allowNull: true },
  depth3: { type: DataTypes.STRING(200), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  status_key: { type: DataTypes.STRING(40), allowNull: true },
  link: { type: DataTypes.STRING(500), allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  // 사용자 정의 컬럼 값 — { col_key: value } 형태
  extra: { type: DataTypes.JSON, allowNull: true },
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'project_process_parts', timestamps: true, underscored: true,
  indexes: [{ fields: ['project_id', 'order_index'] }],
});

module.exports = ProjectProcessPart;
