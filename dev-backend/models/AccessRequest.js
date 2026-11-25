// AccessRequest — 못 보는 자료의 «열람 요청» (2026-11-25, Irene «보안상 못 보는 거 표시 … 열람요청하기» → «권고대로» · 설계 docs/FILE_SEARCH_DISCOVERY_DESIGN.md §3)
//
// ★ 승인된 행 자체가 «그 사람 · 그 항목 하나» 의 열람 권한이다 — 항목의 공개 범위(vlevel·target_member_ids·project)는 바꾸지 않는다.
//   (설계는 target_member_ids 추가였으나, 프로젝트 L2 파일·문서의 단건 술어는 target_member_ids 를 안 봐서 승인해도 안 열린다 —
//    실측 access_scope.canAccessFileByLevel. 그래서 권한 판정 한 곳 services/accessGrants 가 이 표를 본다. 회수 = status 'revoked'.)
// ★ 상태: pending → approved | denied | expired(14일) | canceled(요청자가 취소) · approved → revoked.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class AccessRequest extends Model {}

AccessRequest.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  entity_type: { type: DataTypes.ENUM('file', 'post'), allowNull: false },
  entity_id: { type: DataTypes.INTEGER, allowNull: false },
  requester_id: { type: DataTypes.INTEGER, allowNull: false },
  // 받은 사람(알림을 보낸 사람) — 올린 사람·작성자, 비활성이면 NULL(대표·관리자 전원이 받는다)
  approver_id: { type: DataTypes.INTEGER, allowNull: true },
  status: { type: DataTypes.ENUM('pending', 'approved', 'denied', 'expired', 'canceled', 'revoked'), allowNull: false, defaultValue: 'pending' },
  message: { type: DataTypes.STRING(300), allowNull: true },
  decided_by: { type: DataTypes.INTEGER, allowNull: true },
  decided_at: { type: DataTypes.DATE, allowNull: true },
  decision_note: { type: DataTypes.STRING(300), allowNull: true },
}, {
  sequelize, tableName: 'access_requests', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'requester_id', 'entity_type', 'status'], name: 'access_requests_requester' },
    { fields: ['business_id', 'entity_type', 'entity_id', 'status'], name: 'access_requests_entity' },
    { fields: ['business_id', 'approver_id', 'status'], name: 'access_requests_approver' },
  ],
});

module.exports = AccessRequest;
