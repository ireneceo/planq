// Q record — 동적 테이블 (Notion DB 패턴) 메타.
// project_id NULL = 워크스페이스 전역, NOT NULL = 프로젝트 소속.
// columns JSON — 사용자 정의 컬럼 배열. 각: { id, name, type, options?, order }.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class QRecord extends Model {}

QRecord.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  project_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'projects', key: 'id' } },
  name: { type: DataTypes.STRING(200), allowNull: false },
  category: { type: DataTypes.STRING(80), allowNull: true },
  description: { type: DataTypes.STRING(500), allowNull: true },
  // 컬럼 스키마 — 동적 추가/이름변경/타입변경 가능
  // [{ id: "c1", name: "회사명", type: "text", order: 0 }, ...]
  // 지원 타입: text, longtext, number, date, datetime, checkbox, url, email, phone, select, multi_select, secret
  columns: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  // 워크스페이스 단위 read 정책 — all (모든 멤버) | owner (owner+admin 만)
  read_policy: { type: DataTypes.ENUM('all', 'owner'), allowNull: false, defaultValue: 'all' },
  // N+68 — 4단계 visibility 통합 (VISIBILITY_VOCABULARY.md). hook 가 read_policy + project_id 와 양방향 동기.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
  target_member_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  sequelize, tableName: 'q_records', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'project_id'] },
    { fields: ['business_id', 'category'] },
    { fields: ['business_id', 'vlevel'], name: 'q_records_biz_vlevel' },
  ],
});

// N+68 — vlevel ↔ read_policy/project_id 양방향 동기 (옛 라우트도 자동 정합)
// project_id → L2-project / read_policy='owner' → L2-members / 그 외 L3
QRecord.addHook('beforeSave', (r) => {
  if (r.vlevel) {
    if (r.vlevel === 'L1') r.read_policy = 'owner';
    else if (r.vlevel === 'L2' && r.target_member_ids) r.read_policy = 'owner';
    else r.read_policy = 'all';
  } else {
    if (r.project_id) r.vlevel = 'L2';
    else if (r.read_policy === 'owner') r.vlevel = 'L2';
    else r.vlevel = 'L3';
  }
});

module.exports = QRecord;
