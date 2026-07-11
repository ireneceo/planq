// 메시지 이모지 리액션 (#138) — 한 사용자가 한 메시지에 같은 이모지를 두 번 달 수 없다(UNIQUE).
//   토글: 이미 있으면 삭제, 없으면 생성.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class MessageReaction extends Model {}

MessageReaction.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  message_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  // 멀티테넌트 격리 — 조회 시 WHERE business_id 강제 (CLAUDE.md 규칙)
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  // 이모지 문자 그대로. ★ collation 은 반드시 utf8mb4_bin —
  //   테이블 기본 utf8mb4_unicode_ci(UCA 4.0.0)는 BMP 밖 문자(👍🎉😂👀🙏🔥)에 가중치가 없어
  //   전부 '같은 값'으로 비교된다. 그러면 👍 누른 뒤 🎉 누르면 기존 👍 행이 매치돼 지워지고,
  //   UNIQUE 도 두 번째 이모지 INSERT 를 거부한다 (= 한 메시지에 이모지 1종만 가능).
  emoji: {
    type: DataTypes.STRING(16),
    allowNull: false,
    collate: 'utf8mb4_bin',
  },
}, {
  sequelize,
  modelName: 'MessageReaction',
  tableName: 'message_reactions',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['message_id', 'user_id', 'emoji'], name: 'message_reactions_unique' },
    { fields: ['message_id'], name: 'message_reactions_message' },
    { fields: ['business_id'], name: 'message_reactions_business' },
  ],
});

module.exports = MessageReaction;
