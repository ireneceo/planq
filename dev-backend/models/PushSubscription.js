// PushSubscription — 사이클 J (Web Push, P-6.5).
// 한 user 가 여러 디바이스에서 push 구독 가능 (PC + 모바일). endpoint 가 unique key.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PushSubscription extends Model {}

PushSubscription.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'businesses', key: 'id' },
  },
  endpoint: {
    type: DataTypes.STRING(500), allowNull: false, unique: true,
  },
  p256dh: { type: DataTypes.STRING(200), allowNull: false },
  auth: { type: DataTypes.STRING(100), allowNull: false },
  // UA 메타 — 디바이스 식별 (사용자가 "이 기기에서 알림 끄기" 가능하게)
  user_agent: { type: DataTypes.STRING(500), allowNull: true },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  // 410 Gone 응답 받으면 expired 처리 (자동 정리)
  expired_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'push_subscriptions', timestamps: true, underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['business_id'] },
  ],
});

module.exports = PushSubscription;
