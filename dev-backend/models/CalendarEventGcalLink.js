// CalendarEventGcalLink — PlanQ 일정 ↔ 구글 캘린더 이벤트 링크 (2026-07-27)
//
// 왜 컬럼이 아니라 테이블인가:
//   기존 calendar_events.gcal_event_id 는 **목적지가 하나**(워크스페이스 캘린더)라는 전제였다.
//   개인 캘린더 쓰기가 열리면서 한 일정이 팀 캘린더 + 개인 캘린더 N곳에 동시에 존재할 수 있게 됐다.
//   기존 컬럼은 workspace 링크로 그대로 두고(회귀 0), 신규 목적지를 여기에 쌓는다.
//
// 링크가 있어야 "체크를 끄면 구글에서도 지워진다" 가 성립한다 — 어느 이벤트를 지울지 알아야 하므로.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class CalendarEventGcalLink extends Model {}

CalendarEventGcalLink.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  event_id: { type: DataTypes.BIGINT, allowNull: false },
  target: { type: DataTypes.ENUM('workspace', 'personal'), allowNull: false },
  // personal 일 때만 채워진다. workspace 는 워크스페이스당 하나뿐이라 NULL.
  connection_id: { type: DataTypes.INTEGER, allowNull: true },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  gcal_event_id: { type: DataTypes.STRING(255), allowNull: false },
  gcal_calendar_id: { type: DataTypes.STRING(255), allowNull: true, defaultValue: 'primary' },
}, {
  sequelize,
  tableName: 'calendar_event_gcal_links',
  timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['event_id', 'target', 'connection_id'], name: 'uniq_event_target_conn' },
    { fields: ['event_id'], name: 'idx_event' },
    { fields: ['connection_id'], name: 'idx_conn' },
  ],
});

module.exports = CalendarEventGcalLink;
