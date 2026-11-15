const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 문의(contact_inquiries)에 PlanQ 가 직접 보낸 회신 — 외부 발송 기록(ops-backend 6). 2026-11-15.
//   쓰는 문은 services/inquiryReply 하나. 설계 docs/INQUIRY_DIRECT_REPLY_DESIGN.md (Fable DESIGN: FIX 반영).
//   status: sending(발송 시작, 행을 먼저 만든다) → sent / failed / skipped(발송 꺼진 서버·차단 주소).
//   ★ 5분 넘게 sending 인 행은 «결과 확인 안 됨» 으로 보인다 — 실패로 보이면 다시 보내 두 통이 나갈 수 있다.
class ContactInquiryReply extends Model {}

ContactInquiryReply.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  inquiry_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'contact_inquiries', key: 'id' }, onDelete: 'CASCADE' },
  sent_by_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
  to_email: { type: DataTypes.STRING(200), allowNull: false },
  subject: { type: DataTypes.STRING(300), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  locale: { type: DataTypes.STRING(8), allowNull: true },
  status: { type: DataTypes.ENUM('sending', 'sent', 'failed', 'skipped'), allowNull: false, defaultValue: 'sending' },
  error_message: { type: DataTypes.STRING(1000), allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'contact_inquiry_replies',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'cir_inquiry_created', fields: ['inquiry_id', 'created_at'] },
    { name: 'cir_sender_created', fields: ['sent_by_user_id', 'created_at'] },
  ],
});

module.exports = ContactInquiryReply;
