const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 청구서 번호 카운터 — (business_id, year) 별 마지막 순번. docs/FIX_0AB_MONEY_DESIGN.md B-②
//   번호는 services/invoiceNumber.js 만 뽑는다(트랜잭션 안 UPDATE 로 행 락 → 동시 생성 직렬화).
class InvoiceNumberCounter extends Model {}

InvoiceNumberCounter.init({
  business_id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
  year: { type: DataTypes.SMALLINT, allowNull: false, primaryKey: true },
  last_no: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  tableName: 'invoice_number_counters',
  timestamps: false,
  underscored: true,
});

module.exports = InvoiceNumberCounter;
