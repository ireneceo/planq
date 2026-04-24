const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 결제 기록 — Invoice : Payment = 1 : N (부분결제/분할결제 지원)
// Q Bill §4.4
class InvoicePayment extends Model {}

InvoicePayment.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  invoice_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'invoices', key: 'id' } },
  amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  method: {
    type: DataTypes.ENUM('portone', 'bank_transfer', 'cash', 'other'),
    allowNull: false,
  },
  paid_at: { type: DataTypes.DATE, allowNull: false },
  // PG 메타
  pg_provider: { type: DataTypes.STRING(20), allowNull: true, comment: 'portone/stripe/...' },
  pg_channel: { type: DataTypes.STRING(50), allowNull: true, comment: 'toss/stripe/kakao...' },
  pg_transaction_id: { type: DataTypes.STRING(200), allowNull: true },
  pg_raw_response: { type: DataTypes.JSON, allowNull: true },
  // 수수료/순액
  fee_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  net_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
  currency: { type: DataTypes.STRING(3), defaultValue: 'KRW' },
  memo: { type: DataTypes.STRING(500), allowNull: true },
  // 환불
  refunded_amount: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0 },
  refunded_at: { type: DataTypes.DATE, allowNull: true },
  recorded_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  tableName: 'invoice_payments',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['invoice_id'] },
    { fields: ['pg_transaction_id'] },
  ],
});

module.exports = InvoicePayment;
