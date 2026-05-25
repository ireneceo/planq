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
  // 인증 방식 — N+70 Task C/D 통합
  //   password: IMAP/SMTP 비밀번호 직접 (앱 비밀번호) — 옛 방식
  //   google_oauth: Gmail API + XOAUTH2 — OAuth 2.0
  //   microsoft_oauth: Microsoft Graph + XOAUTH2 — 향후 D
  auth_type: {
    type: DataTypes.ENUM('password', 'google_oauth', 'microsoft_oauth'),
    allowNull: false, defaultValue: 'password',
  },
  // OAuth 토큰 (auth_type !== 'password' 일 때)
  oauth_access_token_encrypted: { type: DataTypes.TEXT, allowNull: true },
  oauth_refresh_token_encrypted: { type: DataTypes.TEXT, allowNull: true },
  oauth_expires_at: { type: DataTypes.DATE, allowNull: true },
  oauth_scope: { type: DataTypes.TEXT, allowNull: true },
  // IMAP (auth_type='password' 시 필수, oauth 시 host/port 만 사용)
  imap_host: { type: DataTypes.STRING(200), allowNull: false },
  imap_port: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 993 },
  imap_username: { type: DataTypes.STRING(255), allowNull: false },
  imap_password_encrypted: { type: DataTypes.TEXT, allowNull: true },  // OAuth 시 null
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
