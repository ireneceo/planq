const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectIssue extends Model {}

ProjectIssue.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  author_user_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize,
  tableName: 'project_issues',
  timestamps: true,
  underscored: true,
});

module.exports = ProjectIssue;
