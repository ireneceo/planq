const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// 문서 변경 이력 — Q Docs §3.1
// 동시 편집 충돌 회피 (D-1 마지막 저장 우선) + 감사 로그.
class DocumentRevision extends Model {}

DocumentRevision.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  document_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'documents', key: 'id' } },
  revision_number: { type: DataTypes.INTEGER, allowNull: false },
  body_snapshot: { type: DataTypes.JSON, allowNull: true },         // 변경 전 form_data 또는 body_json
  changed_fields: { type: DataTypes.JSON, allowNull: true },        // diff (key 별 from/to)
  changed_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  change_note: { type: DataTypes.STRING(500), allowNull: true },
}, {
  sequelize,
  tableName: 'document_revisions',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    { fields: ['document_id', 'revision_number'] },
  ],
});

module.exports = DocumentRevision;
