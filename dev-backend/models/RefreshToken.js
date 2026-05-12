// RefreshToken — 다중 디바이스 세션 지원.
//
// 30년차 시각:
//   - 기존: users.refresh_token 단일 컬럼 → 한 user 가 여러 디바이스 사용 시 마지막 발급만 valid.
//     다른 디바이스의 cookie 는 hash 불일치 → 401 → 강제 logout. Slack/Google 표준 위반.
//   - 신규: refresh_tokens 테이블 — device 별 row. login 시 insert, refresh 시 rotate (revoke 옛 row +
//     insert 새 row), logout 시 그 row 만 revoke.
//
// rotation 정책 (RFC 6749 권장):
//   - refresh 호출 → 옛 row revoked_at = NOW() + 새 row insert + 새 token cookie 발송
//   - 같은 row 재사용 시도 (revoked_at 있는 token) → 도난 의심 → 같은 user 의 모든 row revoke (전체 logout)
//
// 만료/정리:
//   - expires_at = login 시점 + 7d
//   - revoked_at NOT NULL OR expires_at < NOW() = invalid
//   - 주기적 cleanup cron (별도) — 30일 지난 row delete

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class RefreshToken extends Model {}

RefreshToken.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  // SHA-256 hash of raw token. raw token 은 cookie 만, DB 에 평문 저장 X.
  token_hash: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  // 디바이스 식별 — 사용자에게 "이 디바이스" 표시 + 도난 추적
  user_agent: { type: DataTypes.STRING(500), allowNull: true },
  ip_address: { type: DataTypes.STRING(64), allowNull: true },
  // 클라이언트 종류 — pwa(모바일 앱)는 365일 long-lived, web(브라우저)는 30일.
  // refresh 시 옛 row 의 값 그대로 따라가 같은 정책으로 갱신 (sliding renewal).
  client_kind: {
    type: DataTypes.ENUM('pwa', 'web'),
    allowNull: false, defaultValue: 'web',
  },
  // 만료 시각 (login 시점 + TTL by client_kind). 검사 시 NOW() 와 비교.
  expires_at: { type: DataTypes.DATE, allowNull: false },
  // revoke 시각 — logout / rotation / 도난 의심. NULL 이면 active.
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_reason: {
    type: DataTypes.ENUM('rotated', 'logout', 'reuse_detected', 'admin', 'expired'),
    allowNull: true,
  },
  // rotate 시 옛 row 의 후속 row id. 옛 토큰으로 refresh 호출 (다중 탭 race) 시
  // 후속 row 가 살아있고 revoked_at 이 grace window 이내면 정상 race 로 간주.
  replaced_by_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'refresh_tokens', key: 'id' },
  },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'refresh_tokens',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['token_hash'], unique: true },
    { fields: ['expires_at'] },
  ],
});

module.exports = RefreshToken;
