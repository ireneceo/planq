// ProjectWorkstream — D3 #65 프로젝트 캔버스 핵심 추진과제 (Workstream)
//
// 컨설팅 engagement 의 MECE 한 추진 과제 묶음. 업무(task)의 상위 골격.
// task.workstream_id 로 업무를 워크스트림에 귀속시키면 캔버스 타임라인·업무연계도가
// "과제 단위" 로 묶여 전략 실행도로 읽힌다. (단순 업무 나열과의 차이)
//
// business_id 는 멀티테넌트 WHERE 격리용 denormalized 컬럼 (프로젝트와 동일 워크스페이스).

const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectWorkstream extends Model {}

ProjectWorkstream.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  title: { type: DataTypes.STRING(200), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  order_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // 캔버스 그룹 색 (hex). 없으면 프론트가 팔레트에서 index 기준 자동 배정.
  color: { type: DataTypes.STRING(20), allowNull: true },
  status: {
    type: DataTypes.ENUM('active', 'done', 'dropped'),
    allowNull: false, defaultValue: 'active',
  },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'project_workstreams',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['project_id', 'order_index'] },
    { fields: ['business_id'] },
  ],
});

module.exports = ProjectWorkstream;
