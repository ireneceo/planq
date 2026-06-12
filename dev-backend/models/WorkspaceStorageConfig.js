// WorkspaceStorageConfig — 워크스페이스 독립 서버(S3 호환) 파일 저장 설정 (운영 #29)
//   자격(access/secret)은 AES-256-GCM 암호화 컬럼. endpoint 는 https + SSRF 가드(s3Storage.js).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WorkspaceStorageConfig extends Model {}

WorkspaceStorageConfig.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  provider: { type: DataTypes.ENUM('s3'), allowNull: false, defaultValue: 's3' },
  endpoint: { type: DataTypes.STRING(300), allowNull: false },
  region: { type: DataTypes.STRING(60), allowNull: true, defaultValue: 'us-east-1' },
  bucket: { type: DataTypes.STRING(200), allowNull: false },
  path_prefix: { type: DataTypes.STRING(200), allowNull: true },
  public_base_url: { type: DataTypes.STRING(300), allowNull: true },
  access_key_enc: { type: DataTypes.TEXT, allowNull: false },
  secret_key_enc: { type: DataTypes.TEXT, allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: false },
  verified_at: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'workspace_storage_configs',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['business_id'] }],
});

module.exports = WorkspaceStorageConfig;
