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
  // #379 — Drive 폴더와의 매핑. 이동(부모 폴더 변경)을 반영하려면 양쪽 폴더가 이어져 있어야 한다.
  //   ★ 매핑이 없는 부모로의 이동은 **적용하지 않는다** — 모르는 폴더를 루트로 쓸어버리면 사고다.
  gdrive_folder_id: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
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
