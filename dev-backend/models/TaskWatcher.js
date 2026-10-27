// 업무 참조자 (멀티) — 2026-10-27 Irene «컨펌은 아닌데 알아야 하거나 일부 도와줘야 하는 사람».
// 상태가 없다 — 승인 흐름(task_reviewers·review_policy)에 섞이지 않는다.
// 볼 권한은 «이름 박힌 사람»(access_scope.isNamedOnTask) · 할 수 있는 것은 보기·댓글·첨부뿐.
// 1차는 내부 멤버만(고객·외부 파트너·AI 제외) — Fable 설계 판정 2026-10-27.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskWatcher extends Model {}

TaskWatcher.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'CASCADE',
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  added_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'task_watchers',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['task_id', 'user_id'] },
    { fields: ['user_id'] },
  ],
});

module.exports = TaskWatcher;
