// TaskUserOrder — 사람별·보기별 업무 순서(직접 정렬). 설계 docs/TASK_USER_ORDER_DESIGN.md (Fable 2026-10-12, 보기 축 추가 2026-10-12)
//
//   tasks.priority_order 는 업무 전역 칸 하나라 끌어 옮기기에 쓰면 동료 순서까지 바뀐다.
//   순서는 사람마다, **보기(태그별·프로젝트별·마감일별)마다** 갖는다 → (user, task, view_key) 한 행.
//   Irene: "태그별로 그룹핑된 상태에서 순서 달라야" — 한 벌을 모든 보기가 나눠 쓰면 태그별에서 옮긴 것이 마감일별까지 흔든다.
//   pos 는 정수 간격(GAP 65536), 간격이 닳으면 그 (user, biz, view) 를 재배치.
//   쓰는 문은 services/taskUserOrder.js 하나다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskUserOrder extends Model {}

TaskUserOrder.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE' },
  // 보기 — services/taskUserOrder.VIEWS 가 정본(tag·project·due). ENUM 이 아닌 이유: 보기가 늘 때 운영 ALTER 없이 받으려고.
  view_key: { type: DataTypes.STRING(16), allowNull: false },
  pos: { type: DataTypes.BIGINT, allowNull: false },
}, {
  sequelize,
  tableName: 'task_user_orders',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true,
  indexes: [
    { name: 'uk_tuo_user_task_view', fields: ['user_id', 'task_id', 'view_key'], unique: true },
    { name: 'idx_tuo_biz_user_view_pos', fields: ['business_id', 'user_id', 'view_key', 'pos'] },
  ],
});

module.exports = TaskUserOrder;
