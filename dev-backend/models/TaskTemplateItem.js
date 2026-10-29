// 업무 템플릿 아이템 — 템플릿 안의 개별 task 정의 (사이클 N+1).
// 적용 시점에 task.start_date = 시작일 + start_offset_days.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskTemplateItem extends Model {}

TaskTemplateItem.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  template_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'task_templates', key: 'id' },
    onDelete: 'CASCADE',
  },
  order_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  title: { type: DataTypes.STRING(500), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  // NULL = 날짜 없는 업무(적용 때 시작·마감 없이 만든다). 둘은 같이 NULL 이거나 같이 값이다.
  start_offset_days: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: '템플릿 시작일 +N (NULL = 날짜 없음)',
  },
  duration_days: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 1,
    comment: '마감 = 시작 + N일 (0 = 시작일에 마감, NULL = 날짜 없음)',
  },
  estimated_hours: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: true,
  },
  priority: {
    type: DataTypes.ENUM('urgent', 'high', 'normal', 'low'),
    defaultValue: 'normal',
  },
  role_hint: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '디자이너 / 백엔드 — 적용 시 멤버 매핑',
  },
  workstream_title: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '추진과제(그룹) 이름 — 적용 시 같은 이름 그룹에 넣는다(없으면 만든다)',
  },
  // ─── 디테일 (2026-10-29, docs/TASK_TEMPLATE_DETAIL_DESIGN.md) — 운영 스키마 scripts/migrate-task-template-details.js ───
  body: { type: DataTypes.TEXT('long'), allowNull: true, comment: '업무 본문(결과물·실행 지침) HTML 원문' },
  is_milestone: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  category: { type: DataTypes.STRING(100), allowNull: true },
  // 공개 범위 — 승계하되 넓히지 않는다. L1(나만 보기)은 저장하지 않는다(템플릿이 전 멤버에게 보이므로).
  vlevel: { type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'), allowNull: false, defaultValue: 'L3' },
  security_level: { type: DataTypes.ENUM('general', 'internal', 'confidential'), allowNull: false, defaultValue: 'general' },
  recurrence_rule: { type: DataTypes.STRING(500), allowNull: true },
  tag_names: { type: DataTypes.JSON, allowNull: true, comment: '태그 이름 배열 — 적용 때 같은 워크스페이스에 있는 태그만 연결' },
  action_items: { type: DataTypes.JSON, allowNull: true, comment: '결과물 액션 계획 [{kind,label,note}]' },
  depends_on_indexes: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: '같은 템플릿 안 다른 item 의 order_index 배열',
  },
}, {
  sequelize,
  tableName: 'task_template_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['template_id', 'order_index'] },
  ],
});

module.exports = TaskTemplateItem;
