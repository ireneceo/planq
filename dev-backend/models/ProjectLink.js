// ProjectLink — R1 관련 프로젝트 (프로젝트 ↔ 프로젝트 연결, 양방향)
//
// 서로 연관된 프로젝트를 연결. 캔버스 "관련 프로젝트" 에서 연결한 프로젝트만 표시.
// a < b 강제(중복 방지), 양방향 조회(한 프로젝트의 관련 = a OR b 매칭의 반대편).
// business_id 는 멀티테넌트 WHERE 격리용 denormalized.

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectLink extends Model {}

ProjectLink.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  project_a_id: { type: DataTypes.BIGINT, allowNull: false },
  project_b_id: { type: DataTypes.BIGINT, allowNull: false },
  relation_label: { type: DataTypes.STRING(40), allowNull: true, comment: '연결 성격 (선택) — 예: 후속, 연계, 종속' },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'project_links',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['project_a_id', 'project_b_id'] },
    { fields: ['business_id'] },
    { fields: ['project_b_id'] },
  ],
});

module.exports = ProjectLink;
