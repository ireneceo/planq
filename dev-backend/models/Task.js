const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Task extends Model {}

Task.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  business_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'businesses', key: 'id' }
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'conversations', key: 'id' }
  },
  source_message_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'messages', key: 'id' }
  },
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  assignee_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'clients', key: 'id' }
  },
  status: {
    // 메인 상태 (단일 포커스). 각 컨펌자의 상태는 task_reviewers.state 에 별도 추적.
    //  not_started     — 미진행
    //  waiting         — 진행대기 (기간 도래) — 조회 시점에 on-the-fly 로도 계산
    //  in_progress     — 진행중 (진행률 > 0)
    //  reviewing       — 컨펌중 (담당자가 컨펌 요청 보낸 상태)
    //  revision_requested — 수정요청 (컨펌자 중 1명이라도 revision)
    //  done_feedback   — 완료 피드백 (정책 충족) — 담당자 최종 완료 대기
    //  completed       — 담당자가 최종 완료 처리
    //  canceled        — 취소
    type: DataTypes.ENUM(
      'not_started', 'waiting', 'in_progress',
      'reviewing', 'revision_requested', 'done_feedback',
      'completed', 'canceled'
    ),
    defaultValue: 'not_started'
  },
  // ─── 컨펌 정책 + 라운드 ───
  review_policy: {
    type: DataTypes.ENUM('all', 'any'),
    defaultValue: 'all',
    comment: 'all: 전원 승인 / any: 1명이라도 승인',
  },
  review_round: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '컨펌 요청 라운드 번호. 담당자가 재제출할 때마다 +1',
  },
  // ─── 고객 컨펌 옵션 ───
  requires_client_review: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  client_share_custom: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'true 면 고객에게 별도 내용 공유, false 면 업무 내용 그대로',
  },
  client_share_content: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  // ─── 출처 (Q Talk / 내부요청 / 수동) ───
  source: {
    type: DataTypes.ENUM('manual', 'internal_request', 'qtalk_extract'),
    defaultValue: 'manual',
  },
  request_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    comment: '요청자 user_id. 수동 생성 시 null, 내부요청/qtalk 이면 요청자',
  },
  request_ack_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '담당자가 [요청 확인완료] 누른 시각',
  },
  priority_order: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'User-defined sort order (1=highest)',
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  // ─── 시간 추적 ───
  estimated_hours: {
    type: DataTypes.DECIMAL(5, 1),
    allowNull: true,
  },
  actual_hours: {
    type: DataTypes.DECIMAL(5, 1),
    defaultValue: 0,
  },
  progress_percent: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  planned_week_start: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Monday of the week this task is planned for',
  },
  category: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' }
  },
  from_candidate_id: {
    type: DataTypes.BIGINT,
    allowNull: true,
    references: { model: 'task_candidates', key: 'id' }
  }
}, {
  sequelize,
  tableName: 'tasks',
  timestamps: true,
  underscored: true
});

module.exports = Task;
