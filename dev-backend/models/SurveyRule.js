// 설문 자동 규칙(Phase 2 에서 읽는다 — Phase 1 은 표만 둔다). 설계 docs/SURVEY_V2_DESIGN.md §3.1
//   send_mode 기본 'review'(확인 후 발송) — 'auto' 는 대표·admin 만(2026-10-12 Irene «권고대로»).
//   enabled_at 이전 사건은 세지 않는다(켠 날 지난 1년치에 메일이 쏟아지지 않게).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SurveyRule extends Model {}

SurveyRule.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  q_record_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'q_records', key: 'id' } },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  trigger: { type: DataTypes.ENUM('project_closed', 'client_joined', 'schedule'), allowNull: false },
  delay_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
  schedule_every: { type: DataTypes.ENUM('monthly', 'quarterly', 'half_yearly', 'yearly'), allowNull: true },
  audience: { type: DataTypes.ENUM('subject', 'active_clients', 'clients_with_active_project'), allowNull: false, defaultValue: 'subject' },
  send_mode: { type: DataTypes.ENUM('review', 'auto'), allowNull: false, defaultValue: 'review' },
  min_interval_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 90 },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  enabled_at: { type: DataTypes.DATE, allowNull: true },
  last_run_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'survey_rules', timestamps: true, underscored: true,
  indexes: [{ fields: ['business_id', 'enabled'] }, { fields: ['q_record_id'] }],
});

module.exports = SurveyRule;
