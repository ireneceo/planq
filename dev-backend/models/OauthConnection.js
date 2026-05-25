// OauthConnection — N+70 Task 62 외부 OAuth provider 연결 (Google / Microsoft)
//
// 한 사용자는 같은 provider 에 1개 연결만 (UNIQUE user_id+provider).
// 한 provider 의 subject (Google sub, Microsoft oid) 는 1개 사용자만 (UNIQUE provider+subject).
//
// 표준 OAuth 흐름:
// 1. OAuth callback subject 매칭 → 그 사용자로 로그인 (가장 빠름)
// 2. email 매칭 (primary or secondary_email_verified) → 연결 확인 페이지 → 사용자 동의 후 연결
// 3. 둘 다 없음 → 신규 가입 (자동 워크스페이스)
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class OauthConnection extends Model {}

OauthConnection.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  provider: { type: DataTypes.ENUM('google', 'microsoft'), allowNull: false },
  subject: { type: DataTypes.STRING(255), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: true },
  display_name: { type: DataTypes.STRING(100), allowNull: true },
  picture: { type: DataTypes.STRING(500), allowNull: true },
  connected_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'oauth_connections', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['provider', 'subject'], name: 'oauth_subject_unique' },
    { unique: true, fields: ['user_id', 'provider'], name: 'oauth_user_provider_unique' },
    { fields: ['email'], name: 'oauth_email_idx' },
  ],
});

module.exports = OauthConnection;
