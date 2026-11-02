// HistoryOverride — 자동 히스토리 한 줄에 사람이 고쳐 둔 «설명 줄».
//
// ★ 2026-11-02 (Irene: *"자동기록 히스토리를 수동으로 수정하고 싶어 … 자동생성이 다시 또 되면서 엉망이 안되게"*)
//   설계 docs/HISTORY_OVERRIDE_DESIGN.md (Fable 설계 판정).
//   원장(task_status_history 등)은 한 글자도 안 고친다 — 표시 글은 읽을 때마다 원장에서 다시 만들어지므로
//   고친 글은 여기 «원장 좌표»(source_table, source_id) 로 두고 services/historyOverrides 가 읽을 때 덧입힌다.
//   «원래대로» = 이 행 삭제. FK 없음(다형) — 원장 행이 지워져 고아가 되면 좌표가 안 맞아 영영 안 읽힌다(무해).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class HistoryOverride extends Model {}

HistoryOverride.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  /** 원장 좌표에서 도출한 워크스페이스 — 요청 값을 믿지 않는다 */
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  source_table: { type: DataTypes.STRING(32), allowNull: false },
  source_id: { type: DataTypes.BIGINT, allowNull: false },
  /** 사람이 고친 설명 줄(≤1000자) */
  note: { type: DataTypes.TEXT, allowNull: true },
  /** 예약 — 1차는 정책으로 막는다(이름은 객체 이름을 따라간다). 켜도 마이그레이션이 필요 없게 칸만 둔다 */
  title: { type: DataTypes.STRING(200), allowNull: true },
  edited_by: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize,
  tableName: 'history_overrides',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['source_table', 'source_id'], name: 'uq_hist_override' },
    { fields: ['business_id', 'source_table'], name: 'idx_hist_override_biz' },
  ],
});

module.exports = HistoryOverride;
