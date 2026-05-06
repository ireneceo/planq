const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ConversationParticipant extends Model {}

ConversationParticipant.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'conversations', key: 'id' }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  role: {
    type: DataTypes.ENUM('owner', 'member', 'client'),
    defaultValue: 'member'
  },
  joined_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  // 사용자별 핀 (즐겨찾기) — null = 핀 안 됨, timestamp = 핀 시각
  // 같은 채팅을 A 는 핀, B 는 안 핀 — 사용자별 독립 상태
  pinned_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 마지막으로 읽은 시각 — unread_count 계산 기준점.
  // null = 한 번도 읽지 않음 (모든 메시지가 unread).
  // 대화방 진입 시 PUT /:bid/:id/read 로 NOW() 갱신.
  last_read_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'conversation_participants',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'] }
  ]
});

module.exports = ConversationParticipant;
