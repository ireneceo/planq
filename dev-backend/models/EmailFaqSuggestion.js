// EmailFaqSuggestion — Q Mail M4 FAQ 자동 클러스터링 제안
// 답한 메일(inbound 질문 + outbound 답장) 패턴을 Cue 가 클러스터링 → 반복 Q&A 를 FAQ 후보로 제안.
// 사용자가 accept 하면 KbDocument(source_type='faq') 로 등록 → Q info / Cue 답변에 활용.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class EmailFaqSuggestion extends Model {}

EmailFaqSuggestion.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  question: { type: DataTypes.STRING(500), allowNull: false },       // 대표 질문
  answer: { type: DataTypes.TEXT, allowNull: false },                 // 제안 답변 (기존 답장 기반)
  source_thread_ids: { type: DataTypes.JSON, allowNull: true, defaultValue: null }, // 근거 스레드 id
  occurrence_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, // 반복 횟수
  status: { type: DataTypes.ENUM('pending', 'accepted', 'dismissed'), allowNull: false, defaultValue: 'pending' },
  kb_document_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'kb_documents', key: 'id' } }, // accept 시 연결
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize, tableName: 'email_faq_suggestions', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'status'], name: 'email_faq_biz_status' },
  ],
});

module.exports = EmailFaqSuggestion;
