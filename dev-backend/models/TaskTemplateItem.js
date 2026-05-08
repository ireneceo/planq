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
  start_offset_days: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '템플릿 시작일 +N',
  },
  duration_days: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '소요 일수',
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
