const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskAttachment extends Model {}

TaskAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' } },
  comment_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'task_comments', key: 'id' } },
  // 'description' : TipTap 에디터 인라인 이미지 / 'task' : 업무 직첨부 / 'comment' : 댓글 첨부
  context: { type: DataTypes.ENUM('description', 'task', 'comment'), allowNull: false, defaultValue: 'task' },
  original_name: { type: DataTypes.STRING(500), allowNull: false },
  stored_name: { type: DataTypes.STRING(255), allowNull: false },
  file_path: { type: DataTypes.STRING(500), allowNull: false },
  file_size: { type: DataTypes.BIGINT, allowNull: false },
  mime_type: { type: DataTypes.STRING(100), allowNull: true },
  uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  tableName: 'task_attachments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
});

module.exports = TaskAttachment;
