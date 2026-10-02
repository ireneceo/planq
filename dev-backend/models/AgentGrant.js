// AgentGrant — 한 사람이 한 워크스페이스에 대해 외부 AI 앱에 준 **연결(동의)** (#439).
//
//   토큰 = 이 grant 의 (user × **하나의** workspace × scopes). 다른 워크스페이스는 연결을 하나 더 한다.
//   access 토큰(JWT, 1시간)은 매 호출 이 행을 다시 읽는다 — revoked_at 이 찍히면 다음 호출부터 닫힌다.
//   refresh 는 평문을 두지 않는다(sha256). 회전할 때 직전 해시를 남겨 **재사용을 감지**한다(재사용 = 탈취 의심 → 전체 revoke).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AgentGrant extends Model {}

AgentGrant.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  client_id: { type: DataTypes.STRING(64), allowNull: false },
  provider: { type: DataTypes.STRING(20), allowNull: true },
  scopes: { type: DataTypes.JSON, allowNull: false },
  refresh_token_hash: { type: DataTypes.STRING(64), allowNull: true },
  prev_refresh_token_hash: { type: DataTypes.STRING(64), allowNull: true },
  refresh_expires_at: { type: DataTypes.DATE, allowNull: true },
  activated_at: { type: DataTypes.DATE, allowNull: true },                 // 코드 교환이 끝난 순간 — 그 전엔 토큰이 없다
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_reason: {
    type: DataTypes.ENUM('user', 'client', 'reuse_detected', 'membership_lost', 'admin'),
    allowNull: true,
  },
}, {
  sequelize, tableName: 'agent_grants', timestamps: true, underscored: true,
  indexes: [
    { fields: ['user_id', 'business_id'] },
    { fields: ['refresh_token_hash'] },
    { fields: ['prev_refresh_token_hash'] },
  ],
});

module.exports = AgentGrant;
