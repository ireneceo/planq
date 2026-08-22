// 업무 결과물의 **회차별 박제** (#271 · #307)
//
// 운영 신고 — "업무 결과물은 1개라 못 바꾸고 댓글로 자꾸 얘기하잖아. 수정요청 받은 다음 다시
//   수정내용 버전 업해서 넣는 게 되어야 하는데. 버전별로 저장되고 업무 히스토리랑 연결돼야지."
//
// 왜 새 표인가: 결과물은 `tasks.body` **한 칸**이라 다시 제출하면 이전 것이 덮인다.
//   그래서 사람들이 댓글에 결과물을 붙여 왔고, 무엇이 최신인지·무엇이 반려된 버전인지 알 수 없었다.
//   컨펌 라운드(review_round)는 이미 있으므로 **라운드마다 그때의 결과물을 박제**하면 된다.
//
// ★ 박제 시점은 **컨펌 요청(submitForReview)** 하나뿐이다. 저장할 때마다 뜨면 버전이 수십 개가 되고
//   "무엇이 제출본인가" 가 다시 흐려진다. 제출 = 버전 이라는 규칙이 사람이 이해하는 단위와 같다.
// ★ tasks.body 는 그대로 둔다(현재 결과물). 이 표는 **이력**이지 원본이 아니다 —
//   화면·검색·알림이 보는 곳을 옮기면 파급이 크고, 되돌리기도 어려워진다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskDeliverableVersion extends Model {}

TaskDeliverableVersion.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  task_id: {
    type: DataTypes.INTEGER, allowNull: false,
    references: { model: 'tasks', key: 'id' }, onDelete: 'CASCADE',
  },
  /** 이 결과물이 제출된 컨펌 라운드 (tasks.review_round 와 같은 값) */
  round: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  /** 제출 시점의 결과물 본문 스냅샷 */
  body: { type: DataTypes.TEXT('long'), allowNull: true },
  /** 제출 시점에 붙어 있던 첨부 id 들 — 파일 자체는 복제하지 않는다(용량·삭제 정합) */
  attachment_ids: { type: DataTypes.JSON, allowNull: true, defaultValue: null },
  /** 제출자 (Cue 실행이면 Cue 계정) */
  submitted_by: {
    type: DataTypes.INTEGER, allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  /** 제출 메모 — 담당자가 "무엇을 고쳤는지" 남기는 자리 (#271 의 "댓글이 남겨지는 메시지 입력") */
  note: { type: DataTypes.STRING(1000), allowNull: true },
}, {
  sequelize,
  modelName: 'TaskDeliverableVersion',
  tableName: 'task_deliverable_versions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['task_id', 'round'], name: 'tdv_task_round' },
  ],
});

module.exports = TaskDeliverableVersion;
