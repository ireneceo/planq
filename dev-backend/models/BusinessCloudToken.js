const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BusinessCloudToken extends Model {}

BusinessCloudToken.init({
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
  provider: {
    type: DataTypes.ENUM('gdrive'),
    allowNull: false
  },
  access_token: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  refresh_token: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  scope: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  root_folder_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  connected_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  connected_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  account_email: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  qnote_folder_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Q Note 전용 루트 폴더 ID'
  },
  // Drive changes.watch 상태
  watch_channel_id: {
    type: DataTypes.STRING(64),
    allowNull: true
  },
  watch_resource_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  watch_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  watch_page_token: {
    type: DataTypes.STRING(128),
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'business_cloud_tokens',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'provider'] }
  ]
});

module.exports = BusinessCloudToken;
