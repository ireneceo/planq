// PlanQ 안내방 상태 — 워크스페이스당 하나(2026-11-04, docs/PLANQ_GUIDE_ROOM_DESIGN.md §1).
// 대화 자체는 conversations(channel_type 'platform')에 있고, 이 표는 그 방의 «운영 상태» 만 든다.
// 쓰는 곳은 services/supportRoom.js 하나. 운영 스키마는 scripts/migrate-support-room.js.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SupportRoom extends Model {}

SupportRoom.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, unique: 'uq_support_rooms_business' },
  conversation_id: { type: DataTypes.INTEGER, allowNull: false, unique: 'uq_support_rooms_conversation' },
  human_requested_at: { type: DataTypes.DATE, allowNull: true, comment: '고객이 «사람에게 묻기» 를 누른 시각 — 관리자가 답하면 비운다' },
  cue_muted_until: { type: DataTypes.DATE, allowNull: true, comment: '관리자가 말한 뒤 Cue 가 끼어들지 않는 시각' },
  nudges_off_at: { type: DataTypes.DATE, allowNull: true, comment: '대표의 «안내 메시지 그만 받기»' },
  admin_last_read_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'support_rooms',
  timestamps: true,
  underscored: true,
});

module.exports = SupportRoom;
