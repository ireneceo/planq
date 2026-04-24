const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectMember extends Model {}

ProjectMember.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  role: { type: DataTypes.STRING(50), defaultValue: '기타' },
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
