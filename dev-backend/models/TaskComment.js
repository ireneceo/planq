const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskComment extends Model {}

TaskComment.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE' },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
  content: { type: DataTypes.TEXT, allowNull: false },
  // 공개 범위 — project_notes 와 동일한 ENUM 사용 (메모·댓글 통일)
  //  personal  작성자 본인만
  //  internal  내부 멤버 전원 (고객 제외)
  //  shared    내부 + 관련 고객 (client reviewer 또는 project_clients)
  visibility: {
    type: DataTypes.ENUM('personal', 'internal', 'shared'),
    allowNull: false,
    defaultValue: 'internal',
  },
  // N+67 — 4단계 visibility 통합 (VISIBILITY_VOCABULARY.md 정합)
  // personal→L1 / internal→L3 / shared→L4 매핑. L2 (특정 멤버) 도 신규 지원.
  vlevel: {
    type: DataTypes.ENUM('L1', 'L2', 'L3', 'L4'),
    allowNull: true,
    defaultValue: null,
  },
  target_member_ids: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
  },
  // 컨펌자가 승인/수정요청 시 자동 생성된 시스템 댓글인지
  kind: {
    type: DataTypes.ENUM('user', 'system_revision', 'system_approve'),
    allowNull: false,
    defaultValue: 'user',
  },
}, {
  sequelize,
  tableName: 'task_comments',
  timestamps: true,
  underscored: true,
});

// N+67 — vlevel ↔ visibility 양방향 동기
TaskComment.addHook('beforeSave', (c) => {
  if (c.vlevel) {
    c.visibility = c.vlevel === 'L1' ? 'personal' : c.vlevel === 'L4' ? 'shared' : 'internal';
  } else {
    c.vlevel = c.visibility === 'personal' ? 'L1' : c.visibility === 'shared' ? 'L4' : 'L3';
  }
});

module.exports = TaskComment;
