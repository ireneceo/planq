const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 문서 인스턴스 — Q Docs §3.1
// 모든 정형 문서(견적서·청구서·계약서·NDA·제안서·SOW·회의록·SOP) 의 단일 진실.
// quotes/invoices 테이블과는 1:1 sync (quote_id / invoice_id).
class Document extends Model {}

Document.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  template_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'document_templates', key: 'id' } },
  kind: {
    type: DataTypes.ENUM('quote', 'invoice', 'tax_invoice', 'contract', 'nda',
                          'proposal', 'sow', 'meeting_note', 'sop', 'custom'),
    allowNull: false,
  },
  title: { type: DataTypes.STRING(300), allowNull: false },
  status: {
    type: DataTypes.ENUM('draft', 'sent', 'viewed', 'accepted', 'rejected', 'signed', 'archived'),
    defaultValue: 'draft',
  },
  // form 모드 데이터 (key-value)
  form_data: { type: DataTypes.JSON, allowNull: true },
  // editor 모드 본문 (TipTap JSON)
  body_json: { type: DataTypes.JSON, allowNull: true },
  body_html: { type: DataTypes.TEXT('long'), allowNull: true },
  // 본문 검색용 추출 텍스트 (FULLTEXT 인덱스 후보)
  search_text: { type: DataTypes.TEXT, allowNull: true },
  // 자동 변환 PDF
  pdf_url: { type: DataTypes.STRING(500), allowNull: true },
  pdf_generated_at: { type: DataTypes.DATE, allowNull: true },
  // 연결 (선택적)
  client_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'clients', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'conversations', key: 'id' } },
  session_id: { type: DataTypes.BIGINT, allowNull: true },
  task_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'tasks', key: 'id' } },
  // Q bill 양방향 sync
  quote_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'quotes', key: 'id' } },
  invoice_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'invoices', key: 'id' } },
  // 공유
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  // N+43 — share_token 만료. NULL = 무제한. 만료 시 공개 endpoint 410 + 친절한 만료 페이지. revoke = share_token=NULL.
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
  viewed_at: { type: DataTypes.DATE, allowNull: true },
  signed_at: { type: DataTypes.DATE, allowNull: true },
  signature_data: { type: DataTypes.JSON, allowNull: true },
  // AI 추적
  ai_generated: { type: DataTypes.BOOLEAN, defaultValue: false },
  ai_model: { type: DataTypes.STRING(50), allowNull: true },
  ai_prompt: { type: DataTypes.TEXT, allowNull: true },
  // provenance(정보성 표시 전용) — 'cue'=Cue 대화형 실행. 권한/전이 로직 무접촉 display-only.
  created_via: { type: DataTypes.STRING(20), allowNull: true, defaultValue: null },
  // D4 #62 — 보안등급 (general/internal/confidential). general 외 외부공유(share_token) 차단.
  //   계약·NDA·제안서 등 민감 문서 외부 반출 게이트. 변경 = member 이상. 상향 시 share_token 무효화.
  security_level: {
    type: DataTypes.ENUM('general', 'internal', 'confidential'),
    allowNull: false,
    defaultValue: 'general',
  },
  // 메타
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  updated_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  archived_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'documents',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'kind', 'status'] },
    { fields: ['client_id'] },
    { fields: ['project_id'] },
    { fields: ['quote_id'] },
    { fields: ['invoice_id'] },
    { unique: true, fields: ['share_token'], name: 'documents_share_token_unique' },
    { fields: ['template_id'] },
  ],
});

module.exports = Document;
