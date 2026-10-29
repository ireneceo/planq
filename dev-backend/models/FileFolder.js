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
  },
  // 폴더 공유 링크 (#469, 설계 docs/FOLDER_SHARE_DESIGN.md) — 다른 자료와 같은 칸 이름이라 services/share_helper 를 그대로 쓴다.
  //   ★ 응답에는 싣지 않는다 — services/folderResponse.serializeFolder 가 share_on 등만 내보낸다.
  //   shared_by = 발급자. 내용은 «발급자가 지금 볼 수 있는 것» 으로 열 때마다 다시 계산한다(services/folderShare).
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  share_password_hash: { type: DataTypes.STRING(255), allowNull: true },
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
  shared_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'file_folders',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id', 'parent_id'] },
    { name: 'file_folders_share_token_unique', unique: true, fields: ['share_token'] },
  ]
});

module.exports = FileFolder;
