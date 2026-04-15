const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectMember extends Model {}

ProjectMember.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.STRING(50), defaultValue: '기타' },
  role_order: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'project_members',
  timestamps: false,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = ProjectMember;
