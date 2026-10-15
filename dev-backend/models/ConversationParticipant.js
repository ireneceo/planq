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
  // «열어 봤을 뿐» 인 행 — 읽음 커서(last_read_at)·핀(pinned_at)을 담으려고 생긴 행이다(2026-10-15 Fable 설계 A).
  //   참여자가 아니다: 참여자 목록·@ 후보·메시지 알림·읽음 분모·사적 방 접근권 어디에도 들지 않는다.
  //   ★ 아래 defaultScope 가 기본으로 뺀다. 1 을 쓰는 문은 services/convParticipants.touchOwnRow 하나,
  //     0 으로 올리는 문은 joinParticipant 하나(초대·말하기). 그 밖에서 unscoped()/create 금지 — 가드 convparticipants.
  is_viewer: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
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
  // 진짜 참여자만이 기본 — 새로 읽는 코드가 깜빡해도 «빠지는 쪽(안전)» 으로 틀린다.
  defaultScope: { where: { is_viewer: false } },
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'] }
  ]
});

module.exports = ConversationParticipant;
