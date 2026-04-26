const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Message extends Model {}

Message.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'conversations', key: 'id' }
  },
  sender_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'tasks', key: 'id' }
  },
  invoice_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'invoices', key: 'id' }
  },
  // ─── 메시지 유형 ───
  // text: 일반 / system: 자동 상태 안내 / card: task/invoice/event 인라인 카드
  kind: {
    type: DataTypes.ENUM('text', 'system', 'card'),
    defaultValue: 'text',
    allowNull: false
  },
  // ─── Cue 메타 ───
  is_ai: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  ai_confidence: {
    type: DataTypes.DECIMAL(4, 3),
    allowNull: true
  },
  ai_source: {
    type: DataTypes.ENUM('pinned_faq', 'kb_rag', 'session_reuse', 'general'),
    allowNull: true
  },
  ai_sources: {
    type: DataTypes.JSON,
    allowNull: true
  },
  ai_model: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  ai_mode_used: {
    type: DataTypes.ENUM('auto', 'draft'),
    allowNull: true
  },
  // Draft 승인 상태 (draft 만 해당). null=승인 전, true=발송됨, false=거절됨
  ai_draft_approved: {
    type: DataTypes.BOOLEAN,
    allowNull: true
  },
  ai_draft_approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  ai_draft_approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── 카드 메시지 메타 (kind='card' 일 때 사용) ───
  // { card_type: 'post' | 'task' | 'invoice' | ..., 그 외 카드별 필드 }
  meta: {
    type: DataTypes.JSON,
    allowNull: true
  },
  // ─── 내부 메모 (고객에겐 안 보임) ───
  is_internal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  // ─── 수정/삭제 ───
  is_edited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  edited_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── Phase 5 답글 + Cue Draft 잠금 ───
  reply_to_message_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  cue_draft_processing_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  cue_draft_processing_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'messages',
  timestamps: true,
  underscored: true
});

module.exports = Message;
