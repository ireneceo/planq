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
    type: DataTypes.ENUM('planq', 'gdrive', 's3'),
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
  // GDrive 미러 (storage_provider 는 그대로 'planq' 유지 — 서빙은 로컬, Drive 엔 사본만).
  //   워크스페이스 파일 전체 Drive 가시성 목적. flip 아님 → 다운로드/이미지/ZIP 회귀 없음.
  gdrive_mirror_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  gdrive_mirror_url: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  gdrive_mirrored_at: {
    type: DataTypes.DATE,
    allowNull: true,
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
  // 사이클 N+61 — column-level unique 제거. indexes 배열 명시 (sync 누적 차단)
  share_token: {
    type: DataTypes.STRING(64),
    allowNull: true,
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
  // D4 #62 — 보안등급 (visibility 와 직교 축). general=외부공유·드라이브 OK /
  //   internal=외부공유 차단 / confidential=외부공유·개인드라이브 차단 + export 관리자만.
  security_level: {
    type: DataTypes.ENUM('general', 'internal', 'confidential'),
    allowNull: false,
    defaultValue: 'general',
  },
  // N+74 — vlevel 신컬럼 (Post/KbDocument 와 정합). visibility 는 legacy 유지 + 동시 갱신.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: 'L3',
  },
  // N+74 — L2-members 분기 (project_id 없이 명시 멤버 리스트)
  target_member_ids: {
    type: DataTypes.JSON,
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
    { unique: true, fields: ['share_token'], name: 'files_share_token_unique' },
    { fields: ['deleted_at'] },
    { fields: ['business_id', 'visibility', 'uploader_id'] },
  ]
});

module.exports = File;
