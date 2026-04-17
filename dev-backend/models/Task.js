const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Task extends Model {}

Task.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'conversations', key: 'id' }
  },
  source_message_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'messages', key: 'id' }
  },
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  assignee_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  status: {
    type: DataTypes.ENUM(
      'task_requested', 'task_re_requested', 'waiting', 'not_started',
      'in_progress', 'review_requested', 're_review_requested',
      'customer_confirm', 'completed', 'canceled'
    ),
    defaultValue: 'not_started'
  },
  priority_order: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'User-defined sort order (1=highest)',
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── 시간 추적 ───
  estimated_hours: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: true,
  },
  actual_hours: {
    type: DataTypes.DECIMAL(5, 1),
    defaultValue: 0,
  },
  progress_percent: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  planned_week_start: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Monday of the week this task is planned for',
  },
  category: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  from_candidate_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
    references: { model: 'task_candidates', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'tasks',
  timestamps: true,
  underscored: true
});

module.exports = Task;
