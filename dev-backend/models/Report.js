const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 월간/분기/연간 경영 보고서 스냅샷 — 리포트 §5
// cron 매월 1일 자동 생성. 보고서 = 시점 고정 문서 (리포트 = 실시간 탐색 과 구분).
class Report extends Model {}

Report.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  kind: {
    type: DataTypes.ENUM('monthly', 'quarterly', 'yearly', 'adhoc'),
    allowNull: false,
  },
  period_start: { type: DataTypes.DATEONLY, allowNull: false },
  period_end: { type: DataTypes.DATEONLY, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: true },
  summary: { type: DataTypes.TEXT, allowNull: true },
  // 스냅샷 수치 (차트 생성용 raw 데이터)
  data: { type: DataTypes.JSON, allowNull: true },
  // 룰 + LLM 산출 진단·처방
  insights: { type: DataTypes.JSON, allowNull: true },
  generated_at: { type: DataTypes.DATE, allowNull: true },
  // cron 자동 생성 시 NULL, 수동 생성 시 사용자 id
  generated_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  pdf_url: { type: DataTypes.STRING(500), allowNull: true },
  // 외부 공유용 (인증 불필요 링크)
  share_token: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  // 오너가 내러티브로 달 수 있는 주석
  notes: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  tableName: 'reports',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['business_id', 'period_start'] }],
});

module.exports = Report;
