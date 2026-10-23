// 사람별 즐겨찾기(별)·직접 정렬 순서 — 2026-10-23 (docs/PROJECT_PREFS_DESIGN.md · Fable DESIGN-OK).
//
// Irene: *"프로젝트 리스트 순서가 직접정렬도 있게 … 즐겨찾기 기능 넣어줘 … 채팅방에 이미 있는 디자인이랑 기능 형태 통일해서"*
//   ★ **사람 단위**다(워크스페이스 공용 아님) — 정본 Q talk 별(conversation_participants.pinned_at)이 사람 단위이고,
//     «내 순서» 를 남이 끌어 바꾸면 «순서가 저절로 바뀐다» 가 된다.
//   ★ 다형(entity_type) — 지금은 'project' 하나. 업무·파일 별이 뒤에 붙으면 ENUM 끝 append 만 한다(새 표 없음).
//     FK 가 없다 → 목록은 이 행을 LEFT 매핑으로만 읽는다(고아 행 무해).
//   project_members 에 넣지 않는 이유: owner/admin·«전체 공개» 프로젝트를 보는 사람은 멤버 행이 없다.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class UserEntityPref extends Model {}

UserEntityPref.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  entity_type: { type: DataTypes.ENUM('project'), allowNull: false },
  entity_id: { type: DataTypes.INTEGER, allowNull: false },
  pinned_at: { type: DataTypes.DATE, allowNull: true },
  // 직접 정렬 순서(0..n). NULL = 아직 끌어 놓은 적 없음 — 화면은 번호 있는 것보다 위에 최신순으로 둔다.
  sort_order: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  modelName: 'UserEntityPref',
  tableName: 'user_entity_prefs',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['user_id', 'entity_type', 'entity_id'] },
    { fields: ['user_id', 'business_id', 'entity_type'] },
  ],
});

module.exports = UserEntityPref;
