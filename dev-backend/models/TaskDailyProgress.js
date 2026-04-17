const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskDailyProgress extends Model {}

TaskDailyProgress.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' } },
  snapshot_date: { type: DataTypes.DATEONLY, allowNull: false },
  progress_percent: { type: DataTypes.INTEGER, defaultValue: 0 },
  actual_hours: { type: DataTypes.DECIMAL(5, 1), defaultValue: 0 },
  estimated_hours: { type: DataTypes.DECIMAL(5, 1), allowNull: true },
  status: { type: DataTypes.STRING(40), allowNull: true },
}, {
  sequelize,
  tableName: 'task_daily_progress',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['task_id', 'snapshot_date'] },
    { fields: ['snapshot_date'] },
  ],
});

module.exports = TaskDailyProgress;
