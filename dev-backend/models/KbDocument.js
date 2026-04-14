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
  source_type: {
    type: DataTypes.ENUM('manual', 'faq', 'policy', 'pricing', 'other'),
    defaultValue: 'manual'
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
  }
}, {
  sequelize,
  tableName: 'kb_documents',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'status'] }
  ]
});

module.exports = KbDocument;
