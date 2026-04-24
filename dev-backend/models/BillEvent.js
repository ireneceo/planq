const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Q Bill 이벤트 타임라인 — quote/invoice 의 모든 상태 변화 기록
// 고객 공개 링크 열람·승인·결제·세금계산서 발행 전부 여기에 쌓인다.
class BillEvent extends Model {}

BillEvent.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  entity_type: { type: DataTypes.ENUM('quote', 'invoice'), allowNull: false },
  entity_id: { type: DataTypes.BIGINT, allowNull: false },
  event_type: {
    type: DataTypes.ENUM(
      'created', 'sent', 'viewed', 'accepted', 'rejected', 'converted',
      'paid_partial', 'paid_full', 'overdue', 'canceled', 'refunded',
      'tax_issued', 'tax_failed', 'commented'
    ),
    allowNull: false,
  },
  actor_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  detail: { type: DataTypes.JSON, allowNull: true },
}, {
  sequelize,
  tableName: 'bill_events',
  timestamps: true,
  underscored: true,
  updatedAt: false,
  indexes: [{ fields: ['entity_type', 'entity_id'] }],
});

module.exports = BillEvent;
