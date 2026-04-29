// TaskEstimation — 업무 예측시간 이력 (AI 추천 + 사용자 확정).
// 한 task 의 예측시간이 시점별로 어떻게 변경됐는지 보존 → 추후 AI 정확도 분석·정밀도 향상.
// 정책:
//   - source='ai': LLM 추천값. task 생성 시 + title/description 변경 시 (debounce) 1건 생성.
//   - source='user': 사용자가 input 에 직접 저장한 값. tasks.estimated_hours 와 동기.
//   - actual_hours 는 task 본체에 저장 (이 테이블엔 estimated 만).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskEstimation extends Model {}

TaskEstimation.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'CASCADE',
  },
  value: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: false,
    comment: '예측 시간 (시간 단위, 0.25 단위)',
  },
  source: {
    type: DataTypes.ENUM('ai', 'user'),
    allowNull: false,
  },
  model: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'AI 모델명 (source=ai 일 때) — 예: gpt-4o-mini',
  },
  created_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    comment: 'source=user 일 때 누가 확정했는지',
  },
}, {
  sequelize,
  tableName: 'task_estimations',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['task_id', 'created_at'] },
    { fields: ['task_id', 'source'] },
  ],
});

module.exports = TaskEstimation;
