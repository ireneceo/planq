const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 견적서 — Q Bill §4.2
// 라이프사이클: draft → sent → viewed → accepted/rejected/expired/converted
class Quote extends Model {}

Quote.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  client_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'clients', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  quote_number: { type: DataTypes.STRING(50), allowNull: false },
  title: { type: DataTypes.STRING(300), allowNull: true },
  status: {
    type: DataTypes.ENUM('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'converted'),
    defaultValue: 'draft',
  },
  issued_at: { type: DataTypes.DATEONLY, allowNull: true },
  valid_until: { type: DataTypes.DATEONLY, allowNull: true },
  subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  vat_rate: { type: DataTypes.DECIMAL(4, 3), defaultValue: 0.100 },
  vat_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  total_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  currency: { type: DataTypes.STRING(3), defaultValue: 'KRW' },
  payment_terms: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  signature_url: { type: DataTypes.STRING(500), allowNull: true },
  // 공개 공유 토큰 (로그인 없이 고객이 승인 가능)
  share_token: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  viewed_at: { type: DataTypes.DATE, allowNull: true },
  accepted_at: { type: DataTypes.DATE, allowNull: true },
  // 전환된 Invoice 참조 (Q Bill §4.2)
  converted_invoice_id: { type: DataTypes.INTEGER, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  tableName: 'quotes',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] },
    { fields: ['client_id'] },
    { fields: ['project_id'] },
    { unique: true, fields: ['business_id', 'quote_number'] },
  ],
});

module.exports = Quote;
