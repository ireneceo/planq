// TaskUserOrder — 사람별 업무 순서(«내 순서»). 설계 docs/TASK_USER_ORDER_DESIGN.md (Fable 2026-10-12)
//
//   tasks.priority_order 는 업무 전역 칸 하나라 끌어 옮기기에 쓰면 동료 순서까지 바뀐다.
//   순서는 사람마다 갖는다 → (user, task) 한 행. pos 는 정수 간격(GAP 65536), 간격이 닳으면 재배치.
//   쓰는 문은 services/taskUserOrder.js 하나다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskUserOrder extends Model {}

TaskUserOrder.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE' },
  pos: { type: DataTypes.BIGINT, allowNull: false },
}, {
  sequelize,
  tableName: 'task_user_orders',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  underscored: true,
  indexes: [
    { name: 'uk_tuo_user_task', fields: ['user_id', 'task_id'], unique: true },
    { name: 'idx_tuo_biz_user_pos', fields: ['business_id', 'user_id', 'pos'] },
  ],
});

module.exports = TaskUserOrder;
