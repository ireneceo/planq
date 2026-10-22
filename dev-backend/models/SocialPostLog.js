// 인사이트 글 SNS 발송 — 게시물 상태 전이·외부 호출 원장 (CLAUDE.md 운영 안정성 6: 외부 발송은 처음부터 기록).
//   관리자 행위의 감사(writeAudit)와는 따로 둔다 — 이쪽은 게시물 한 건의 일대기다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SocialPostLog extends Model {}

SocialPostLog.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  post_id: { type: DataTypes.INTEGER, allowNull: false },
  from_status: { type: DataTypes.STRING(20), allowNull: true },
  to_status: { type: DataTypes.STRING(20), allowNull: true },
  action: { type: DataTypes.STRING(40), allowNull: false },
  status_code: { type: DataTypes.INTEGER, allowNull: true },
  message: { type: DataTypes.STRING(500), allowNull: true },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'social_post_logs',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [{ fields: ['post_id', 'created_at'], name: 'social_post_logs_post' }],
});

module.exports = SocialPostLog;
