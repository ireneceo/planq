const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectMember extends Model {}

ProjectMember.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  // 역할 글자 — 워크스페이스 역할 사전(member_roles)을 거쳐 저장한다. NULL = 역할 없음(옛 기본값 '기타' 폐기, docs/MEMBER_ROLES_DESIGN.md)
  role: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
  role_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  // PM 플래그 — 프로젝트당 복수 허용. 재무/일정/고객정보 토글 pm 모드에서 게이트 통과 기준.
  // PERMISSION_MATRIX §3 참조. 생성자는 자동 PM.
  is_pm: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  sequelize,
  tableName: 'project_members',
  timestamps: false,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['project_id', 'is_pm'] }
  ]
});

module.exports = ProjectMember;
