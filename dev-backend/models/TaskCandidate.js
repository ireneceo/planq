const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskCandidate extends Model {}

TaskCandidate.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  // 독립 대화 + (N+87 Phase B) 메일 스레드 후보 지원 → conversation_id nullable.
  //   스코프 = conversation_id OR email_thread_id (택일).
  project_id: { type: DataTypes.BIGINT, allowNull: true },
  conversation_id: { type: DataTypes.INTEGER, allowNull: true },
  email_thread_id: { type: DataTypes.INTEGER, allowNull: true }, // N+87 — 메일 스레드 후보
  extracted_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  extracted_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  source_message_ids: { type: DataTypes.JSON, allowNull: true },  // 채팅 메시지 id (email 이면 null)
  source_email_message_ids: { type: DataTypes.JSON, allowNull: true }, // N+87 — 메일 메시지 id
  title: { type: DataTypes.STRING(300), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  guessed_role: { type: DataTypes.STRING(50), allowNull: true },
  guessed_assignee_user_id: { type: DataTypes.INTEGER, allowNull: true },
  guessed_due_date: { type: DataTypes.DATEONLY, allowNull: true },
  similar_task_id: { type: DataTypes.INTEGER, allowNull: true },
  recurrence_hint: { type: DataTypes.STRING(20), allowNull: true },
  status: {
    type: DataTypes.ENUM('pending', 'registered', 'merged', 'rejected'),
    defaultValue: 'pending',
  },
  registered_task_id: { type: DataTypes.INTEGER, allowNull: true },
  resolved_at: { type: DataTypes.DATE, allowNull: true },
  resolved_by_user_id: { type: DataTypes.INTEGER, allowNull: true },
  // N+36 옵션 D — 만료 정책. 30일 이전 pending 후보는 cron 이 hidden_at 마크 (기본 list 에서 숨김).
  // 90일 이전 + status='rejected' 또는 hidden_at>60일 → cron 이 hard delete.
  // "이전 후보 보기" 토글로 hidden_at 무관 회복 가능.
  hidden_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'task_candidates',
  timestamps: false,
  underscored: true,
});

module.exports = TaskCandidate;
