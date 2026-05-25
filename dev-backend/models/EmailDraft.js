// EmailDraft — 답장 작성 중 (Q Mail M1)
// AutoSaveField 2초 debounce 로 저장. 발송 시 message 로 전환되고 draft delete.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailDraft extends Model {}

EmailDraft.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  thread_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'email_threads', key: 'id' }, onDelete: 'CASCADE' },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  in_reply_to_message_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'email_messages', key: 'id' } },
  account_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'email_accounts', key: 'id' } },
  to_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  cc_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  bcc_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  subject: { type: DataTypes.STRING(500), allowNull: true },
  body_html: { type: DataTypes.TEXT('long'), allowNull: true },
  attachment_file_ids: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
}, {
  sequelize, tableName: 'email_drafts', timestamps: true, underscored: true,
  indexes: [
    { fields: ['user_id', 'updated_at'], name: 'email_drafts_user_time' },
    { fields: ['thread_id'], name: 'email_drafts_thread' },
  ],
});

module.exports = EmailDraft;
