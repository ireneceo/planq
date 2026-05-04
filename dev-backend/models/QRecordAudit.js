// Q record 감사 로그 — read/reveal/edit/delete 모든 작업.
// secret 필드는 reveal 시 별도 기록 (자체 audit_logs 와 별도 — 빠른 조회용).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class QRecordAudit extends Model {}

QRecordAudit.init({
  id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  q_record_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'q_records', key: 'id' } },
  q_record_row_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'q_record_rows', key: 'id' } },
  user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  action: { type: DataTypes.ENUM(
    'record.create', 'record.update', 'record.delete',
    'column.add', 'column.update', 'column.remove',
    'row.create', 'row.update', 'row.delete',
    'secret.reveal',
  ), allowNull: false },
  field: { type: DataTypes.STRING(80), allowNull: true },          // column id (컬럼/시크릿 작업 시)
  meta: { type: DataTypes.JSON, allowNull: true },                 // before/after 등
}, {
  sequelize, tableName: 'q_record_audits', timestamps: true, underscored: true, updatedAt: false,
  indexes: [
    { fields: ['q_record_id', 'created_at'] },
    { fields: ['user_id', 'action'] },
  ],
});

module.exports = QRecordAudit;
