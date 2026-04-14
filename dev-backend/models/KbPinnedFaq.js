const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 관리자가 직접 등록한 고정 Q&A (Cue 답변의 Tier 1 — 최우선 매칭)
class KbPinnedFaq extends Model {}

KbPinnedFaq.init({
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
  question: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  answer: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  // 짧은 답변 (선택 — 간결 톤 고객용)
  short_answer: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  // STT·검색 키워드 보강 (JSON 배열)
  keywords: {
    type: DataTypes.JSON,
    allowNull: true
  },
  category: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  // 임베딩 (text-embedding-3-small, 1536 float32 = 6144 bytes)
  embedding: {
    type: DataTypes.BLOB('medium'),
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'kb_pinned_faqs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id'] }
  ]
});

module.exports = KbPinnedFaq;
