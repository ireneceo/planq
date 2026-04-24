const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectIssue extends Model {}

ProjectIssue.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  // 독립 대화(project 없음)도 이슈를 가질 수 있도록 nullable. 대신 conversation_id 로 연결.
  project_id: { type: DataTypes.BIGINT, allowNull: true },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true },
  body: { type: DataTypes.TEXT, allowNull: false },
  author_user_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize,
  tableName: 'project_issues',
  timestamps: true,
  underscored: true,
});

module.exports = ProjectIssue;
