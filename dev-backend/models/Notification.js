// N+63 — 인앱 알림 feed (Activity Feed).
// 확인 필요 (Action Queue, dashboard/todo) 와 분리. 본질이 다름.
//   확인 필요: 사용자 액션 필수 (ack/confirm/approve/결제). 처리 후 list 에서 빠짐.
//   알림 feed: 정보 통지 (댓글/멘션/일정 임박/관리자 가입·결제). 읽음만 마킹, 영구 보관.
//
// notify() helper (routes/notifications.js) 의 inbox channel 통과 시 Notification.create() 호출.
// NotificationPref event_kind × channel='inbox' 토글로 사용자가 받을 종류 선택 (기본 ON).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Notification extends Model {}

Notification.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  business_id: { type: DataTypes.INTEGER, allowNull: true },
  event_kind: {
    // NotificationPref 의 ENUM 과 동일 — 신규 종류 추가 시 양쪽 같이 갱신.
    // N+74-B — 'share_expiry' 추가 (외부 공유 링크 만료 임박 알림)
    type: DataTypes.ENUM(
      'signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite',
      'message', 'mention', 'comment_mention', 'share_expiry',
      'inquiry', 'signup', 'payment', 'subscription', 'trial', 'feedback',
    ),
    allowNull: false,
  },
  title: { type: DataTypes.STRING(300), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: true },
  link: { type: DataTypes.STRING(500), allowNull: true },
  cta_label: { type: DataTypes.STRING(50), allowNull: true },
  // 액션 한 사람 (null = 시스템 발송)
  actor_user_id: { type: DataTypes.INTEGER, allowNull: true },
  // 관련 자원 — 클릭 시 컨텍스트 추적
  entity_type: { type: DataTypes.STRING(50), allowNull: true },
  entity_id: { type: DataTypes.BIGINT, allowNull: true },
  // 읽음 시점 (null = 미읽음)
  read_at: { type: DataTypes.DATE, allowNull: true },
  // 미읽음 이메일 에스컬레이션 발송 시점 (null = 아직 안 보냄).
  //   push 가 OS/브라우저/푸시중계 구간에서 silent drop 되어도 미팅·중요 알림을 놓치지 않게 하는 안전망.
  //   unreadEscalationCron 이 일정 시간(기본 5분) 미읽음 알림을 이메일로 1회 발송 후 이 컬럼 마킹.
  email_escalated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'notifications',
  timestamps: true,
  underscored: true,
  indexes: [
    // 미읽음 + 최신 정렬 — list/count 쿼리 핵심
    { fields: ['user_id', 'read_at', 'created_at'], name: 'idx_user_read' },
    // 워크스페이스 컨텍스트별 (사용자가 특정 ws 만 필터링 시)
    { fields: ['user_id', 'business_id', 'created_at'], name: 'idx_user_biz_created' },
  ],
});

module.exports = Notification;
