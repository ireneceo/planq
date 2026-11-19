// TaskOutputKindLink — task ↔ 산출물 M:N (docs/TASK_DELIVERABLES_DESIGN.md §2.4)
//
// ★ 조회에 belongsToMany include 를 쓰지 않는다 — services/taskOutputKinds.js `attachOutputKindsTo()` 배치 머지가 정본.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskOutputKindLink extends Model {}

TaskOutputKindLink.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE' },
  output_kind_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'task_output_kinds', key: 'id' }, onDelete: 'CASCADE' },
}, {
  sequelize, tableName: 'task_output_kind_links', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['task_id', 'output_kind_id'], name: 'task_output_kind_links_unique' },
    { fields: ['output_kind_id'], name: 'task_output_kind_links_kind' },
  ],
});

module.exports = TaskOutputKindLink;
