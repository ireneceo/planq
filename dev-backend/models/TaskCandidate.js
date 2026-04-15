const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskCandidate extends Model {}

TaskCandidate.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true },
  extracted_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  extracted_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  source_message_ids: { type: DataTypes.JSON, allowNull: false },
  title: { type: DataTypes.STRING(300), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  guessed_role: { type: DataTypes.STRING(50), allowNull: true },
  guessed_assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  guessed_due_date: { type: DataTypes.DATEONLY, allowNull: true },
  similar_task_id: { type: DataTypes.INTEGER, allowNull: true },
  recurrence_hint: { type: DataTypes.STRING(20), allowNull: true },
  status: {
    type: DataTypes.ENUM('pending', 'registered', 'merged', 'rejected'),
    defaultValue: 'pending',
  },
  registered_task_id: { type: DataTypes.INTEGER, allowNull: true },
  resolved_at: { type: DataTypes.DATE, allowNull: true },
  resolved_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'task_candidates',
  timestamps: false,
  underscored: true,
});

module.exports = TaskCandidate;
