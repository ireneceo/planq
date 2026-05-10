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
  // 화상 미팅 (Phase D)
  meeting_url: { type: DataTypes.STRING(500), allowNull: true },
  meeting_provider: {
    type: DataTypes.ENUM('daily', 'manual'),
    allowNull: true,
  },
  // 공용(business) / 개인(personal) — personal 은 created_by 본인만 조회
  visibility: {
    type: DataTypes.ENUM('personal', 'business'),
    allowNull: false,
    defaultValue: 'business',
  },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  // 공유 링크 (사이클 N+4 — 통합 공유 시스템)
  share_token: { type: DataTypes.STRING(64), allowNull: true, unique: true },
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
  ],
});

module.exports = CalendarEvent;
