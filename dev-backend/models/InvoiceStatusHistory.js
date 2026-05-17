// InvoiceStatusHistory — 청구서 상태 전이 박제 (사이클 N+21)
// invoices.status: draft / sent / paid / void 등 전이 시 row 1건 insert.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class InvoiceStatusHistory extends Model {}

InvoiceStatusHistory.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  invoice_id: { type: DataTypes.INTEGER, allowNull: false },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  from_status: { type: DataTypes.STRING(20), allowNull: true },
  to_status: { type: DataTypes.STRING(20), allowNull: false },
  changed_by: { type: DataTypes.INTEGER, allowNull: true },
  note: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  tableName: 'invoice_status_history',
  timestamps: true, underscored: true, updatedAt: false,
  indexes: [
    { fields: ['invoice_id', 'created_at'], name: 'idx_invoice_changed' },
    { fields: ['business_id', 'created_at'], name: 'idx_biz_changed' },
  ],
});

module.exports = InvoiceStatusHistory;
