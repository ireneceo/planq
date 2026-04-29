const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class MessageAttachment extends Model {}

MessageAttachment.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  message_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'messages', key: 'id' }
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  storage_provider: { type: DataTypes.ENUM('planq', 'gdrive'), allowNull: false, defaultValue: 'planq' },
  external_id: { type: DataTypes.STRING(255), allowNull: true },
  external_url: { type: DataTypes.STRING(500), allowNull: true },
  // 사이클 O4 — 워크스페이스 파일에서 link 한 경우의 원본 file_id (dedup, "기존 파일 첨부" 흐름)
  file_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'files', key: 'id' },
  }
}, {
  sequelize,
  tableName: 'message_attachments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true
});

module.exports = MessageAttachment;
