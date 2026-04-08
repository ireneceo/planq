const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Invoice extends Model {}

Invoice.init({
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
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  invoice_number: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  total_amount: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  tax_amount: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  grand_total: {
    type: DataTypes.DECIMAL(12, 0),
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('draft', 'sent', 'paid', 'overdue', 'canceled'),
    defaultValue: 'draft'
  },
  issued_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recipient_email: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  recipient_business_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  recipient_business_number: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'invoices',
  timestamps: true,
  underscored: true
});

module.exports = Invoice;
