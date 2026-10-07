const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Cue 질문 주제 통계 (2026-10-07, Fable 판정 B5) — **user_id·business_id 없음.**
//   서로 다른 워크스페이스 수는 ws_day_hash(하루마다 바뀌는 비밀 해시)로만 센다. 판정·기록: services/cueQuestionAnalysis.js
class CueQuestionTopic extends Model {}

CueQuestionTopic.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  stat_date: { type: DataTypes.DATEONLY, allowNull: false },
  topic: { type: DataTypes.STRING(40), allowNull: false, comment: 'TOPICS 중 하나 · other · unclassified' },
  intent: { type: DataTypes.STRING(20), allowNull: true, comment: 'howto|data|bug|feature_gap' },
  classified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  answered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  mode: { type: DataTypes.STRING(12), allowNull: false, comment: 'qhelper|workspace|public' },
  plan_tier: { type: DataTypes.STRING(20), allowNull: true },
  lang: { type: DataTypes.STRING(5), allowNull: true },
  ws_day_hash: { type: DataTypes.CHAR(32), allowNull: true, comment: '하루 단위 비가역 해시 — 공개 질문은 NULL' },
}, {
  sequelize,
  tableName: 'cue_question_topics',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['stat_date'], name: 'idx_cqt_date' },
    { fields: ['topic', 'stat_date'], name: 'idx_cqt_topic_date' },
  ],
});

module.exports = CueQuestionTopic;
