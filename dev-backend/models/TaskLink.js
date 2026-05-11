// TaskLink — 업무 간 관련 링크 (양방향 단일 row)
//
// 설계 원칙:
//   - 양방향 의미. A 와 B 가 연결되면 1 row 만 저장 (a < b 강제 정렬)
//   - 같은 워크스페이스 내 task 간만 연결 (라우트 레벨 검증)
//   - link_type 'related' 단일로 시작. 의존 관계 (blocks/blocked_by) 는 사용자 수요 확인 후 추가
//   - task 삭제 시 CASCADE — 양쪽 task 중 어느 한쪽이 사라지면 row 도 사라짐
//
// UNIQUE(task_a_id, task_b_id) — 중복 방지. 라우트에서 a < b 정렬 후 insert
//
// AuditLog 는 라우트 레벨에서 link_added / link_removed 기록.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskLink extends Model {}

TaskLink.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  task_a_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'CASCADE',
  },
  task_b_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'CASCADE',
  },
  link_type: {
    type: DataTypes.ENUM('related'),
    allowNull: false, defaultValue: 'related',
  },
  created_by: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'task_links',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  underscored: true,
  indexes: [
    { fields: ['task_a_id'] },
    { fields: ['task_b_id'] },
    { fields: ['task_a_id', 'task_b_id'], unique: true },
  ],
});

module.exports = TaskLink;
