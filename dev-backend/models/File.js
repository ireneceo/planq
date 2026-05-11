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
    type: DataTypes.ENUM('planq', 'gdrive'),
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
  // 공유 링크 — 통합 공유 시스템 (Task/KbDocument/CalendarEvent 와 일관)
  share_token: {
    type: DataTypes.STRING(64),
    allowNull: true,
    unique: true
  },
  shared_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  share_password_hash: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  share_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // legacy column — 기존 share-link 라우트 (line 534) 호환용 보관
  share_created_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── 4단계 Visibility (사이클 N+9, 2026-05-11) — VISIBILITY_VOCABULARY.md ───
  // L1=개인(uploader 본인만), L2=팀(프로젝트 멤버), L3=워크스페이스, L4=외부(share_token)
  // NULL = legacy (백필 전. 이후엔 라우트가 항상 값 설정)
  visibility: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
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
    { fields: ['share_token'] },
    { fields: ['deleted_at'] },
    { fields: ['business_id', 'visibility', 'uploader_id'] },
  ]
});

module.exports = File;
