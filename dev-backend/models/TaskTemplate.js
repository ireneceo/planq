// 업무 템플릿 — 재사용 가능한 업무 일정 묶음 (사이클 N+1).
// is_system=true & business_id=NULL → 시스템 preset (10종 시드).
// is_system=false & business_id=N → 워크스페이스 사용자 템플릿.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskTemplate extends Model {}

TaskTemplate.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'businesses', key: 'id' },
    onDelete: 'CASCADE',
    comment: 'NULL = 시스템 preset',
  },
  name: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  category: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'web_dev / marketing / sales / ops / custom',
  },
  is_default: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '워크스페이스 기본 템플릿 (자동 추천)',
  },
  is_system: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '시스템 preset 여부 (편집 불가)',
  },
  total_duration_days: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '자동 계산 — 가장 늦은 due_offset',
  },
  task_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '자동 계산 — items 갯수',
  },
  usage_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'apply 호출 누적',
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  // 추진과제(그룹) 목록 — 프로젝트에서 저장할 때의 순서·색. 항목은 workstream_title 로 이 이름을 가리킨다.
  //   적용하면 같은 이름 그룹을 찾아 쓰고 없으면 이 순서대로 만든다(services/templateApply). [{title, color, description}]
  workstreams: { type: DataTypes.JSON, allowNull: true },
  // 저장한 원본 프로젝트(옛 날짜 0 템플릿을 나중에 복구할 근거 — 2026-10-29, 지금은 저장만)
  source_project_id: { type: DataTypes.INTEGER, allowNull: true },
  embedding: {
    type: DataTypes.BLOB,
    allowNull: true,
    comment: 'name+description+item titles 의 text-embedding-3-small 벡터 (AI 추천 매칭용)',
  },
}, {
  sequelize,
  tableName: 'task_templates',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['business_id', 'category'] },
    { fields: ['is_system'] },
  ],
});

module.exports = TaskTemplate;
