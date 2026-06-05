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
  // N+87 Phase B — 메일 스레드에서 추출된 업무 (Q Mail ↔ Q Task 통합)
  email_thread_id: { type: DataTypes.INTEGER, allowNull: true },
  source_email_message_id: { type: DataTypes.INTEGER, allowNull: true },
  // N+88 — Q Note 세션에서 추출된 업무 (Q Note ↔ Q Task 브릿지, cross-DB 역참조)
  qnote_session_id: { type: DataTypes.INTEGER, allowNull: true },
  title: {
    type: DataTypes.STRING(300),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  // 결과물 — 리치 HTML (TipTap). 업무 완료 시 산출물 본문
  body: {
    type: DataTypes.TEXT('long'),
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
  // ─── 사이클 P8 — Cue 팀원화 ───
  // assignee_id 가 워크스페이스의 Cue 사용자(is_ai=true) 면 자동 실행.
  // cue_kind 가 정의된 종류 → cue_orchestrator 호출 → 결과물 task.body 에 저장 + status=reviewing
  // null 이거나 unknown → status=blocked (사용자가 무엇을 시킬지 명세 보강 필요)
  cue_kind: {
    type: DataTypes.ENUM('summarize', 'draft_reply', 'categorize', 'research'),
    allowNull: true,
    defaultValue: null,
  },
  // Cue 가 결과물 만들면 어디서 가져올 컨텍스트인지 — task 가 직접 들고있는 자료 ID
  cue_context_ref: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: null,
    comment: 'e.g. {meeting_id, conversation_id, kb_doc_ids, post_ids}',
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
  // 'auto' (status 전환 시간 자동 누적) vs 'user' (사용자 직접 입력 — 자동 누적 정지). 사이클 N+6.
  actual_source: {
    type: DataTypes.ENUM('auto', 'user'),
    defaultValue: 'auto',
    allowNull: false,
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
  },
  // ─── 정기업무 (recurring task) ───
  // RRULE 표준 문자열 (예: 'FREQ=WEEKLY;BYDAY=MO;COUNT=10').
  // 시리즈의 "원본"(parent)에만 채워짐. 자동 생성된 인스턴스는 null.
  recurrence_rule: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  // 시리즈 parent task id. 본인이 parent 면 자기 id, 자동 생성된 인스턴스면 parent id.
  // 시리즈 추적 + "이 시리즈의 모든 향후 인스턴스 수정/삭제" 동작 지원.
  recurrence_parent_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'tasks', key: 'id' },
  },
  // cron generator 가 다음 인스턴스를 생성할 마감일. parent 의 다음 occurrence date.
  // 종료 조건 (COUNT/UNTIL) 도달 시 null.
  next_occurrence_at: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  // 공유 링크 (사이클 N+4 — 통합 공유 시스템)
  // share_token NOT NULL 이면 /public/tasks/:token 미리보기 가능. NULL 이면 공유 비활성.
  share_token: { type: DataTypes.STRING(64), allowNull: true },
  shared_at: { type: DataTypes.DATE, allowNull: true },
  share_password_hash: { type: DataTypes.STRING(255), allowNull: true },
  share_expires_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  tableName: 'tasks',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['share_token'], name: 'tasks_share_token_unique' },
  ],
});

module.exports = Task;
