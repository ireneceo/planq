const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class FileFolder extends Model {}

FileFolder.init({
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
  parent_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'file_folders', key: 'id' }
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  sort_order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'file_folders',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id', 'parent_id'] }
  ]
});

module.exports = FileFolder;
