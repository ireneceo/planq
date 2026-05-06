// WeeklyReview — 주간 보고 박제 데이터 (Phase 1)
//
// "이번 주 내 업무" 탭의 특정 시점 스냅샷을 JSON으로 보존.
// 수동(금요일 마무리) 또는 자동(일요일 23:59 cron) 트리거.
// snapshot_data 는 immutable — 박제 후 원본 task 변경 무관.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WeeklyReview extends Model {}

WeeklyReview.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  week_start: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'ws_tz 기준 월요일',
  },
  week_end: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'ws_tz 기준 일요일',
  },
  finalized_at: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: '박제 시점',
  },
  finalized_by: {
    type: DataTypes.ENUM('manual', 'auto'),
    allowNull: false,
    defaultValue: 'manual',
  },
  snapshot_data: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '{ tasks: [...], summary: {...}, burndown: [...] }',
  },
  retro_note: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '한 주 메모 (회고)',
  },
}, {
  sequelize,
  tableName: 'weekly_reviews',
  timestamps: true,
  underscored: true,
  indexes: [
    // 사용자별 워크스페이스별 주차별 unique
    { fields: ['user_id', 'business_id', 'week_start'], unique: true, name: 'uk_user_biz_week' },
    // 워크스페이스 + 주차 — 향후 팀 보드용
    { fields: ['business_id', 'week_start'], name: 'idx_biz_week' },
    // 사용자별 목록
    { fields: ['business_id', 'user_id', 'week_start'], name: 'idx_biz_user_week' },
  ],
});

module.exports = WeeklyReview;
