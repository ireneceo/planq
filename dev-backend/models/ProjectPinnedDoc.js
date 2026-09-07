// 프로젝트 상세 — 사용자가 탭으로 올려둔 문서(📌).
//
// ★ 2026-09-07 — 여태 **localStorage** 였다(`qproject_pinned_docs_<id>`).
//   그래서 데스크탑에서 올린 탭이 폰에서는 없었다 — 기능이 없는 것과 구별되지 않는다
//   (Irene: "프로젝트에서 별도로 핀기능으로 탭메뉴 추가한게 모바일에서는 안나와. 나와야지.").
//   같은 사람이 어느 기기에서 보든 같아야 하므로 **사람 단위로 서버에 둔다.**
//   팀 공용이 아니다 — 내 작업대 구성이라 남의 탭 줄을 바꾸지 않는다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectPinnedDoc extends Model {}

ProjectPinnedDoc.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.INTEGER, allowNull: false },
  post_id: { type: DataTypes.INTEGER, allowNull: false },
  // 탭 순서 — 사용자가 올린 순서를 그대로 유지한다(정렬 UI 는 아직 없다).
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  modelName: 'ProjectPinnedDoc',
  tableName: 'project_pinned_docs',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['user_id', 'project_id', 'post_id'] },
    { fields: ['user_id', 'project_id'] },
  ],
});

module.exports = ProjectPinnedDoc;
