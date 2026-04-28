const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Conversation extends Model {}

Conversation.init({
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
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('active', 'archived'),
    defaultValue: 'active'
  },
  last_message_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── Cue 제어 ───
  // 이 대화방에서 Cue 활동 여부 (사람이 명시적으로 멈추면 false)
  cue_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  // 사람이 타이핑 중일 때 해당 턴 스킵용 임시 억제 타임스탬프
  cue_suppressed_until: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 고객 히스토리 자동 요약 마지막 갱신 시점
  last_ai_summary_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── Phase 5 프로젝트 중심 확장 ───
  project_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  channel_type: {
    type: DataTypes.ENUM('customer', 'internal', 'group'),
    defaultValue: 'internal'
  },
  display_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  auto_extract_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  last_extracted_message_id: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  last_extracted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  extraction_in_progress_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // 번역 표시 — 토글 ON 시 발송 시점부터 신규 메시지만 자동 번역 (Q note 패턴).
  // 과거 메시지는 번역 안 함 (단순 정책).
  translation_enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  // 정확히 2-원소 배열, 서로 다른 언어. 예: ["ko","en"]
  translation_languages: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  sequelize,
  tableName: 'conversations',
  timestamps: true,
  underscored: true
});

module.exports = Conversation;
