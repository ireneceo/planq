// TaskActionItem — 업무 «결과물 액션» (2026-10-12, 설계 docs/TASK_ACTIONS_DESIGN.md · Fable 설계 · Irene «권고대로»)
//
// 업무에 «무엇을 만들 것인가»(문서·일정·메일·프로젝트)를 미리 적어 두고, 가서 만들면 그 행이 «무엇으로 끝났나» 를 기억한다.
//   ★ 연결 자체를 두 벌로 만들지 않는다 — 문서가 결과물에 들어가는가의 정본은 그대로 task_attachments(post_id),
//     일정↔업무는 calendar_events.task_id. 이 표는 «아직 안 만든 할 일» 과 «무엇으로 끝났나» 만 담는다.
//   ★ 이름을 task_actions 로 하지 않는다 — services/actions/task_actions.js(행동 계층)와 섞인다.
//   쓰는 문은 services/taskActionItems.js 하나다(fulfill·unlink).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskActionItem extends Model {}

TaskActionItem.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  task_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE',
  },
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // ENUM 은 넷을 처음부터 둔다(뒤에 append 마이그레이션을 또 돌리지 않게). 받을 수 있는 종류는 서비스 KINDS.enabled 가 가른다.
  kind: { type: DataTypes.ENUM('doc', 'event', 'mail', 'project'), allowNull: false },
  label: { type: DataTypes.STRING(200), allowNull: false },
  note: { type: DataTypes.STRING(1000), allowNull: true },
  meta: { type: DataTypes.JSON, allowNull: true },
  // project_stages 와 같은 네 낱말 — pending 안 만듦 · active 임시저장 · completed 끝 · skipped 이번엔 안 함
  status: { type: DataTypes.ENUM('pending', 'active', 'completed', 'skipped'), allowNull: false, defaultValue: 'pending' },
  linked_entity_type: { type: DataTypes.ENUM('post', 'calendar_event', 'email_thread', 'project'), allowNull: true },
  linked_entity_id: { type: DataTypes.INTEGER, allowNull: true },
  // doc 액션이 **스스로 만든** task_attachments 행 — 해제할 때 이것만 지운다(사람이 따로 붙인 첨부는 건드리지 않는다)
  linked_attachment_id: { type: DataTypes.INTEGER, allowNull: true },
  fulfilled_by: { type: DataTypes.INTEGER, allowNull: true },
  fulfilled_at: { type: DataTypes.DATE, allowNull: true },
  // 끝낸 시점의 tasks.review_round — 표시는 2단계, 값은 처음부터 적는다(나중에 추정하지 않게)
  fulfilled_round: { type: DataTypes.INTEGER, allowNull: true },
  created_by: { type: DataTypes.INTEGER, allowNull: false },
}, {
  sequelize,
  tableName: 'task_action_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['task_id', 'order_index'] },
    { fields: ['task_id', 'status'] },
    { name: 'task_action_items_linked_entity', fields: ['business_id', 'linked_entity_type', 'linked_entity_id'] },
  ],
});

module.exports = TaskActionItem;
