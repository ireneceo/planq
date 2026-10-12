// 설문 회차(survey v2) — «누구에게 언제 보냈나» 한 묶음. 설계 docs/SURVEY_V2_DESIGN.md §3.2
//   질문지(문항·응답)는 q_records 에 남고, 회차는 사건이라 따로 둔다. 수동이면 rule_id NULL.
//   ★ idempotency_key UNIQUE — 같은 사건으로 두 번째 회차가 생기면 DB 가 거부한다(cron 경합 대비, Phase 2).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SurveyIssue extends Model {}

SurveyIssue.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  q_record_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'q_records', key: 'id' } },
  rule_id: { type: DataTypes.INTEGER, allowNull: true },
  origin: { type: DataTypes.ENUM('manual', 'rule'), allowNull: false, defaultValue: 'manual' },
  subject_type: { type: DataTypes.ENUM('project', 'client', 'period'), allowNull: true },
  subject_id: { type: DataTypes.INTEGER, allowNull: true },
  period_key: { type: DataTypes.STRING(16), allowNull: true },
  idempotency_key: { type: DataTypes.STRING(120), allowNull: false, unique: true },
  status: { type: DataTypes.ENUM('pending_review', 'sent', 'skipped', 'expired', 'failed', 'blocked_quota'), allowNull: false, defaultValue: 'sent' },
  title: { type: DataTypes.STRING(200), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: true },
  closes_at: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  approved_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  approved_at: { type: DataTypes.DATE, allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'survey_issues', timestamps: true, underscored: true,
  indexes: [{ fields: ['q_record_id', 'created_at'] }, { fields: ['business_id', 'status'] }],
});

module.exports = SurveyIssue;
