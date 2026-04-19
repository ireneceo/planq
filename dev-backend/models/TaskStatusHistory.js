// 업무 상태/액션 히스토리.
// 상세 화면 하단 타임라인에 시간순으로 표시.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskStatusHistory extends Model {}

TaskStatusHistory.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'tasks', key: 'id' },
    onDelete: 'CASCADE',
  },
  // 액션 유형
  //   created          업무 생성
  //   status_change    단계 자동/수동 전환
  //   ack              담당자 요청확인
  //   review_submit    담당자 컨펌 요청 (라운드 시작)
  //   review_cancel    담당자 컨펌 요청 취소
  //   approve          컨펌자 승인
  //   revision         컨펌자 수정요청
  //   revert           컨펌자 본인 되돌리기
  //   reviewer_add     컨펌자 추가
  //   reviewer_remove  컨펌자 제거
  //   policy_change    정책 변경
  //   done_feedback    완료 피드백 전환
  //   completed        담당자 최종 완료
  event_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  from_status: { type: DataTypes.STRING(30), allowNull: true },
  to_status: { type: DataTypes.STRING(30), allowNull: true },
  actor_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  actor_role: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'assignee | requester | reviewer | owner | system',
  },
  target_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '컨펌자 추가/제거 이벤트에서 대상',
  },
  round: { type: DataTypes.INTEGER, allowNull: true },
  note: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  tableName: 'task_status_history',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { fields: ['task_id', 'created_at'] },
  ],
});

module.exports = TaskStatusHistory;
