// TaskTag — 워크스페이스 업무 태그 **사전** (#250 ③청크, Fable 설계 게이트 2026-08-08)
//
// 왜 사전 테이블인가 (JSON 자유배열이 아니라):
//   요구가 "리스트에 태그 표시" + "태그기준 나열" + 필터다. 자유 문자열이면 오타로 태그가 갈라지고,
//   이름을 바꿔도 옛 업무엔 옛 이름이 남으며, 필터 드롭다운의 정본이 없다.
//   `KbDocument.tags`(DataTypes.JSON) 계열은 M:N 필터가 LIKE 스캔이 되고, 이 저장소는 이미
//   JSON in-place mutation 저장 누락으로 한 번 당했다. `PostCategory` 계열(사전 테이블)이 맞다.
//
// ★ `tasks.category`(STRING(100)) 는 **동결**한다. QTask UI 에 한 번도 노출된 적이 없는 컬럼이라
//   지금은 "두 개념 공존 혼란" 이 성립하지 않지만, 새 UI 에 절대 노출하지 말 것.
//   태그로의 승격(백필)/폐기는 share 직렬화·Cue 생성 경로까지 얽혀 이 청크의 절단면 밖 —
//   **후속 결정 항목**이다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class TaskTag extends Model {}

TaskTag.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'businesses', key: 'id' } },
  name: { type: DataTypes.STRING(30), allowNull: false },
  // '#RRGGBB' 또는 null(기본 회색). 라우트에서 정규식 검증.
  color: { type: DataTypes.STRING(7), allowNull: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
}, {
  sequelize, tableName: 'task_tags', timestamps: true, underscored: true,
  indexes: [
    // MySQL 기본 collation 이 ai_ci 라 대소문자만 다른 중복도 이 UNIQUE 로 차단된다.
    { unique: true, fields: ['business_id', 'name'], name: 'task_tags_biz_name_unique' },
    // ★ name 을 반드시 명시한다. 무명이면 Sequelize 가 자체 규칙(task_tags_business_id_sort_order)으로
    //   이름을 지어, `sync-database.js`(sync alter) 실행 시 마이그레이션 DDL 이 만든
    //   task_tags_biz_sort 와 **중복 인덱스**가 생긴다(Fable 실증 F3).
    { fields: ['business_id', 'sort_order'], name: 'task_tags_biz_sort' },
  ],
});

module.exports = TaskTag;
