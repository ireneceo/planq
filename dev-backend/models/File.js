const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class File extends Model {}

File.init({
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
  project_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
    references: { model: 'projects', key: 'id' }
  },
  folder_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'file_folders', key: 'id' }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  uploader_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: false
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  storage_provider: {
    type: DataTypes.ENUM('planq', 'gdrive', 'dropbox'),
    allowNull: false,
    defaultValue: 'planq'
  },
  external_id: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  external_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  content_hash: {
    type: DataTypes.CHAR(64),
    allowNull: true
  },
  ref_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'files',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id'] },
    { fields: ['business_id', 'content_hash'] },
    { fields: ['deleted_at'] }
  ]
});

module.exports = File;
