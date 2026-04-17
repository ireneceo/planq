const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskComment extends Model {}

TaskComment.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  content: { type: DataTypes.TEXT, allowNull: false },
}, {
  sequelize,
  tableName: 'task_comments',
  timestamps: true,
  underscored: true,
});

module.exports = TaskComment;
