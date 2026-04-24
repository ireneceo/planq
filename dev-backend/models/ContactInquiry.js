const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 플랫폼 문의 — Enterprise 문의·랜딩 "문의하기"·일반 고객 문의 통합.
// platform_admin 이 관리자 대시보드에서 확인/답변.
class ContactInquiry extends Model {}

ContactInquiry.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kind: {
    type: DataTypes.ENUM('enterprise', 'general', 'landing'),
    allowNull: false,
    defaultValue: 'general',
  },
  source: { type: DataTypes.STRING(50), allowNull: true, comment: 'plan_page · landing_home 등' },
  // 인증된 사용자/워크스페이스 있을 때 연결
  business_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'businesses', key: 'id' } },
  from_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  // unauthenticated 도 접수 가능하도록 name/email 직접 받음
  from_name: { type: DataTypes.STRING(100), allowNull: false },
  from_email: { type: DataTypes.STRING(200), allowNull: false },
  from_company: { type: DataTypes.STRING(200), allowNull: true },
  from_phone: { type: DataTypes.STRING(50), allowNull: true },
  message: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.ENUM('new', 'in_progress', 'resolved', 'spam'),
    defaultValue: 'new',
  },
  replied_at: { type: DataTypes.DATE, allowNull: true },
  replied_by_user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  reply_note: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  tableName: 'contact_inquiries',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status', 'created_at'] },
    { fields: ['kind', 'status'] },
  ],
});

module.exports = ContactInquiry;
