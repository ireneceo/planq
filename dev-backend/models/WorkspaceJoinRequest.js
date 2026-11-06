// WorkspaceJoinRequest — 워크스페이스 참여 신청 (2026-11-06 · docs/SIGNUP_START_JOIN_DESIGN.md §5, Fable 설계)
//   사람 × 워크스페이스 **한 행**(UNIQUE). 재신청은 같은 행을 pending 으로 되돌린다.
//   «만료» 는 상태가 아니라 pending ∧ expires_at < 지금 — 판정은 services/joinRequests.isLive 한 함수.
//   운영 표·칸은 scripts/migrate-join-requests.js(배포 슬롯 — 모델보다 먼저).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class WorkspaceJoinRequest extends Model {}

WorkspaceJoinRequest.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
  source: { type: DataTypes.ENUM('domain', 'code'), allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'approved', 'rejected', 'canceled'), allowNull: false, defaultValue: 'pending' },
  message: { type: DataTypes.STRING(300), allowNull: true },
  requested_at: { type: DataTypes.DATE, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  decided_at: { type: DataTypes.DATE, allowNull: true },
  decided_by: { type: DataTypes.INTEGER, allowNull: true },
  decision_note: { type: DataTypes.STRING(300), allowNull: true },
  retry_after: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, tableName: 'workspace_join_requests', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'user_id'], name: 'uq_join_req_biz_user' },
    { fields: ['business_id', 'status'], name: 'idx_join_req_biz_status' },
    { fields: ['user_id'], name: 'idx_join_req_user' },
  ],
});

module.exports = WorkspaceJoinRequest;
