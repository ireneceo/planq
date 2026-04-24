const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Client extends Model {}

Client.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // 초대 pending 단계에서는 아직 user 매칭 전이라 null 허용
    references: { model: 'users', key: 'id' }
  },
  invite_token: {
    type: DataTypes.STRING(100),
    allowNull: true,
    unique: true,
  },
  invite_email: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  accepted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  display_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  company_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  invited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  invited_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  joined_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('invited', 'active', 'archived'),
    defaultValue: 'invited'
  },
  // ─── Cue 자동 히스토리 요약 ───
  summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  summary_updated_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  summary_manual: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // ─── 기본 담당 멤버 (사람) ───
  assigned_member_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  // ─── Q Bill (Phase 0) — 국가·사업자 정보 · 세금계산서 · 청구 연락처 ───
  // ISO 2-letter country code. 기본 KR. 포트원 채널 자동 분기에 사용.
  country: { type: DataTypes.STRING(2), allowNull: true, defaultValue: 'KR' },
  // 사업자 여부 — true: 국내 법인/개인사업자 (세금계산서 대상), false: 개인 (현금영수증)
  is_business: { type: DataTypes.BOOLEAN, defaultValue: false },
  biz_name: { type: DataTypes.STRING(200), allowNull: true, comment: '사업자등록증상 상호' },
  biz_ceo: { type: DataTypes.STRING(100), allowNull: true, comment: '대표자' },
  biz_tax_id: { type: DataTypes.STRING(20), allowNull: true, comment: '사업자등록번호' },
  biz_type: { type: DataTypes.STRING(100), allowNull: true, comment: '업태' },
  biz_item: { type: DataTypes.STRING(100), allowNull: true, comment: '종목' },
  biz_address: { type: DataTypes.STRING(500), allowNull: true },
  biz_address_en: { type: DataTypes.STRING(500), allowNull: true, comment: '해외 고객 영문 주소' },
  tax_invoice_email: { type: DataTypes.STRING(200), allowNull: true, comment: '세금계산서 수취 이메일' },
  billing_contact_name: { type: DataTypes.STRING(100), allowNull: true },
  billing_contact_email: { type: DataTypes.STRING(200), allowNull: true }
}, {
  sequelize,
  tableName: 'clients',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id'] }
  ]
});

module.exports = Client;
