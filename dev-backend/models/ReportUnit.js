// ReportUnit — 책임 기반 단위 보고서 (R2, 마스터설계 §5.3)
//
// 멤버/프로젝트/부서 단위 보고서. 자동 초안(auto_snapshot) → 책임자 수정(edited_overrides·narrative)
//   → 확정(confirmed). 확정본이 통합보고서로 롤업(R3). 경영 보고서(models/Report.js)와 별개 개념.
//
// v1: scope = project / department (멤버는 기존 WeeklyReview 유지). weekly + monthly.
// 책임자: project → projects.owner_user_id / department → departments.lead_user_id.
//
// auto_snapshot JSON: { schema_version, generated_at, period, kpi, highlights, risks, next_week, ... }
// edited_overrides JSON: 책임자가 보정한 필드만 (auto 위에 병합 — merge 우선).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ReportUnit extends Model {}

ReportUnit.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'businesses', key: 'id' },
  },
  scope: {
    type: DataTypes.ENUM('member', 'project', 'department'),
    allowNull: false,
  },
  scope_ref_id: {
    type: DataTypes.INTEGER, allowNull: false,
    comment: 'user_id | project_id | department_id',
  },
  period_type: {
    type: DataTypes.ENUM('weekly', 'monthly'),
    allowNull: false,
  },
  period_start: {
    type: DataTypes.DATEONLY, allowNull: false,
    comment: '주=월요일 / 월=1일 (ws_tz 기준)',
  },
  status: {
    type: DataTypes.ENUM('draft', 'confirmed'),
    allowNull: false, defaultValue: 'draft',
  },
  auto_snapshot: {
    type: DataTypes.JSON, allowNull: true,
    comment: '자동 초안 (live 집계 결과)',
  },
  edited_overrides: {
    type: DataTypes.JSON, allowNull: true,
    comment: '책임자 수정분 (auto 위에 병합 우선)',
  },
  narrative: {
    type: DataTypes.TEXT, allowNull: true,
    comment: '책임자 서술',
  },
  confirmed_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  confirmed_at: { type: DataTypes.DATE, allowNull: true },
  finalized_by: {
    type: DataTypes.ENUM('manual', 'auto'),
    allowNull: true,
    comment: '확정 주체 — manual(책임자 클릭) / auto(cron 마감 자동확정)',
  },
}, {
  sequelize,
  tableName: 'report_units',
  timestamps: true,
  underscored: true,
  indexes: [
    // 단위 × 주기 × 기간 = 1 row 강제
    { fields: ['business_id', 'scope', 'scope_ref_id', 'period_type', 'period_start'], unique: true, name: 'uk_report_unit' },
    { fields: ['business_id', 'period_type', 'period_start'], name: 'idx_report_unit_period' },
  ],
});

module.exports = ReportUnit;
