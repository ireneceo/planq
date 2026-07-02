const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// KNOWLEDGE_LOOP 축1 — Cue 워크스페이스 지식 카드 (docs/KNOWLEDGE_LOOP_DESIGN.md)
//   자동 채굴(work_pattern 통계)은 pending 제안 → 사람이 수락해야 active (승인 게이트).
//   active 카드만 buildCueContext 에 주입된다.
class CueKnowledge extends Model {}

CueKnowledge.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  kind: {
    type: DataTypes.ENUM('work_pattern', 'client_trait', 'terminology', 'decision', 'custom'),
    allowNull: false,
    defaultValue: 'custom',
  },
  title: { type: DataTypes.STRING(200), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false, comment: 'Cue 프롬프트 주입 단위 — 간결한 사실 서술' },
  source: { type: DataTypes.ENUM('auto_mined', 'user'), allowNull: false, defaultValue: 'user' },
  status: { type: DataTypes.ENUM('pending', 'active', 'rejected'), allowNull: false, defaultValue: 'active' },
  meta: { type: DataTypes.JSON, allowNull: true, comment: '채굴 근거 (통계 수치·기준 category 등)' },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
  decided_by: { type: DataTypes.INTEGER, allowNull: true },
  decided_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'cue_knowledge',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] },
    { fields: ['business_id', 'kind'] },
  ],
});

module.exports = CueKnowledge;
