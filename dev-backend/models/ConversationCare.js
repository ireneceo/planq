// ConversationCare — Q talk 고객 문의 «응대 상태 · 담당자» (방당 0~1행).
//
// ★ 2026-11-12 (Irene «권고대로 진행해 줘» · Fable 설계 docs/QTALK_CARE_DESIGN.md DESIGN: READY)
//   `conversations` 에 칸을 더하지 않는다 — 대화 객체를 toJSON() 통째로 내보내는 곳이 여럿이고 고객도 같은 문을 써서
//   칸을 더하면 고객 응답으로 샌다(fail-closed). 그래서 별도 표 + **services/convCare 만** 이 모델을 읽고 쓴다.
//   models/index.js 에 연관을 걸지 않는다(include 로 딸려 나가는 길을 만들지 않는다).
//   행 없음 = «문의 없음». 고객 쪽 첫 글이 행을 만든다. 보관(active/archived)과 다른 축이다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ConversationCare extends Model {}

ConversationCare.init({
  // 대화방을 지우면 같이 지워진다(FK cascade — 마이그레이션이 보장).
  conversation_id: {
    type: DataTypes.INTEGER, primaryKey: true, allowNull: false,
    references: { model: 'conversations', key: 'id' }, onDelete: 'CASCADE',
  },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  state: { type: DataTypes.ENUM('open', 'hold', 'resolved'), allowNull: false, defaultValue: 'open' },
  state_changed_at: { type: DataTypes.DATE, allowNull: false },
  /** NULL = 자동(고객 글) */
  state_changed_by: { type: DataTypes.INTEGER, allowNull: true },
  assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  assigned_at: { type: DataTypes.DATE, allowNull: true },
  /** NULL = 기본값(행이 처음 생길 때 고객 담당자) */
  assigned_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'conversation_care',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'state', 'assignee_user_id'], name: 'idx_care_biz_state_assignee' },
  ],
});

module.exports = ConversationCare;
