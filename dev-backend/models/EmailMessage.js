// EmailMessage — 스레드 안 개별 메시지 (Q Mail M1)
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailMessage extends Model {}

EmailMessage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  thread_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'email_threads', key: 'id' }, onDelete: 'CASCADE' },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  direction: { type: DataTypes.ENUM('inbound', 'outbound'), allowNull: false },
  // IMAP / SMTP 식별자 (RFC 822)
  message_id: { type: DataTypes.STRING(500), allowNull: false },
  in_reply_to: { type: DataTypes.STRING(500), allowNull: true },
  references_chain: { type: DataTypes.TEXT, allowNull: true },
  imap_uid: { type: DataTypes.INTEGER, allowNull: true },
  // From/To/Cc/Bcc
  from_email: { type: DataTypes.STRING(255), allowNull: true },
  from_name: { type: DataTypes.STRING(100), allowNull: true },
  to_emails: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  cc_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  bcc_emails: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  // 본문
  subject: { type: DataTypes.STRING(500), allowNull: true },
  body_html: { type: DataTypes.TEXT('long'), allowNull: true },
  body_text: { type: DataTypes.TEXT('long'), allowNull: true },
  // 발신
  sent_by_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 상태
  delivery_status: {
    type: DataTypes.ENUM('pending', 'sent', 'delivered', 'bounced', 'failed'),
    allowNull: false, defaultValue: 'sent',
  },
  delivery_error: { type: DataTypes.TEXT, allowNull: true },
  // AI 분석 (백그라운드 채움)
  ai_intent: { type: DataTypes.STRING(50), allowNull: true },
  ai_summary: { type: DataTypes.STRING(500), allowNull: true },
  ai_processed_at: { type: DataTypes.DATE, allowNull: true },
  // 메타
  sent_at: { type: DataTypes.DATE, allowNull: false },
  // M4 FAQ 클러스터링 — inbound 질문 임베딩 캐시 (text-embedding-3-small 1536d BLOB).
  // 메시지당 1회만 임베딩 → cron 재실행 시 재사용 (AI 최소 사용).
  faq_embedding: { type: DataTypes.BLOB('medium'), allowNull: true },
}, {
  sequelize, tableName: 'email_messages', timestamps: true, underscored: true,
  indexes: [
    { fields: ['thread_id', 'sent_at'], name: 'email_messages_thread_time' },
    { fields: ['business_id', 'direction', 'sent_at'], name: 'email_messages_biz_dir_time' },
    { fields: ['message_id'], name: 'email_messages_message_id' },
  ],
});

module.exports = EmailMessage;
