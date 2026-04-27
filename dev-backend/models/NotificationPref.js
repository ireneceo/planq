// NotificationPref — 사용자별 알림 채널 ON/OFF 매트릭스 (Phase E4)
//
// 매트릭스: event × channel × enabled
//   event:    'signature' | 'invoice' | 'tax_invoice' | 'task' | 'event' | 'invite' | 'mention'
//   channel:  'inbox' | 'chat' | 'email'
//
// 설계:
//   - row 가 없으면 기본값 ON (열린 문화).
//   - row 가 있고 enabled=false 면 차단.
//   - 사용자가 명시적으로 끈 항목만 row 생성 (storage 절약).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class NotificationPref extends Model {}

NotificationPref.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  business_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'businesses', key: 'id' },
    comment: 'null 이면 사용자 전역 기본, 값 있으면 워크스페이스별 override',
  },
  event_kind: {
    type: DataTypes.ENUM('signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite', 'mention'),
    allowNull: false,
  },
  channel: {
    type: DataTypes.ENUM('inbox', 'chat', 'email'),
    allowNull: false,
  },
  enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  sequelize, tableName: 'notification_prefs', timestamps: true, underscored: true,
  indexes: [
    { fields: ['user_id', 'business_id', 'event_kind', 'channel'], unique: true, name: 'uq_user_biz_event_channel' },
    { fields: ['user_id'] },
  ],
});

module.exports = NotificationPref;
