// EmailAccount — 워크스페이스 단위 IMAP/SMTP 계정 (Q Mail M1)
// 비밀번호는 AES-256-GCM 암호화 (services/encryption.js).
// admin only — middleware/menu_permission.js requireMenu('qmail', 'admin')
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailAccount extends Model {}

EmailAccount.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  email: { type: DataTypes.STRING(255), allowNull: false },
  display_name: { type: DataTypes.STRING(100), allowNull: true },
  // IMAP
  imap_host: { type: DataTypes.STRING(200), allowNull: false },
  imap_port: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 993 },
  imap_username: { type: DataTypes.STRING(255), allowNull: false },
  imap_password_encrypted: { type: DataTypes.TEXT, allowNull: false },
  imap_tls: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  imap_folder: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'INBOX' },
  imap_last_uid: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // SMTP (account 단위 — 없으면 businesses.smtp_config 또는 PlanQ default fallback)
  smtp_host: { type: DataTypes.STRING(200), allowNull: true },
  smtp_port: { type: DataTypes.INTEGER, allowNull: true, defaultValue: 587 },
  smtp_username: { type: DataTypes.STRING(255), allowNull: true },
  smtp_password_encrypted: { type: DataTypes.TEXT, allowNull: true },
  smtp_tls: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true },
  // 상태
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  last_sync_at: { type: DataTypes.DATE, allowNull: true },
  last_sync_error: { type: DataTypes.TEXT, allowNull: true },
  fail_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, tableName: 'email_accounts', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'is_active'], name: 'email_accounts_biz_active' },
    { unique: true, fields: ['business_id', 'email'], name: 'email_accounts_biz_email_unique' },
  ],
});

module.exports = EmailAccount;
