const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class CalendarEvent extends Model {}

CalendarEvent.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.BIGINT, allowNull: true },
  title: { type: DataTypes.STRING(300), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  location: { type: DataTypes.STRING(300), allowNull: true },
  start_at: { type: DataTypes.DATE, allowNull: false },
  end_at: { type: DataTypes.DATE, allowNull: false },
  all_day: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // 개인일정 팔레트/분류
  category: {
    type: DataTypes.ENUM('personal', 'work', 'meeting', 'deadline', 'other'),
    allowNull: false,
    defaultValue: 'work',
  },
  // hex #RRGGBB — null 이면 프로젝트 색 상속 또는 카테고리 팔레트
  color: { type: DataTypes.STRING(20), allowNull: true },
  // RFC5545 RRULE (Phase C)
  rrule: { type: DataTypes.STRING(500), allowNull: true },
  // 화상 미팅 (Phase D — N+13 사이클에 Daily.co 폐지, Google Meet 채택)
  // ENUM 에 'daily' 잔존 = 옛 row 호환 (운영에 옛 daily row 가 있을 경우).
  //   새 row 는 'google_meet' / 'manual' 만 작성됨.
  //   마이그레이션 후 잔존 'daily' row 가 0건이면 다음 사이클에 ENUM 정리.
  meeting_url: { type: DataTypes.STRING(500), allowNull: true },
  meeting_provider: {
    type: DataTypes.ENUM('google_meet', 'manual', 'daily'),
    allowNull: true,
  },
  // N+63 — Google Calendar event id. PlanQ → Google Calendar 단방향 sync.
  // Meet 자동 발급 시 생성되는 Google Calendar event 의 id 저장 →
  // 이후 PUT (시간/제목/설명 변경) / DELETE 시 같은 google event 를 update/delete 하여 sync.
  // null = PlanQ only (Meet 발급 안 한 일반 이벤트).
  gcal_event_id: { type: DataTypes.STRING(100), allowNull: true },
  // N+63 — 임박 알림 (start_at - reminder_minutes 시점에 attendees 에게 알림 발송).
  // null = 알림 비활성. 5/10/15/30/60 분 등. EventDrawer 셀렉트로 사용자 설정.
  reminder_minutes: { type: DataTypes.INTEGER, allowNull: true },
  // 중복 발송 방지 — cron 이 한 이벤트당 한 번만 발송. null = 아직 안 보냄.
  reminder_sent_at: { type: DataTypes.DATE, allowNull: true },
  // 공용(business) / 개인(personal) — personal 은 created_by 본인만 조회
  visibility: {
    type: DataTypes.ENUM('personal', 'business'),
    allowNull: false,
    defaultValue: 'business',
  },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  // 공유 링크 (사이클 N+4 — 통합 공유 시스템)
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  share_password_hash: { type: DataTypes.STRING(255), allowNull: true },
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'calendar_events',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'start_at'] },
    { fields: ['business_id', 'project_id'] },
    { fields: ['created_by'] },
    { unique: true, fields: ['share_token'], name: 'calendar_events_share_token_unique' },
  ],
});

module.exports = CalendarEvent;
