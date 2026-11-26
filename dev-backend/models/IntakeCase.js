// IntakeCase — 접수 양식(설문) 응답 1건 → 사건(프로젝트)·업무 (2026-11-26 · 설계 docs/INTAKE_AUTO_CASE_DESIGN.md §6, Fable DESIGN-CHANGE 반영)
//
// ★ q_record_row_id UNIQUE 가 멱등 키다 — [사건 만들기] 는 이 행을 INSERT 로 먼저 잡은 쪽만 진행한다(동시 두 번 클릭에 1건).
// ★ 응답 행이 지워져도 이 행은 남는다 — q_record_row_id 는 보존(외래키·SET NULL 없음), 화면은 «원 응답 삭제됨».
// ★ 단계: claimed → project_done(고객·프로젝트 한 트랜잭션) → tasks_done(템플릿 업무). error 면 같은 행을 다시 잡아 이어 간다.
// ★ 응답 값은 싣지 않는다(표의 감사 규칙과 같다) — 연결 id 와 단계만.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class IntakeCase extends Model {}

IntakeCase.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  q_record_id: { type: DataTypes.INTEGER, allowNull: false },
  q_record_row_id: { type: DataTypes.INTEGER, allowNull: false, unique: 'intake_cases_row_unique' },
  status: { type: DataTypes.ENUM('running', 'done', 'error'), allowNull: false, defaultValue: 'running' },
  step: { type: DataTypes.ENUM('claimed', 'project_done', 'tasks_done'), allowNull: false, defaultValue: 'claimed' },
  mode: { type: DataTypes.ENUM('review'), allowNull: false, defaultValue: 'review' },
  client_id: { type: DataTypes.INTEGER, allowNull: true },
  // 고객을 어떻게 정했나 — linked(기존 고객 골라 연결) · created(새 잠재 고객) · recipient(개인 열쇠 받는 사람) · none
  client_choice: { type: DataTypes.ENUM('linked', 'created', 'recipient', 'none'), allowNull: true },
  project_id: { type: DataTypes.INTEGER, allowNull: true },
  template_id: { type: DataTypes.INTEGER, allowNull: true },
  task_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  error: { type: DataTypes.STRING(120), allowNull: true },
  actor_user_id: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize, tableName: 'intake_cases', timestamps: true, underscored: true,
  indexes: [
    { fields: ['business_id', 'q_record_id'], name: 'intake_cases_record' },
    { fields: ['business_id', 'project_id'], name: 'intake_cases_project' },
  ],
});

module.exports = IntakeCase;
