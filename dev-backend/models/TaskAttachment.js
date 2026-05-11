const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskAttachment extends Model {}

TaskAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' } },
  comment_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'task_comments', key: 'id' } },
  // context (4종, 사이클 N+6 부터):
  //  'description'        : TipTap 에디터 인라인 이미지 (description 본문 안 그림)
  //  'description_attach' : description 영역 댓글식 첨부 칩 (의뢰자 영역, 결과물과 분리)
  //  'task'               : 결과물 영역 직첨부 (수행자 영역)
  //  'comment'            : 댓글 첨부 (댓글 안)
  context: { type: DataTypes.ENUM('description', 'description_attach', 'task', 'comment'), allowNull: false, defaultValue: 'task' },
  original_name: { type: DataTypes.STRING(500), allowNull: false },
  stored_name: { type: DataTypes.STRING(255), allowNull: false },
  file_path: { type: DataTypes.STRING(500), allowNull: false },
  file_size: { type: DataTypes.BIGINT, allowNull: false },
  mime_type: { type: DataTypes.STRING(100), allowNull: true },
  uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  storage_provider: { type: DataTypes.ENUM('planq', 'gdrive'), allowNull: false, defaultValue: 'planq' },
  external_id: { type: DataTypes.STRING(255), allowNull: true },
  external_url: { type: DataTypes.STRING(500), allowNull: true },
}, {
  sequelize,
  tableName: 'task_attachments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
});

module.exports = TaskAttachment;
