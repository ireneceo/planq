const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Business extends Model {}

Business.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true
  },
  logo_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  owner_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  plan: {
    type: DataTypes.ENUM('free', 'basic', 'pro'),
    defaultValue: 'free'
  },
  subscription_status: {
    type: DataTypes.ENUM('active', 'past_due', 'canceled', 'trialing'),
    defaultValue: 'active'
  },
  storage_used_bytes: {
    type: DataTypes.BIGINT,
    defaultValue: 0
  },
  storage_limit_bytes: {
    type: DataTypes.BIGINT,
    defaultValue: 1073741824 // 1GB
  }
}, {
  sequelize,
  tableName: 'businesses',
  timestamps: true,
  underscored: true
});

module.exports = Business;
