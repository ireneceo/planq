// EphemeralToken — **재시작에도 살아남아야 하는 짧은 수명 상태**.
//
// 왜 생겼나 (2026-09-10, Fable 게이트 지적)
//   OAuth 흐름 세 곳이 각자 메모리 `Map` 을 들고 있었다:
//     oauthPairing.store  (10분) — 앱 로그인 페어링. 재시작하면 진행 중이던 로그인이 끊긴다
//     usedNativeCodes     (2분)  — 일회용 code 재사용 차단 원장. **사라지면 replay 창이 다시 열린다**
//     confirmStash        (5분)  — 외부 연동 확인 토큰. 사라지면 "만료됨" 으로 뜬다
//   배포는 하루에도 여러 번 하고 그때마다 PM2 가 프로세스를 갈아 끼운다. 실제로 2026-09-10 에
//   배포 2회 × 10분 창이 Irene 의 아이폰 로그인 신고와 겹쳤다.
//   그리고 fork 모드라 지금은 1 프로세스지만, **cluster 로 바뀌는 순간** 세 Map 은 프로세스마다
//   달라져 흐름이 항상 깨진다(start 와 claim 이 다른 프로세스에 떨어진다).
//
// 왜 테이블 하나인가
//   셋 다 `키 → 값 + 만료` 라는 같은 모양이다. 각자 테이블을 만들면 정리(sweep)도 세 벌이 된다.
//   `kind` 로 갈라 두면 한 곳에서 쓸고, 새 용도가 생겨도 스키마가 안 는다.
//
// ★ 비밀은 **해시로만** 저장한다 — services/ephemeralStore.js 의 `hashSecret` 참조.
//   ★★ 다만 이 해시를 과대평가하지 말 것 (Fable 2026-09-10 실측):
//      salt 가 `token_key`(=pairId) 라 **DB 를 읽은 사람은 6자리 전수 sha256 으로 1.16초에**
//      평문을 복원한다. 배포 백업은 `.env` 도 같이 담으므로 pepper 를 써도 그 백업엔 무력이다.
//      해시가 막는 것은 **로그 노출·눈대중**까지다. 실제 방패는 **짧은 TTL + 시도 횟수 상한**이고,
//      그래서 attempts 를 원자적으로 셀 수 있는 컬럼으로 둔다(아래).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EphemeralToken extends Model {}

EphemeralToken.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // 용도. 새 용도를 더할 때 ENUM 을 늘린다 — 아무 문자열이나 받으면 무엇이 들었는지 알 수 없다.
  kind: {
    type: DataTypes.ENUM('oauth_pair', 'oauth_used_code', 'oauth_confirm', 'oauth_state'),
    allowNull: false,
  },
  // 조회 키. pairId · jti · confirm token 등. **비밀이 아닌 것만** 여기 온다.
  token_key: { type: DataTypes.STRING(191), allowNull: false },
  // 부속 데이터(uid·해시된 코드 등). 비밀은 반드시 해시해서 넣는다.
  payload: { type: DataTypes.JSON, allowNull: true },
  // ★ 시도 횟수는 payload(JSON) 가 아니라 **컬럼**이다 — 원자 증가(`increment`)가 필요하기 때문.
  //   JSON 안에 두고 읽고-더하고-쓰면 동시 요청에서 증가가 유실된다. 실측(Fable 2026-09-10):
  //   틀린 코드를 **동시에 20회** 보내면 attempts 가 4 에 머물러 5회 상한이 통째로 무력화됐고,
  //   그 뒤 맞는 코드가 통과했다. 6자리 코드의 유일한 방패가 그 카운터다.
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, {
  sequelize,
  tableName: 'ephemeral_tokens',
  timestamps: true,
  underscored: true,
  indexes: [
    // ★ 컬럼 레벨 `unique: true` 를 쓰지 않는다 — sync-database 가 실행할 때마다 인덱스를
    //   새로 쌓아 MySQL 64키 한도에 닿는다(Business.slug·Invoice.idempotency_key 실사고).
    { unique: true, fields: ['kind', 'token_key'], name: 'ephemeral_kind_key_unique' },
    { fields: ['expires_at'], name: 'ephemeral_expires_idx' },
  ],
});

module.exports = EphemeralToken;
