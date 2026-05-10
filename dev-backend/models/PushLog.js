// PushLog — Web Push 발송 결과 기록. 운영 가시성·발송 실패율·abuse 추적.
// 모든 push 발송 시도마다 1 row insert. 외부 발송 시스템 표준 (이메일·SMS·push) 동일 패턴.
//
// 권장 cron: 60일 지난 row 삭제 (서비스 별도).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PushLog extends Model {}

PushLog.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' }, onDelete: 'SET NULL',
  },
  // PushSubscription.id 참조 (FK 가 아님 — sub 가 삭제되어도 log 보존)
  subscription_id: { type: DataTypes.BIGINT, allowNull: true },
  endpoint_host: { type: DataTypes.STRING(120), allowNull: true },  // 분석용 (full URL 은 PII 가능)
  // 발송 카테고리 (필수가 아님 — 향후 사용자별 필터에 사용)
  category: { type: DataTypes.STRING(40), allowNull: true },
  status: {
    type: DataTypes.ENUM('sent', 'expired', 'failed', 'skipped'),
    allowNull: false,
  },
  // expired = 410/404 / failed = 그 외 / skipped = 권한 OFF·VAPID 미설정 등
  status_code: { type: DataTypes.INTEGER, allowNull: true },
  error_message: { type: DataTypes.STRING(500), allowNull: true },
  payload_title: { type: DataTypes.STRING(200), allowNull: true },
}, {
  sequelize, tableName: 'push_logs', timestamps: true, underscored: true,
  indexes: [
    { fields: ['user_id', 'created_at'] },
    { fields: ['status', 'created_at'] },
  ],
});

module.exports = PushLog;
