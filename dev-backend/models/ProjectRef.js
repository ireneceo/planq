// 프로젝트 연결(참조) — 문서·파일을 소속 프로젝트 말고 **다른 프로젝트에도 걸어 둔다** (2026-10-27).
//   Irene: «같은 문서가 여러 프로젝트에 연결되는 거면 어떻게 해? … 프로젝트 연결도 여러 개».
//   설계 docs/PROJECT_REFS_DESIGN.md (Fable GO-WITH-CHANGES — B안 «소속 하나 + 연결 여러 개»).
//
//   ★ 소속(posts.project_id · files.project_id)은 그대로 **공개 범위의 열쇠**다. 이 행은 권한을 넓히지 않는다 —
//     연결된 프로젝트 탭에 보여 줄 때도 원본 목록 술어(postListWhereByLevel·fileListWhereByLevel)로 거른다.
//   ★ 쓰는 문은 services/projectRefs.js 하나. 제목을 복사해 두지 않는다(보안 규칙 5).
//   ★ entity_type 은 ENUM 이 아니라 문자열 — 값 검사는 서비스(ENTITY_TYPES). 1차 'post'|'file', 다음 단계 'task'.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class ProjectRef extends Model {}

ProjectRef.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  business_id: { type: DataTypes.INTEGER, allowNull: false },
  project_id: {
    type: DataTypes.BIGINT,   // projects.id 가 BIGINT — FK 타입이 같아야 한다
    allowNull: false,
    references: { model: 'projects', key: 'id' },
    onDelete: 'CASCADE',
  },
  entity_type: { type: DataTypes.STRING(16), allowNull: false },
  entity_id: { type: DataTypes.BIGINT, allowNull: false },
  created_by: { type: DataTypes.INTEGER, allowNull: true },
}, {
  sequelize,
  tableName: 'project_refs',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { unique: true, fields: ['project_id', 'entity_type', 'entity_id'] },
    { fields: ['entity_type', 'entity_id'] },
    { fields: ['business_id'] },
  ],
});

module.exports = ProjectRef;
