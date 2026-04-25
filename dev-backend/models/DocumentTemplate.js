const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 문서 템플릿 — Q Docs §3.1
// system 템플릿 (PlanQ 기본 제공) + 워크스페이스 정의 템플릿.
class DocumentTemplate extends Model {}

DocumentTemplate.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  // NULL = 시스템 템플릿 (모든 워크스페이스 공용)
  business_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'businesses', key: 'id' } },
  kind: {
    type: DataTypes.ENUM('quote', 'invoice', 'tax_invoice', 'contract', 'nda',
                          'proposal', 'sow', 'meeting_note', 'sop', 'custom'),
    allowNull: false,
  },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  mode: { type: DataTypes.ENUM('form', 'editor', 'hybrid'), allowNull: false, defaultValue: 'form' },
  // form 모드 schema — 필드 정의 (label, type, required, default, validation)
  schema_json: { type: DataTypes.JSON, allowNull: true },
  // editor 모드 본문 (TipTap JSON / Markdown)
  body_template: { type: DataTypes.TEXT, allowNull: true },
  // 변수 정의 — Cue 가 자동 채울 변수 ({{client.name}} 등)
  variables_json: { type: DataTypes.JSON, allowNull: true },
  // AI 생성용 시스템 프롬프트 (kind 별 기본값 + 커스텀)
  ai_prompt_template: { type: DataTypes.TEXT, allowNull: true },
  visibility: {
    type: DataTypes.ENUM('workspace_only', 'client_shareable'),
    defaultValue: 'workspace_only',
  },
  locale: { type: DataTypes.ENUM('ko', 'en', 'bilingual'), defaultValue: 'ko' },
  is_system: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  preview_image: { type: DataTypes.STRING(500), allowNull: true },
  usage_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
}, {
  sequelize,
  tableName: 'document_templates',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'kind'] },
    { fields: ['is_system'] },
    { fields: ['kind', 'is_active'] },
  ],
});

module.exports = DocumentTemplate;
