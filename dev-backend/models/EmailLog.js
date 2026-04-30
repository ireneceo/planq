const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 이메일 발송 로그 — 운영 모니터링용 (Q-C 사이클).
// 모든 sendEmail 호출은 이 테이블에 row 1건. status 로 sent/failed/skipped 구분.
// 관리자 페이지 (AdminEmailLogsPage) 에서 리스트 + 재발송.
class EmailLog extends Model {}

EmailLog.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  to_email: { type: DataTypes.STRING(255), allowNull: false },
  subject: { type: DataTypes.STRING(500), allowNull: false },
  // sent: SMTP 전송 성공 / failed: 전송 실패 / skipped: SMTP 미설정·dry-run
  status: { type: DataTypes.ENUM('sent', 'failed', 'skipped'), allowNull: false, defaultValue: 'sent' },
  error_message: { type: DataTypes.STRING(1000), allowNull: true },
  // 어떤 템플릿·이벤트에서 발송했는지 식별 (예: 'invite', 'password_reset', 'invoice_share')
  template: { type: DataTypes.STRING(60), allowNull: true },
  // 연관 리소스 (예: invoice_id, signature_request_id, post_id) — 재발송 시 활용
  related_entity_type: { type: DataTypes.STRING(40), allowNull: true },
  related_entity_id: { type: DataTypes.BIGINT, allowNull: true },
  business_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'businesses', key: 'id' } },
  // 응답 신원 (요청한 사용자, 있으면)
  initiated_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  // 재발송 카운트 — 0 부터 시작, retry endpoint 호출 시 증가
  retry_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'email_logs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status', 'created_at'] },
    { fields: ['business_id', 'created_at'] },
    { fields: ['template', 'created_at'] },
    { fields: ['related_entity_type', 'related_entity_id'] },
  ],
});

module.exports = EmailLog;
