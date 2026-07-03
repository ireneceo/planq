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
  // 구독 종류 — 'webpush'(브라우저/PWA), 'apns'(iOS 네이티브), 'fcm'(Android 네이티브).
  //   네이티브 row 의 endpoint 규약: `apns:<device_token>` / `fcm:<device_token>` (unique 재활용, §5.1).
  kind: {
    type: DataTypes.ENUM('webpush', 'apns', 'fcm'), allowNull: false, defaultValue: 'webpush',
  },
  endpoint: {
    type: DataTypes.STRING(500), allowNull: false,
  },
  // web push 키 — 네이티브(apns/fcm) 는 NULL. 대신 device_token 사용.
  p256dh: { type: DataTypes.STRING(200), allowNull: true },
  auth: { type: DataTypes.STRING(100), allowNull: true },
  // 네이티브 기기 토큰 (APNs/FCM). webpush 는 NULL.
  device_token: { type: DataTypes.STRING(255), allowNull: true },
  // 기기 표시명 (예: "Apple iPhone15,2") — 사용자가 "이 기기 알림 끄기" 식별.
  device_name: { type: DataTypes.STRING(100), allowNull: true },
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
    { unique: true, fields: ['endpoint'], name: 'push_subscriptions_endpoint_unique' },
  ],
});

module.exports = PushSubscription;
