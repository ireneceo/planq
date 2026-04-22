// Q Note 사용량 월 집계
// Python Q Note 서비스가 세션 종료 시 POST /api/qnote/usage 로 분 단위 기록
// (TODO: Q Note 서비스 측 연동 — 현재는 테이블/모델만 준비)
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class QnoteUsage extends Model {}

QnoteUsage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  year_month: { type: DataTypes.STRING(7), allowNull: false },  // 'YYYY-MM'
  minutes_used: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  session_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  cost_usd: { type: DataTypes.DECIMAL(10, 4), allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'qnote_usage',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['business_id', 'year_month'] }]
});

module.exports = QnoteUsage;
