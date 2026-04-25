// 업무 — 역할별 사용자 시간.
// 한 업무에 대해 (담당자/요청자/컨펌자N) 각자가 자기의 예측·실제 시간을 따로 갖는다.
// 본인 가용시간 합산은 user_id 로 필터하면 자연 일치.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskUserHours extends Model {}

TaskUserHours.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'CASCADE',
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  role: {
    type: DataTypes.ENUM('assignee', 'requester', 'reviewer'),
    allowNull: false,
    comment: '이 사용자가 이 task에서 갖는 역할',
  },
  estimated_hours: {
    type: DataTypes.DECIMAL(6, 2),
    defaultValue: 0,
    allowNull: false,
  },
  actual_hours: {
    type: DataTypes.DECIMAL(6, 2),
    defaultValue: 0,
    allowNull: false,
  },
}, {
  sequelize,
  tableName: 'task_user_hours',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['task_id', 'user_id', 'role'] },
    { fields: ['user_id', 'role'] },
    { fields: ['task_id'] },
  ],
});

module.exports = TaskUserHours;
