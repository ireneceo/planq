// ClientInteraction — Q sale 상담 원장 (docs/Q_SALE_DESIGN.md §3.3)
//   채팅·메일·업무·일정·청구는 원본 테이블이 있어 타임라인이 실시간으로 읽는다.
//   원본 테이블이 **없는** 접점 — 전화·미팅 기록·방문·상담 메모 — 만 여기 쌓는다.
//   "확인" = origin='auto' AND reviewed_at IS NULL (새 읽음 컬럼 없음).
//   녹음 컬럼(qnote_session_id·file_id·stt_*)은 사이클 3 이 쓴다 — 스키마는 처음부터 둔다(운영 ALTER 한 번).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ClientInteraction extends Model {}

ClientInteraction.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  client_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.BIGINT, allowNull: true },
  calendar_event_id: { type: DataTypes.INTEGER, allowNull: true },
  kind: { type: DataTypes.ENUM('call', 'meeting', 'visit', 'memo', 'other'), allowNull: false },
  direction: { type: DataTypes.ENUM('inbound', 'outbound'), allowNull: true },
  // ★ 사용자가 정하는 접점 시각(기본 now). created_at 과 다르다 — 어제 통화를 오늘 적을 수 있다
  occurred_at: { type: DataTypes.DATE, allowNull: false },
  duration_seconds: { type: DataTypes.INTEGER, allowNull: true },
  title: { type: DataTypes.STRING(200), allowNull: true },
  body: { type: DataTypes.TEXT, allowNull: true, comment: '사람이 쓴 메모 원문' },
  summary: { type: DataTypes.TEXT, allowNull: true },
  key_points: { type: DataTypes.JSON, allowNull: true },
  origin: { type: DataTypes.ENUM('manual', 'auto'), allowNull: false, defaultValue: 'manual' },
  source_kind: {
    type: DataTypes.ENUM('manual', 'qnote', 'guest_link', 'email', 'chat', 'calendar'),
    allowNull: false, defaultValue: 'manual',
  },
  reviewed_at: { type: DataTypes.DATE, allowNull: true, comment: 'origin=auto 인데 NULL = 미확인' },
  reviewed_by: { type: DataTypes.INTEGER, allowNull: true },
  qnote_session_id: { type: DataTypes.INTEGER, allowNull: true, comment: 'q-note SQLite — FK 없음' },
  file_id: { type: DataTypes.INTEGER, allowNull: true },
  stt_status: {
    type: DataTypes.ENUM('none', 'uploading', 'processing', 'completed', 'failed'),
    allowNull: false, defaultValue: 'none',
  },
  stt_error: { type: DataTypes.STRING(300), allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
  deleted_at: { type: DataTypes.DATE, allowNull: true },
  deleted_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'client_interactions',
  timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'client_id', 'occurred_at'], name: 'idx_ci_client_occurred' },
    { fields: ['business_id', 'origin', 'reviewed_at'], name: 'idx_ci_review' },
    { fields: ['qnote_session_id'], name: 'idx_ci_qnote_session' },
  ],
});

module.exports = ClientInteraction;
