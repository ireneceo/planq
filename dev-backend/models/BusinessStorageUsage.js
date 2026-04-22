const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessStorageUsage extends Model {}

BusinessStorageUsage.init({
  business_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    references: { model: 'businesses', key: 'id' }
  },
  bytes_used: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0
  },
  file_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  storage_provider: {
    type: DataTypes.ENUM('planq', 'gdrive'),
    allowNull: false,
    defaultValue: 'planq'
  }
}, {
  sequelize,
  tableName: 'business_storage_usage',
  timestamps: true,
  underscored: true
});

module.exports = BusinessStorageUsage;
