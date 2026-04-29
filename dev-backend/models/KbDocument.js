const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Q Talk 대화 자료 문서 (Cue 답변 소스)
// 사용자 표기: "대화 자료" / 내부 코드: kb_documents
class KbDocument extends Model {}

KbDocument.init({
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
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  // source_type — 'manual'/'faq'/'policy'/'pricing'/'other' (직접 입력)
  // 'file' (워크스페이스 파일에서 import) / 'post' (Q docs 포스트에서 import)
  source_type: {
    type: DataTypes.ENUM('manual', 'faq', 'policy', 'pricing', 'other', 'file', 'post'),
    defaultValue: 'manual'
  },
  // import 출처 추적 (선택) — 사이클 O2
  source_file_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'files', key: 'id' },
  },
  source_post_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'posts', key: 'id' },
  },
  file_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  file_size: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 원문 텍스트 추출 (간단한 문서는 file 없이 본문만)
  body: {
    type: DataTypes.TEXT('long'),
    allowNull: true
  },
  version: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  },
  status: {
    type: DataTypes.ENUM('pending', 'indexing', 'ready', 'failed'),
    defaultValue: 'pending'
  },
  chunk_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  error_message: {
    type: DataTypes.STRING(1000),
    allowNull: true
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  // 사이클 G — Q knowledge 카테고리·스코프
  // category: 지식 분류 (정책/매뉴얼/사고/FAQ/소개/가격) — 검색 필터·UI 탭 그룹
  category: {
    type: DataTypes.ENUM('policy', 'manual', 'incident', 'faq', 'about', 'pricing'),
    allowNull: false,
    defaultValue: 'manual',
  },
  // scope: 적용 범위 — workspace 전체 / 특정 프로젝트 / 특정 고객 한정
  // hybridSearch 우선순위: client → project → workspace (threshold 0.78)
  scope: {
    type: DataTypes.ENUM('workspace', 'project', 'client'),
    allowNull: false,
    defaultValue: 'workspace',
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'projects', key: 'id' },
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' },
  },
  // 사이클 P3 — LLM 자동 추출 키워드 (5~8개). 리스트 칩 + 클릭 필터.
  tags: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 사이클 P3 — 단일 KbDocument 에 묶인 첨부 파일/문서 IDs (다중 가능).
  // 인덱싱 시 본문 + 첨부 텍스트 통합. 매뉴얼/가이드 1 entry = 다중 첨부.
  attached_file_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  attached_post_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
}, {
  sequelize,
  tableName: 'kb_documents',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] },
    { fields: ['business_id', 'category'] },
    { fields: ['business_id', 'scope', 'project_id'] },
    { fields: ['business_id', 'scope', 'client_id'] },
  ]
});

module.exports = KbDocument;
