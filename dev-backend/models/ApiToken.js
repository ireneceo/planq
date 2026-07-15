// API 토큰 — 외부 에이전트(MCP 읽기 서버)용 워크스페이스 스코프 토큰 (#D-4).
//   refresh_tokens 패턴: 평문은 발급 시 1회만 노출, DB 엔 sha256 해시만 저장.
//   토큰 = (user_id, business_id) 에 묶임 → MCP 가 getUserScope(user_id, business_id) 로 교환.
//   토큰 소유자 scope 로 전 격리 — 별도 권한 체계 없음. revoked_at/expires_at 로 무효화.
const { Model, DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

class ApiToken extends Model {}

ApiToken.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  name: { type: DataTypes.STRING(120), allowNull: true },      // 사용자 지정 라벨 ("Claude Code" 등)
  token_hash: { type: DataTypes.STRING(255), allowNull: false }, // sha256(평문). 평문은 DB 에 없다
  // 읽기 전용 고정 — 쓰기 스코프는 이 표면에서 절대 부여하지 않는다(D-4 순서 엄수)
  scopes: { type: DataTypes.JSON, allowNull: true, defaultValue: ['read'] },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  expires_at: { type: DataTypes.DATE, allowNull: true },        // null = 무기한 (사용자가 회수로 관리)
  revoked_at: { type: DataTypes.DATE, allowNull: true },        // NOT NULL = 무효
}, {
  sequelize,
  tableName: 'api_tokens',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['token_hash'] },
    { fields: ['user_id', 'business_id'] },
  ],
});

module.exports = ApiToken;
