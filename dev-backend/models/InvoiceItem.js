const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class InvoiceItem extends Model {}

InvoiceItem.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  invoice_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'invoices', key: 'id' }
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  quantity: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 1
  },
  unit_price: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  amount: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  sequelize,
  tableName: 'invoice_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true
});

module.exports = InvoiceItem;
