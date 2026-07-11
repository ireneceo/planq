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
  // 이모지 문자 그대로 (utf8mb4). 서버에서 허용 목록 검증.
  emoji: { type: DataTypes.STRING(16), allowNull: false },
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
