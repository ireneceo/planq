// ExternalConnection — Phase 1 통합 외부 연동 모델 (2026-05-26)
//
// 모든 외부 자원 (Google Calendar/Drive/Gmail, Microsoft, Apple 등) 통합.
// owner_scope (workspace | user) 명시 — 워크스페이스 공유 vs 본인 자원 구분.
//
// 옛 모델 (business_cloud_tokens / email_accounts) 와 backward-compat:
//   - 옛 모델 그대로 작동 (Phase 1~5 동안)
//   - 신규 코드는 external_connections 사용
//   - Phase 6 에서 데이터 이전, Phase 7 에서 옛 모델 DROP
//
// docs/EXTERNAL_INTEGRATIONS_DESIGN.md §2 참조
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ExternalConnection extends Model {}

ExternalConnection.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // 핵심 — owner_scope 명시
  owner_scope: { type: DataTypes.ENUM('workspace', 'user'), allowNull: false },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  // provider
  provider: {
    type: DataTypes.ENUM(
      'google_calendar', 'google_drive', 'gmail',
      'microsoft_calendar', 'microsoft_drive', 'outlook',
      'apple_calendar'
    ),
    allowNull: false,
  },
  // 인증
  auth_type: {
    type: DataTypes.ENUM('oauth', 'password', 'app_password'),
    allowNull: false,
  },
  access_token_encrypted: { type: DataTypes.TEXT, allowNull: true },
  refresh_token_encrypted: { type: DataTypes.TEXT, allowNull: true },
  password_encrypted: { type: DataTypes.TEXT, allowNull: true },
  expires_at: { type: DataTypes.DATE, allowNull: true },
  scope: { type: DataTypes.TEXT, allowNull: true },
  // 외부 계정 식별
  account_email: { type: DataTypes.STRING(255), allowNull: false },
  account_external_id: { type: DataTypes.STRING(255), allowNull: true },
  account_name: { type: DataTypes.STRING(100), allowNull: true },
  // IMAP/SMTP (mail provider, auth_type='password' 또는 보조)
  imap_host: { type: DataTypes.STRING(200), allowNull: true },
  imap_port: { type: DataTypes.INTEGER, allowNull: true },
  imap_tls: { type: DataTypes.BOOLEAN, defaultValue: true },
  imap_folder: { type: DataTypes.STRING(50), defaultValue: 'INBOX' },
  imap_last_uid: { type: DataTypes.INTEGER, defaultValue: 0 },
  smtp_host: { type: DataTypes.STRING(200), allowNull: true },
  smtp_port: { type: DataTypes.INTEGER, allowNull: true },
  smtp_tls: { type: DataTypes.BOOLEAN, defaultValue: true },
  // 상태
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  last_sync_at: { type: DataTypes.DATE, allowNull: true },
  last_sync_error: { type: DataTypes.TEXT, allowNull: true },
  fail_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // provider-specific
  metadata: { type: DataTypes.JSON, allowNull: true },
}, {
  sequelize, tableName: 'external_connections', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'owner_scope', 'provider', 'is_active'], name: 'ext_conn_biz_scope_provider' },
    { fields: ['user_id', 'provider', 'is_active'], name: 'ext_conn_user_provider' },
    {
      unique: true,
      fields: ['business_id', 'owner_scope', 'user_id', 'provider', 'account_email'],
      name: 'ext_conn_unique',
    },
  ],
});

// hook — owner_scope='user' 시 user_id 필수 검증
ExternalConnection.addHook('beforeSave', (conn) => {
  if (conn.owner_scope === 'user' && !conn.user_id) {
    throw new Error('user_id required for owner_scope=user');
  }
});

module.exports = ExternalConnection;
