// TaskTagLink — task ↔ task_tags M:N (#250 ③청크)
//
// ★ 조회 시 belongsToMany include 를 쓰지 말 것. `findAndCountAll` + limit 과 조합하면
//   count 가 조인 행 수로 오염되고 Sequelize 가 subquery 를 끼워 예측 불가가 된다
//   (all-tasks 는 default 500 pagination 라우트다). **task_id IN (...) 배치 2차 쿼리 후 머지**
//   패턴을 쓴다 — routes/task_tags.js `attachTagsTo()` 가 정본이다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskTagLink extends Model {}

TaskTagLink.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // onDelete 를 attribute 에도 명시 — sync alter 가 FK 를 재생성해도 CASCADE 가 보존된다.
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE' },
  tag_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'task_tags', key: 'id' }, onDelete: 'CASCADE' },
}, {
  sequelize, tableName: 'task_tag_links', timestamps: true, underscored: true,
  indexes: [
    { unique: true, fields: ['task_id', 'tag_id'], name: 'task_tag_links_unique' },
    // 위와 같은 이유로 name 명시 — DDL(scripts/migrate-task-tags.js)과 문자 그대로 같아야 한다.
    { fields: ['tag_id'], name: 'task_tag_links_tag' },
  ],
});

module.exports = TaskTagLink;
