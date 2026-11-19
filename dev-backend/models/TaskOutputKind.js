// TaskOutputKind — 워크스페이스 업무 «산출물» 사전 (docs/TASK_DELIVERABLES_DESIGN.md §2)
//
//   «이 업무가 만들어야 하는 것의 종류»(제안서·디자인 시안 …). 결과물(tasks.body·task_deliverable_versions =
//   만든 내용)과 다르다 — 그래서 코드 이름은 `output_kind`, `deliverable` 을 쓰지 않는다.
//   preset_key 가 있으면 기본 항목(정본 services/taskOutputKindPresets.js — 보는 사람 언어로 보인다),
//   NULL 이면 직접 입력 항목. 기본 항목 행은 처음 고를 때 생긴다(미리 넣지 않는다).
//   ★ 인덱스 name 명시 — DDL(scripts/migrate-task-output-kinds.js)과 글자까지 같게(TaskTag F3 교훈).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskOutputKind extends Model {}

TaskOutputKind.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  name: { type: DataTypes.STRING(40), allowNull: false },
  preset_key: { type: DataTypes.STRING(40), allowNull: true, defaultValue: null },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  sequelize, tableName: 'task_output_kinds', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['business_id', 'name'], name: 'task_output_kinds_biz_name_unique' },
    { unique: true, fields: ['business_id', 'preset_key'], name: 'task_output_kinds_biz_preset_unique' },
  ],
});

module.exports = TaskOutputKind;
