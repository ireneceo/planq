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
  token_hash: { type: DataTypes.STRING(255), allowNull: false },
  // 디바이스 식별 — 사용자에게 "이 디바이스" 표시 + 도난 추적
  user_agent: { type: DataTypes.STRING(500), allowNull: true },
  ip_address: { type: DataTypes.STRING(64), allowNull: true },
  // 클라이언트 종류 — pwa/ios/android(모바일 앱)는 365일 long-lived, web(브라우저)는 30일.
  // refresh 시 옛 row 의 값 그대로 따라가 같은 정책으로 갱신 (sliding renewal).
  client_kind: {
    type: DataTypes.ENUM('pwa', 'web', 'ios', 'android'),
    allowNull: false, defaultValue: 'web',
  },
  // 만료 시각 (login 시점 + TTL by client_kind). 검사 시 NOW() 와 비교.
  expires_at: { type: DataTypes.DATE, allowNull: false },
  // revoke 시각 — logout / rotation / 도난 의심. NULL 이면 active.
  revoked_at: { type: DataTypes.DATE, allowNull: true },
  revoked_reason: {
    // superseded_undelivered — #244. 회전으로 만들어졌지만 **클라이언트에 도달하지 못한** 후속.
    //   (옛 토큰이 다시 왔고 이 후속은 한 번도 안 쓰였다 = Set-Cookie 유실) 폐기하고 새로 발급한다.
    type: DataTypes.ENUM('rotated', 'logout', 'reuse_detected', 'admin', 'expired', 'superseded_undelivered'),
    allowNull: true,
  },
  // rotate 시 옛 row 의 후속 row id. 옛 토큰으로 refresh 호출 (다중 탭 race) 시
  // 후속 row 가 살아있고 revoked_at 이 grace window 이내면 정상 race 로 간주.
  replaced_by_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'refresh_tokens', key: 'id' },
  },
  // #244 (D2) — grace 창 안에서 stale 쿠키를 자가치유하며 발급한 새 row 의 id.
  //
  //   왜 필요한가: 회전 응답의 Set-Cookie 가 유실되면(응답 중단·탭 종료 등) 서버는 이미 회전을
  //   커밋했는데 브라우저는 옛 쿠키를 그대로 들고 있다. 서버는 raw 토큰을 해시로만 보관하므로
  //   후속 토큰을 다시 내려줄 수 없다 → 새 토큰을 발급해 쿠키를 고쳐 주는 것이 유일한 치유법.
  //
  //   왜 캡이 필요한가: 무제한 허용하면 도난된 stale 쿠키 하나로 365일짜리 새 체인을 몇 번이고
  //   분기시킬 수 있다. stale row 당 재발급을 **1회로 제한**한다. 두 번째 호출부터는 종전대로
  //   access token 만 발급(쿠키 미갱신). 정상 사용자가 캡에 걸리는 경우는 응답 유실이 2연속으로
  //   난 희귀 케이스뿐이고, 그때도 현행 동작으로 폴백하므로 회귀가 아니다.
  //
  //   감사: 이 컬럼이 곧 감사 흔적이다 — 어떤 row 가 grace 재발급으로 태어났는지는
  //   `SELECT * FROM refresh_tokens WHERE grace_successor_id IS NOT NULL` 로 역추적된다.
  //   FK/인덱스는 의도적으로 걸지 않는다 (sync alter 의 64키 한도 회피 — 조회는 극소량).
  grace_successor_id: { type: DataTypes.INTEGER, allowNull: true },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  // #244 — 이 토큰이 **클라이언트에 실제로 도달했는지**의 증거.
  //   refresh 로 처음 제시된 시점에만 기록된다(생성 시점이 아니다).
  //   ★ last_used_at 은 createRefreshTokenRow 가 생성 시 NOW 로 채우므로
  //     "만들어졌다" 와 "사용됐다" 를 구분하지 못한다 — 그래서 별도 컬럼이다.
  //   NULL = 아직 한 번도 안 쓰임(= Set-Cookie 가 착지하지 못했을 수 있음).
  first_used_at: { type: DataTypes.DATE, allowNull: true },
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
