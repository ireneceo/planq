// ClientStageHistory — Q sale 영업 단계 전이 이력 (docs/Q_SALE_DESIGN.md §3.2, project_status_history 패턴)
//   단계가 바뀌는 모든 경로는 services/salesStage.js setStage 한 곳을 지난다 — 이 테이블은 거기서만 쓴다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ClientStageHistory extends Model {}

ClientStageHistory.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  client_id: { type: DataTypes.INTEGER, allowNull: false },
  from_stage: { type: DataTypes.STRING(20), allowNull: true },
  to_stage: { type: DataTypes.STRING(20), allowNull: false },
  origin: { type: DataTypes.ENUM('manual', 'auto'), allowNull: false },
  changed_by: { type: DataTypes.INTEGER, allowNull: true, comment: 'auto 면 NULL' },
  reason: { type: DataTypes.STRING(500), allowNull: true },
  source_ref: { type: DataTypes.JSON, allowNull: true, comment: 'auto 근거: {project_id, stage_id, signature_request_id, post_id}' },
}, {
  sequelize,
  tableName: 'client_stage_history',
  timestamps: true, underscored: true, updatedAt: false,
  indexes: [
    { fields: ['business_id', 'client_id', 'created_at'], name: 'idx_client_stage_changed' },
  ],
});

module.exports = ClientStageHistory;
