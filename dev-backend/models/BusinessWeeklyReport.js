// BusinessWeeklyReport — 워크스페이스 통합 주간 보고서 (사이클 N+18)
//
// 개인 WeeklyReview 와 별도 — 워크스페이스 × 주차 = 1 row.
// 담당자 fan-out 없이 워크스페이스 단위 박제 (cron 일 23:59 ws_tz + 수동 owner/admin).
//
// snapshot_data JSON 스키마 v1:
//   { schema_version, generated_at, period, kpi, highlights, risks, blockers,
//     issues, next_week_focus, portfolio, member_utilization, team_highlights,
//     decisions_required }

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessWeeklyReport extends Model {}

BusinessWeeklyReport.init({
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
    defaultValue: 'auto',
  },
  finalized_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    comment: 'manual 박제 시 클릭한 owner/admin user_id',
  },
  snapshot_data: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '워크스페이스 통합 보고서 JSON (스키마 v1)',
  },
  executive_summary: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'owner/admin 작성 한 줄 헤드라인 (선택)',
  },
  retro_note: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '워크스페이스 회고 (선택)',
  },
}, {
  sequelize,
  tableName: 'business_weekly_reports',
  timestamps: true,
  underscored: true,
  indexes: [
    // 워크스페이스 × 주차 = 1 row 강제
    { fields: ['business_id', 'week_start'], unique: true, name: 'uk_biz_week_report' },
    // 리스트 정렬 (최근 박제 순)
    { fields: ['business_id', 'finalized_at'], name: 'idx_biz_finalized' },
  ],
});

module.exports = BusinessWeeklyReport;
