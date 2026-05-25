// EmailAttachment — 메시지 첨부 (Q Mail M1)
// File 모델 통합 — file_id 가 있으면 PlanQ File 인박스에 자동 저장됨.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailAttachment extends Model {}

EmailAttachment.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  message_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'email_messages', key: 'id' }, onDelete: 'CASCADE' },
  file_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'files', key: 'id' } },
  filename: { type: DataTypes.STRING(255), allowNull: false },
  mime_type: { type: DataTypes.STRING(100), allowNull: true },
  size_bytes: { type: DataTypes.BIGINT, allowNull: true },
  content_id: { type: DataTypes.STRING(100), allowNull: true },     // inline image cid:
  is_inline: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  sequelize, tableName: 'email_attachments', timestamps: true, underscored: true,
  indexes: [
    { fields: ['message_id'], name: 'email_attachments_message' },
  ],
});

module.exports = EmailAttachment;
