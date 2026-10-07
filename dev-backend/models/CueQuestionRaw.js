const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 분류 안 된 Cue 질문 원문 — **가명처리 후** 30일 (2026-10-07, Fable 판정 B5).
//   워크스페이스가 켰을 때(permissions.cue_analysis.raw, 기본 꺼 둠)의 qhelper 질문만. user_id·business_id 없음.
//   사람이 라벨을 붙이면 연결된 주제 행을 고치고 이 행은 지운다(routes/cue_question_admin.js).
class CueQuestionRaw extends Model {}

CueQuestionRaw.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  topic_row_id: { type: DataTypes.BIGINT, allowNull: true, comment: 'cue_question_topics.id — 라벨 보강 대상' },
  question: { type: DataTypes.STRING(1000), allowNull: false, comment: '가명처리된 원문' },
  lang: { type: DataTypes.STRING(5), allowNull: true },
}, {
  sequelize,
  tableName: 'cue_question_raw',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['created_at'], name: 'idx_cqr_created' }],
});

module.exports = CueQuestionRaw;
