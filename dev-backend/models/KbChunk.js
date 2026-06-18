const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 대화 자료 문서를 청크 단위로 분할 + 임베딩 저장
// FTS + 시맨틱 하이브리드 검색 소스
class KbChunk extends Model {}

KbChunk.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Q위키(source_type='wiki') chunk 는 kb_document 없음 → nullable
  kb_document_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'kb_documents', key: 'id' }
  },
  // 'kb' = 대화 자료(워크스페이스) / 'wiki' = Q위키 article(플랫폼 공통)
  source_type: {
    type: DataTypes.ENUM('kb', 'wiki'),
    allowNull: false,
    defaultValue: 'kb',
  },
  // source_type='wiki' 일 때 help_articles.id
  source_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // denormalize — 검색 성능·격리용. Q위키 chunk 는 플랫폼 공통이라 NULL.
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'businesses', key: 'id' }
  },
  chunk_index: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  content: {
    type: DataTypes.TEXT('long'),
    allowNull: false
  },
  section_title: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  token_count: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  // 1536 float32 = 6144 bytes
  embedding: {
    type: DataTypes.BLOB('medium'),
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'kb_chunks',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['kb_document_id'] },
    { fields: ['business_id'] },
    { fields: ['source_type', 'source_id'], name: 'kb_chunks_source' }
  ]
});

module.exports = KbChunk;
