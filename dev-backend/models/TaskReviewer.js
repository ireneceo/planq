// 업무 컨펌자 (멀티).
// 한 업무에 여러 명의 컨펌자가 붙을 수 있고 각자 독립된 상태(pending/approved/revision)를 가진다.
// 업무의 review_policy 에 따라 전원 승인(all) 또는 1명 승인(any) 시 다음 단계로.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskReviewer extends Model {}

TaskReviewer.init({
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
  is_client: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'true: 고객 컨펌자, false: 내부 컨펌자',
  },
  state: {
    type: DataTypes.ENUM('pending', 'approved', 'revision'),
    defaultValue: 'pending',
    comment: '현재 라운드에서의 컨펌 상태',
  },
  // 이번 라운드에서 본인이 이미 한 번 되돌렸는지 (중복 되돌리기 방지)
  reverted_once: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  action_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '마지막 승인/수정요청 액션 시각',
  },
  added_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
}, {
  sequelize,
  tableName: 'task_reviewers',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['task_id', 'user_id'] },
    { fields: ['user_id', 'state'] },
  ],
});

module.exports = TaskReviewer;
