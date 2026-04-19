const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskComment extends Model {}

TaskComment.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  content: { type: DataTypes.TEXT, allowNull: false },
  // 공개 범위 — project_notes 와 동일한 ENUM 사용 (메모·댓글 통일)
  //  personal  작성자 본인만
  //  internal  내부 멤버 전원 (고객 제외)
  //  shared    내부 + 관련 고객 (client reviewer 또는 project_clients)
  visibility: {
    type: DataTypes.ENUM('personal', 'internal', 'shared'),
    allowNull: false,
    defaultValue: 'internal',
  },
  // 컨펌자가 승인/수정요청 시 자동 생성된 시스템 댓글인지
  kind: {
    type: DataTypes.ENUM('user', 'system_revision', 'system_approve'),
    allowNull: false,
    defaultValue: 'user',
  },
}, {
  sequelize,
  tableName: 'task_comments',
  timestamps: true,
  underscored: true,
});

module.exports = TaskComment;
