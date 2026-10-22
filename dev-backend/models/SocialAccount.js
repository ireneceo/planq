// 인사이트 글 SNS 발송 — 연결된 채널 계정 (플랫폼 공통, business_id 없음 · platform_admin 전용).
//   설계 docs/SNS_PUBLISH_DESIGN.md §1. 단계 1 에는 연결 문이 없어 비어 있다(연결은 단계 2 OAuth).
//   토큰은 *_enc 암호문 — 전역 toJSON 이 내린다. 보유 여부는 인스턴스에서 읽어 서버가 token_set 으로 만든다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

const SOCIAL_PROVIDERS = ['linkedin', 'facebook', 'instagram', 'threads', 'youtube', 'naver', 'kakao'];

class SocialAccount extends Model {}

SocialAccount.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  provider: { type: DataTypes.ENUM(...SOCIAL_PROVIDERS), allowNull: false },
  external_id: { type: DataTypes.STRING(120), allowNull: false },
  display_name: { type: DataTypes.STRING(200), allowNull: true },
  avatar_url: { type: DataTypes.STRING(500), allowNull: true },
  access_token_enc: { type: DataTypes.TEXT, allowNull: true },
  refresh_token_enc: { type: DataTypes.TEXT, allowNull: true },
  token_expires_at: { type: DataTypes.DATE, allowNull: true },
  status: { type: DataTypes.ENUM('active', 'expired', 'revoked', 'error'), allowNull: false, defaultValue: 'active' },
  last_error: { type: DataTypes.STRING(500), allowNull: true },
  connected_by: { type: DataTypes.INTEGER, allowNull: true },
  connected_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'social_accounts',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['provider', 'external_id'], name: 'social_accounts_provider_external' }],
});

SocialAccount.PROVIDERS = SOCIAL_PROVIDERS;
module.exports = SocialAccount;
