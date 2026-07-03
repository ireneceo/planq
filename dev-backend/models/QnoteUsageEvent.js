// Q Note STT 과금 멱등 원장 (C1)
// q-note live.py 가 5분마다 세션 세그먼트를 POST /api/internal/qnote/usage 로 기록.
// UNIQUE(stream_id, segment_seq) — HTTP 재시도 이중집계 차단.
//   stream_id 는 WS 연결마다 UUID (세션 아님). 재연결(모바일 네트워크 끊김)해도 새 stream_id 라
//   충돌·유실 없음. session_id 기준이면 재연결마다 seq=0 리셋 → 최초 1회만 집계되는 quota 우회 구멍.
// session_id 는 q-note SQLite 소재 → MySQL FK 안 검음 (일반 INT 컬럼).
// 설계: docs/QNOTE_STT_BILLING_DESIGN.md §3.1
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class QnoteUsageEvent extends Model {}

QnoteUsageEvent.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  stream_id: { type: DataTypes.STRING(36), allowNull: false },   // WS 연결마다 UUID
  segment_seq: { type: DataTypes.INTEGER, allowNull: false },     // 연결 내 flush 순번 0,1,2,…
  session_id: { type: DataTypes.INTEGER, allowNull: false },      // q-note 세션(SQLite) — FK 없음
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  seconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },  // billed 초 (stereo 반영)
  is_stereo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  sequelize,
  tableName: 'qnote_usage_events',
  timestamps: true,
  updatedAt: false,          // 원장은 append-only — updated_at 불필요
  underscored: true,
  indexes: [
    { unique: true, fields: ['stream_id', 'segment_seq'] },
    { fields: ['business_id', 'created_at'] },
  ],
});

module.exports = QnoteUsageEvent;
